"""Deterministic piano rendering behind one explicit interface.

``render(performance, output_spec) -> audio + identity + latency + support``

Identity is the hash of a **resolved render request**: the object that synthesis actually
consumes. Every effective input — resolved note-off times and their source, pedal-derived
sounding ends, output extent, renderer settings and assets — is in the request, so audio
and identity cannot diverge. A change that cannot alter the samples (provenance, notation
the renderer does not consume) leaves the identity unchanged.

``AdditiveReferenceRenderer`` is a deterministic, dependency-free harness reference. It is
approximate and must never be presented as the fidelity renderer. ``SfizzRenderer`` refuses
to render until an engine, a pinned asset and its opcode probes exist.
"""
import hashlib
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

try:  # prefer the package path so error classes have one identity under pytest
    from scripts import piano_performance as performance_document
except ImportError:  # pragma: no cover - direct script execution
    import piano_performance as performance_document

ADDITIVE = 'additive-reference-1'
SFIZZ = 'sfizz-salamander'
PEDAL_TYPES = ('sustain', 'soft', 'sostenuto')
PEDAL_CAPABILITY = {'sustain': 'sustain_pedal', 'soft': 'soft_pedal',
                    'sostenuto': 'sostenuto_pedal'}
RELEASE_SOURCES = ('measured', 'legacy', 'assumed')

# The reference renderer needs a release where the document has none. This is a rendering
# assumption, never a measurement; it is hashed into the request and reported in warnings.
DEFAULT_RELEASE_ASSUMPTION = 0.35
DEFAULT_INTENSITY = 0.6


class RenderError(ValueError):
    """A render could not be produced from the given inputs."""


class RendererUnavailable(RenderError):
    """The renderer is not installed or not configured."""


class UnsupportedControl(RenderError):
    """The performance uses a control this renderer cannot honour."""


@dataclass(frozen=True)
class OutputSpec:
    sample_rate: int = 48000
    channels: int = 2
    tail_seconds: float = 2.0

    def __post_init__(self):
        if isinstance(self.sample_rate, bool) or not isinstance(self.sample_rate, int):
            raise RenderError('sample_rate must be an integer')
        if not 8000 <= self.sample_rate <= 192000:
            raise RenderError('sample_rate must be within 8000..192000')
        if self.channels not in (1, 2):
            raise RenderError('channels must be 1 or 2')
        if not math.isfinite(float(self.tail_seconds)) or not 0.0 <= self.tail_seconds <= 30.0:
            raise RenderError('tail_seconds must be finite and within 0..30')

    def to_dict(self):
        return {'sample_rate': self.sample_rate, 'channels': self.channels,
                'tail_seconds': float(self.tail_seconds)}


@dataclass(frozen=True)
class ControlSupport:
    """Declared capability. ``False`` means the control is not honoured, not missing."""

    velocity: bool
    key_release: bool
    sustain_pedal: bool
    soft_pedal: bool
    sostenuto_pedal: bool
    half_pedal: bool
    resonance: bool

    def to_dict(self):
        return {'velocity': self.velocity, 'key_release': self.key_release,
                'sustain_pedal': self.sustain_pedal, 'soft_pedal': self.soft_pedal,
                'sostenuto_pedal': self.sostenuto_pedal, 'half_pedal': self.half_pedal,
                'resonance': self.resonance}


@dataclass(frozen=True)
class ResolvedNote:
    """A note as synthesis consumes it. ``release_source`` says how the release was obtained."""

    id: str
    pitch: int
    onset: float
    key_release: float
    release_source: str
    sounding_end: float
    damped_by_key: bool
    intensity: float
    pan: float

    def to_dict(self):
        return {'id': self.id, 'pitch': self.pitch, 'onset': round(self.onset, 9),
                'key_release': round(self.key_release, 9),
                'release_source': self.release_source,
                'sounding_end': round(self.sounding_end, 9),
                'damped_by_key': self.damped_by_key,
                'intensity': round(self.intensity, 9), 'pan': round(self.pan, 9)}


@dataclass(frozen=True)
class RenderRequest:
    """Everything synthesis reads, and therefore everything identity must cover."""

    notes: tuple
    extent_seconds: float
    frames: int
    sample_rate: int
    channels: int
    renderer: str
    renderer_version: str
    asset_sha256: str
    settings: dict
    pedal_spans: tuple = ()

    def payload(self):
        return {'notes': [note.to_dict() for note in self.notes],
                'extent_seconds': round(self.extent_seconds, 9),
                'frames': self.frames,
                'sample_rate': self.sample_rate,
                'channels': self.channels,
                'renderer': self.renderer,
                'renderer_version': self.renderer_version,
                'asset_sha256': self.asset_sha256,
                'settings': self.settings}

    @property
    def identity(self):
        return canonical_sha256(self.payload())

    def release_sources(self):
        counts = {source: 0 for source in RELEASE_SOURCES}
        for note in self.notes:
            counts[note.release_source] = counts.get(note.release_source, 0) + 1
        return counts


@dataclass
class RenderResult:
    audio: np.ndarray
    identity: str
    latency_samples: int
    control_support: ControlSupport
    renderer: str
    renderer_version: str
    sample_rate: int
    warnings: tuple = ()
    release_sources: dict = None
    asset_sha256: str = None

    @property
    def frames(self):
        return int(self.audio.shape[0])

    @property
    def duration_seconds(self):
        return self.frames / float(self.sample_rate)

    def peak(self):
        return float(np.max(np.abs(self.audio))) if self.audio.size else 0.0


def canonical_sha256(value):
    import json
    payload = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


# --------------------------------------------------------------------------- pedals

def pedal_intervals(document, pedal_type='sustain', threshold=0.5):
    """Contiguous ``(start, end)`` spans where the pedal value is at or above threshold."""
    events = sorted((float(event['onset_seconds']), float(event['value']), str(event['id']))
                    for event in document['pedal'] if event['type'] == pedal_type)
    spans = []
    start = None
    for seconds, value, _identifier in events:
        down = value >= threshold
        if down and start is None:
            start = seconds
        elif not down and start is not None:
            spans.append((start, seconds))
            start = None
    if start is not None:
        spans.append((start, None))
    return tuple(spans)


def pedal_down(document, seconds, pedal_type='sustain', threshold=0.5):
    for start, end in pedal_intervals(document, pedal_type, threshold):
        if start <= seconds and (end is None or seconds < end):
            return True
    return False


def pedal_release_time(document, seconds, pedal_type='sustain', threshold=0.5):
    """The next pedal-up time strictly after ``seconds``, or ``None`` if it never lifts."""
    for start, end in pedal_intervals(document, pedal_type, threshold):
        if start <= seconds and (end is None or seconds < end):
            return end
    return None


def pedal_semantics(document):
    """Classify each stored pedal control as binary, continuous or absent.

    A fractional stored value is not proof that half-pedal behaviour was measured, but it
    does require an engine that models continuous position. Assuming a threshold is how a
    fidelity claim becomes false.
    """
    semantics = {}
    for pedal_type in PEDAL_TYPES:
        values = [float(event['value']) for event in document['pedal']
                  if event['type'] == pedal_type]
        if not values:
            semantics[pedal_type] = 'absent'
        elif all(abs(value - round(value)) < 1e-9 for value in values):
            semantics[pedal_type] = 'binary'
        else:
            semantics[pedal_type] = 'continuous'
    return semantics


def used_controls(document):
    """Capabilities the performance requires, derived from value semantics not presence."""
    uses = {'velocity': False, 'key_release': False, 'sustain_pedal': False,
            'soft_pedal': False, 'sostenuto_pedal': False, 'half_pedal': False}
    for note in document['notes']:
        if (note.get('velocity_midi') is not None or note.get('render_intensity') is not None or
            (note.get('legacy') or {}).get('velocity_amplitude') is not None):
            uses['velocity'] = True
        if note.get('key_release_seconds') is not None:
            uses['key_release'] = True
    for pedal_type, capability in PEDAL_CAPABILITY.items():
        semantics = pedal_semantics(document)[pedal_type]
        if semantics == 'binary':
            uses[capability] = True
        elif semantics == 'continuous':
            uses['half_pedal'] = True
    return uses


def _require_support(capability, uses, renderer_name):
    missing = [name for name, needed in uses.items() if needed and not getattr(capability, name)]
    if missing:
        raise UnsupportedControl(
            f'{renderer_name} does not honour {missing}, which this performance uses; '
            'render it with a renderer that declares support or explicitly downgrade '
            'the control first')
    return missing


# ------------------------------------------------------------------ request resolution

def resolve_request(document, output_spec, *, renderer_name, renderer_version,
                    asset_sha256, settings):
    """Resolve the performance into the exact object synthesis will consume.

    Resolving here — before identity is computed — is what keeps a legacy duration, an
    assumed release or a source extent from changing the audio behind an unchanged key.
    """
    performance_document.validate(document)
    release_assumption = float(settings.get('release_assumption_seconds',
                                            DEFAULT_RELEASE_ASSUMPTION))
    max_ring = float(settings.get('max_ring_seconds', 8.0))
    default_intensity = float(settings.get('default_intensity', DEFAULT_INTENSITY))
    spans = pedal_intervals(document)

    resolved = []
    for note in performance_document.sorted_notes(document):
        onset = float(note['onset_seconds'])
        if note.get('key_release_seconds') is not None:
            key_release = float(note['key_release_seconds'])
            release_source = 'measured'
        elif (note.get('legacy') or {}).get('duration_seconds') is not None:
            key_release = onset + float(note['legacy']['duration_seconds'])
            release_source = 'legacy'
        else:
            key_release = onset + release_assumption
            release_source = 'assumed'

        natural = onset + max_ring
        if pedal_down(document, key_release):
            lifting = pedal_release_time(document, key_release)
            sounding_end = natural if lifting is None else min(natural, lifting)
            damped_by_key = False
        else:
            sounding_end = key_release
            damped_by_key = True

        if note.get('render_intensity') is not None:
            intensity = float(note['render_intensity'])
        elif note.get('velocity_midi') is not None:
            intensity = float(note['velocity_midi']) / 127.0
        elif (note.get('legacy') or {}).get('velocity_amplitude') is not None:
            intensity = float(note['legacy']['velocity_amplitude'])
        else:
            intensity = default_intensity

        resolved.append(ResolvedNote(
            id=str(note['id']), pitch=int(note['pitch_midi']), onset=onset,
            key_release=key_release, release_source=release_source,
            sounding_end=sounding_end, damped_by_key=damped_by_key,
            intensity=float(np.clip(intensity, 0.0, 1.0)),
            pan=float(np.clip((int(note['pitch_midi']) - 21) / 87.0, 0.0, 1.0))))

    source_duration = float(document['source']['duration_seconds'])
    musical_end = max((note.sounding_end for note in resolved), default=0.0)
    latest_onset = max((note.onset for note in resolved), default=0.0)
    extent = max(source_duration, musical_end, latest_onset + 0.1) + float(output_spec.tail_seconds)
    frames = max(1, int(round(extent * output_spec.sample_rate)))

    return RenderRequest(
        notes=tuple(resolved), extent_seconds=extent, frames=frames,
        sample_rate=output_spec.sample_rate, channels=output_spec.channels,
        renderer=renderer_name, renderer_version=renderer_version,
        asset_sha256=asset_sha256, settings=dict(settings), pedal_spans=spans)


class AdditiveReferenceRenderer:
    """Deterministic additive synthesis: a harness reference, explicitly not a piano.

    No samples, no room, no resonance. It exists so the harness, objective and refinement
    loop can be built and tested against a renderer whose behaviour is fully known.
    """

    name = ADDITIVE
    version = '2.1.0'
    asset_sha256 = None
    approximate = True
    harmonics = 12
    attack_seconds = 0.004
    max_ring_seconds = 8.0

    def __init__(self, release_assumption_seconds=DEFAULT_RELEASE_ASSUMPTION,
                 headroom_db=0.0):
        self.release_assumption_seconds = float(release_assumption_seconds)
        # One declared pre-saturation gain: applied before the internal clip, so dense
        # material does not lose peaks. It is part of the request identity.
        self.headroom_db = float(np.clip(headroom_db, -60.0, 0.0))

    def controls(self):
        return ControlSupport(velocity=True, key_release=True, sustain_pedal=True,
                              soft_pedal=False, sostenuto_pedal=False, half_pedal=False,
                              resonance=False)

    def settings(self):
        return {'release_assumption_seconds': self.release_assumption_seconds,
                'default_intensity': DEFAULT_INTENSITY,
                'harmonics': self.harmonics, 'attack_seconds': self.attack_seconds,
                'max_ring_seconds': self.max_ring_seconds,
                'headroom_db': self.headroom_db}

    def identity_block(self):
        return {'renderer': self.name, 'version': self.version,
                'asset_sha256': self.asset_sha256, 'settings': self.settings()}

    def resolve(self, document, output_spec):
        return resolve_request(document, output_spec, renderer_name=self.name,
                               renderer_version=self.version,
                               asset_sha256=self.asset_sha256, settings=self.settings())

    def _note_signal(self, note, sample_rate):
        start_frame = max(0, int(round(note.onset * sample_rate)))
        window_end = min(note.sounding_end + 1.0, note.onset + self.max_ring_seconds + 1.0)
        end_frame = int(round(window_end * sample_rate))
        frames = max(1, end_frame - start_frame)
        times = (np.arange(frames, dtype=np.float64) + start_frame) / sample_rate - note.onset

        frequency = 440.0 * 2.0 ** ((note.pitch - 69) / 12.0)
        base_tau = float(np.clip(4.2 * (220.0 / frequency) ** 0.35, 0.55, 6.0))
        inharmonicity = 2.2e-4 * (1.0 + (note.pitch - 21) / 40.0)
        brightness = float(np.clip(0.78 - 0.5 * note.intensity, 0.18, 0.85))

        signal = np.zeros(frames, dtype=np.float64)
        for harmonic in range(1, self.harmonics + 1):
            amplitude = (1.0 / harmonic ** 1.15) * math.exp(-(harmonic - 1) * brightness)
            if amplitude < 1e-4:
                break
            partial = frequency * harmonic * math.sqrt(1.0 + inharmonicity * harmonic ** 2)
            if partial >= sample_rate / 2.0:
                break
            tau = base_tau / (1.0 + 0.45 * (harmonic - 1))
            envelope = np.exp(-np.maximum(times, 0.0) / tau)
            signal += amplitude * envelope * np.sin(2.0 * math.pi * partial * times)

        attack = np.clip(times / self.attack_seconds, 0.0, 1.0)
        attack = 0.5 - 0.5 * np.cos(np.pi * attack)  # raised cosine, no click
        signal *= attack

        # Damper: key release stops the string quickly, pedal lift less abruptly. ``times``
        # is measured from the onset, so the damper time must be too.
        damping_tau = 0.055 if note.damped_by_key else 0.22
        damper_offset = max(0.0, note.sounding_end - note.onset)
        after = times - damper_offset
        holding = after > 0.0
        if np.any(holding):
            signal[holding] *= np.exp(-after[holding] / damping_tau)

        return start_frame, signal * (0.85 * note.intensity ** 1.25)

    def synthesize(self, request):
        mono = np.zeros(request.frames, dtype=np.float64)
        pan = np.zeros(request.frames, dtype=np.float64)
        for note in request.notes:
            start, signal = self._note_signal(note, request.sample_rate)
            if start >= request.frames:
                continue
            stop = min(request.frames, start + signal.shape[0])
            mono[start:stop] += signal[:stop - start]
            pan[start:stop] += signal[:stop - start] * (note.pan - 0.5)

        if request.channels == 1:
            audio = mono[:, None]
        else:
            width = 0.35
            audio = np.stack([mono + width * pan, mono - width * pan], axis=1)
        if self.headroom_db:
            audio = audio * (10.0 ** (self.headroom_db / 20.0))
        return np.clip(audio, -1.0, 1.0).astype(np.float32)

    def render(self, document, output_spec=None, *, strict=True):
        if output_spec is None:
            output_spec = OutputSpec(
                sample_rate=int(document['timeline']['sample_rate']),
                channels=int(document['sound_model'].get('channels') or 2))
        uses = used_controls(document)
        capability = self.controls()
        if strict:
            _require_support(capability, uses, self.name)
        ignored = [name for name, needed in uses.items()
                   if needed and not getattr(capability, name)]

        request = self.resolve(document, output_spec)
        audio = self.synthesize(request)

        warnings = []
        if any(note.get('render_intensity') is None and note.get('velocity_midi') is None
               and (note.get('legacy') or {}).get('velocity_amplitude') is not None
               for note in document['notes']):
            warnings.append('legacy amplitudes used as uncalibrated render intensities; '
                            'they are not measured MIDI velocities')
        if ignored:
            warnings.append(f'ignored unsupported control(s): {ignored}; this render is '
                            'not a valid fidelity candidate')
        sources = request.release_sources()
        if sources.get('assumed'):
            warnings.append(
                f'release assumed for {sources["assumed"]} note(s) with neither a measured '
                f'key release nor a legacy duration (assumption '
                f'{self.release_assumption_seconds}s)')
        if sources.get('legacy'):
            warnings.append(
                f'release estimated from legacy duration for {sources["legacy"]} note(s); '
                'this is an estimate, not a measured key release')
        if float(np.max(np.abs(audio))) >= 0.999:
            warnings.append('output clipped')

        return RenderResult(audio=audio, identity=request.identity,
                            latency_samples=0, control_support=capability,
                            renderer=self.name, renderer_version=self.version,
                            sample_rate=output_spec.sample_rate, warnings=tuple(warnings),
                            release_sources=sources, asset_sha256=self.asset_sha256)


class SfizzRenderer:
    """Phase-C fidelity candidate: sfizz + Salamander Grand Piano V3.

    It does not render until the engine, the pinned SFZ asset and the opcode probes are
    all present. That is deliberate: the upstream mapping relies on ARIA extensions, and an
    engine that silently drops unsupported opcodes produces audio that looks like a result
    while being untraceable to the declared instrument.
    """

    name = SFIZZ
    version = 'unconfigured'
    asset_sha256 = None
    approximate = False

    # Only probed features may be declared. Round-robin, half-pedal and resonance are not
    # assumed: a mapping that does not use them does not require them, and one that does
    # needs the probe measurement before this adapter may claim support.
    FEATURE_CAPABILITIES = {'velocity layers': 'velocity',
                            'release samples': 'key_release',
                            'sustain pedal behaviour': 'sustain_pedal'}

    def __init__(self, engine_path=None, asset_path=None, asset_sha256=None,
                 capabilities=None):
        self.engine_path = engine_path
        self.asset_path = asset_path
        self.asset_sha256 = asset_sha256
        self.capabilities = capabilities or {}
        self.version = 'unconfigured' if engine_path is None else 'configured'

    def controls(self):
        verified = self.probe(self.engine_path, self.asset_path, self.capabilities)['capabilities_verified']
        records = self.capabilities.get('features') or []
        features = ({record['feature']: {'supported': record.get('support') == 'supported'}
                     for record in records} if isinstance(records, list) else records)
        return ControlSupport(
            velocity=verified and features.get('velocity layers', {}).get('supported') is True,
            # A release-triggered sample is not proof that note-off control is honoured.
            key_release=verified and features.get('key release control', {}).get('supported') is True,
            sustain_pedal=verified and features.get('sustain pedal behaviour', {}).get('supported') is True,
            soft_pedal=False, sostenuto_pedal=False, half_pedal=False, resonance=False)

    def identity_block(self):
        return {'renderer': self.name, 'version': self.version,
                'asset_sha256': self.asset_sha256,
                'engine_path': None if self.engine_path is None else str(self.engine_path),
                'asset_path': None if self.asset_path is None else str(self.asset_path)}

    def settings(self):
        return {'engine': None if self.engine_path is None else str(self.engine_path),
                'asset': None if self.asset_path is None else str(self.asset_path)}

    @classmethod
    def probe(cls, engine_path=None, asset_path=None, capabilities=None):
        """Report what still blocks this renderer instead of guessing."""
        blockers = []
        if engine_path is None:
            blockers.append('no sfizz engine configured')
        elif not Path(engine_path).is_file():
            blockers.append(f'sfizz engine not found at {engine_path}')
        if asset_path is None:
            blockers.append('no SFZ asset configured')
        elif not Path(asset_path).is_file():
            blockers.append(f'SFZ asset not found at {asset_path}')
        if not capabilities:
            blockers.append('mapping capabilities untested; run the sampler probe suite')
        else:
            unsupported = capabilities.get('unsupported_mandatory') or []
            if unsupported:
                blockers.append(f'mandatory sampler feature(s) unsupported: {unsupported}')
            if capabilities.get('decision') != 'passed' or capabilities.get('untested_mandatory'):
                blockers.append('sampler selection has not passed all mandatory probes')
            if engine_path and asset_path and Path(engine_path).is_file() and Path(asset_path).is_file():
                try:
                    from scripts import probe_sampler
                except ImportError:  # direct script execution
                    import probe_sampler
                current = probe_sampler.inventory(asset_path)
                mapping = capabilities.get('mapping') or {}
                records = capabilities.get('features') or []
                support = ({record['feature']: record.get('support') == 'supported'
                            for record in records} if isinstance(records, list) else
                           {name: value.get('supported') is True for name, value in records.items()})
                required = probe_sampler.required_features(current['opcodes'])
                if any(not support.get(name) for name, mandatory in required.items() if mandatory):
                    blockers.append('mandatory sampler probe evidence is incomplete')
                engine = capabilities.get('engine') or {}
                if not isinstance(engine, dict) or engine.get('sha256') != probe_sampler.file_sha256(engine_path):
                    blockers.append('engine identity does not match the probe evidence')
                if (mapping.get('dependencies_sha256') != current['dependencies_sha256'] or
                    (mapping.get('sample_state') or {}).get('sha256') != current['samples']['sha256'] or
                    not current['samples']['complete']):
                    blockers.append('instrument identity does not match the probe evidence')
        verified = not blockers
        blockers.append('the performance-to-sfizz rendering adapter is not implemented')
        return {'renderer': cls.name, 'available': False, 'capabilities_verified': verified,
                'blockers': blockers}

    def render(self, document, output_spec=None, *, strict=True):
        raise RendererUnavailable(
            'the sfizz fidelity renderer is not configured: '
            + '; '.join(self.probe(self.engine_path, self.asset_path,
                                   self.capabilities)['blockers'])
            + '. Use the additive reference renderer for harness work only.')


RENDERERS = {ADDITIVE: AdditiveReferenceRenderer, SFIZZ: SfizzRenderer}


def get_renderer(name=None, **options):
    if name is None or name == ADDITIVE:
        return AdditiveReferenceRenderer(**options)
    if name == SFIZZ:
        return SfizzRenderer(**options)
    raise RenderError(f'unknown renderer {name!r}; known renderers are {sorted(RENDERERS)}')


def render(document, output_spec=None, renderer=None, *, strict=True):
    renderer = renderer or get_renderer()
    return renderer.render(document, output_spec, strict=strict)


def request_identity(document, output_spec=None, renderer=None):
    """Identity of the resolved request, without synthesizing audio."""
    renderer = renderer or get_renderer()
    if output_spec is None:
        output_spec = OutputSpec(
            sample_rate=int(document['timeline']['sample_rate']),
            channels=int(document['sound_model'].get('channels') or 2))
    request = renderer.resolve(document, output_spec)
    return request.identity


def render_sha256(result):
    """Content hash of the rendered samples, for determinism checks and caching evidence."""
    return hashlib.sha256(np.ascontiguousarray(result.audio).tobytes()).hexdigest()
