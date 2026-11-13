"""W4: inventory the pinned SFZ mapping and define the sampler probes it requires.

The inventory is factual: it expands ``#include`` directives in order, applies ``#define``
substitution, and counts the opcodes the mapping actually uses. It does **not** decide which
of those opcodes an engine supports. Support is recorded as ``untested`` until a real engine
render is measured, because a static list cannot substitute for audio evidence.

``write_probes`` emits the minimal MIDI probes and a manifest describing what each probe is
supposed to measure. ``run`` refuses to produce results when no engine is configured.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

import numpy as np

try:  # prefer the package path so error classes have one identity under pytest
    from scripts import piano_reconstruction_harness as audio_io
except ImportError:  # pragma: no cover - direct script execution
    import piano_reconstruction_harness as audio_io

SCHEMA = 'sampler-opcode-inventory-1'
SELECTION_SCHEMA = 'renderer-selection-1'
PROBE_SCHEMA = 'sampler-probe-plan-1'
HEADER_RE = re.compile(r'^\s*<(\w+)>')
INLINE_INCLUDE = re.compile(r'#include\s+"([^"]+)"')
INLINE_DEFINE = re.compile(r'#define\s+\$(\w+)\s+(\S+)')
MACRO_RE = re.compile(r'\$(\w+)')
DIVISION = 480
TEMPO = 500000
MAX_INCLUDE_DEPTH = 8


class SamplerError(ValueError):
    """The mapping could not be read or the probe plan is invalid."""


class EngineUnavailable(SamplerError):
    """No sampler engine is configured, so no audio result may be claimed."""


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ---------------------------------------------------------------- SFZ expansion / inventory

def _read_with_includes(path, defines, seen, depth=0, missing=None, root=None):
    """Return expanded lines, applying ``#define`` in file order across includes.

    ``#include`` may appear inline, as in ``<group> #include "Data/vel_01.txt" lovel=1``.
    Expansion therefore happens in position order, so a later include sees the macros the
    earlier one defined. Paths resolve against the root SFZ directory, as the format
    specifies, with the including file's directory as a fallback.
    """
    if depth > MAX_INCLUDE_DEPTH:
        raise SamplerError(f'include nesting deeper than {MAX_INCLUDE_DEPTH} at {path}')
    if missing is None:
        missing = []
    path = Path(path)
    root = Path(root) if root is not None else path.parent
    if not path.is_file():
        missing.append(str(path))
        return []
    lines = []
    for raw in path.read_text(encoding='utf-8', errors='replace').splitlines():
        line = raw
        while True:
            defined = INLINE_DEFINE.search(line)
            if not defined:
                break
            defines[defined.group(1)] = _substitute(defined.group(2), defines)
            line = line[:defined.start()] + line[defined.end():]
        position = 0
        while True:
            include = INLINE_INCLUDE.search(line, position)
            if not include:
                tail = _substitute(line[position:], defines)
                if tail.strip():
                    lines.append(tail)
                break
            head = _substitute(line[position:include.start()], defines)
            if head.strip():
                lines.append(head)
            relative = _substitute(include.group(1), defines)
            target = root / relative
            if not target.is_file():
                fallback = path.parent / relative
                if fallback.is_file():
                    target = fallback
            lines.extend(_read_with_includes(target, defines, seen, depth + 1, missing, root))
            position = include.end()
    seen.add(str(path))
    return lines


def _substitute(text, defines):
    for _ in range(4):  # macros may reference earlier macros a few levels deep
        replaced = MACRO_RE.sub(lambda match: defines.get(match.group(1), match.group(0)), text)
        if replaced == text:
            break
        text = replaced
    return text


def expand(path):
    """Expand includes and macros; report every file read and every missing include."""
    defines = {}
    seen = set()
    missing = []
    root = Path(path).parent
    lines = _read_with_includes(path, defines, seen, missing=missing, root=root)
    return {'lines': lines, 'defines': dict(defines), 'files': sorted(seen),
            'missing_includes': sorted(set(missing))}


def _strip_comment(line):
    marker = line.find('//')
    return line[:marker] if marker >= 0 else line


def _dependencies(files, root):
    """Hash every file the mapping actually pulls in, with a stable relative path."""
    root = Path(root)
    records = []
    for name in sorted(set(files)):
        path = Path(name)
        try:
            relative = path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            relative = path.name
        data = path.read_bytes()
        records.append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest(),
                        'bytes': len(data)})
    aggregate = hashlib.sha256(json.dumps(records, sort_keys=True,
                                          separators=(',', ':')).encode('utf-8')).hexdigest()
    return records, aggregate


def _sample_references(lines, root):
    """Count referenced sample files and how many are present, without loading them."""
    root = Path(root)
    names = []
    default_path = ''
    for line in lines:
        for token in _split_tokens(_strip_comment(line)):
            if token.startswith('default_path='):
                default_path = token.split('=', 1)[1].strip().strip('"')
            if not token.startswith('sample='):
                continue
            value = token.split('=', 1)[1].strip().strip('"')
            if value and not value.startswith('*'):
                names.append((Path(default_path) / value).as_posix())
    unique = sorted(set(names))
    missing = [name for name in unique if not (root / name).is_file()]
    records = [{'path': name, 'sha256': file_sha256(root / name),
                'bytes': (root / name).stat().st_size} for name in unique if name not in missing]
    digest = hashlib.sha256(json.dumps(records, sort_keys=True,
                                        separators=(',', ':')).encode()).hexdigest()
    return {'referenced': len(unique), 'present': len(unique) - len(missing),
            'missing': len(missing), 'missing_examples': missing[:5],
            'dependencies': records, 'sha256': digest, 'complete': not missing,
            'note': 'Sample presence is recorded, not claimed; missing samples block rendering.'}


def inventory(path):
    """Count headers and opcodes, and hash every included mapping dependency."""
    expanded = expand(path)
    root = Path(path).parent
    headers = {}
    opcodes = {}
    opcodes_by_header = {}
    regions = 0
    current = None
    for raw in expanded['lines']:
        line = _strip_comment(raw).strip()
        if not line:
            continue
        for token in _split_tokens(line):
            header = HEADER_RE.match(token)
            if header:
                current = header.group(1)
                headers[current] = headers.get(current, 0) + 1
                if current == 'region':
                    regions += 1
                continue
            if '=' not in token:
                continue
            name = token.split('=', 1)[0].strip()
            if not name:
                continue
            opcodes[name] = opcodes.get(name, 0) + 1
            bucket = opcodes_by_header.setdefault(current or 'none', {})
            bucket[name] = bucket.get(name, 0) + 1

    control_ccs = sorted({int(match) for name in opcodes
                          for match in re.findall(r'cc(\d+)$', name)} |
                         {int(match) for name in opcodes
                          for match in re.findall(r'cc\$(\w+)', name) if match.isdigit()})
    dependencies, dependencies_sha256 = _dependencies(expanded['files'], root)
    samples = _sample_references(expanded['lines'], root)
    raw = Path(path).read_bytes()
    return {
        'schema': SCHEMA,
        'sfz': str(path),
        'sha256': hashlib.sha256(raw).hexdigest(),
        'bytes': len(raw),
        'files': [item['path'] for item in dependencies],
        'missing_includes': expanded['missing_includes'],
        'dependencies': dependencies,
        'dependencies_sha256': dependencies_sha256,
        'dependencies_hashed': (not expanded['missing_includes']
                                and len(dependencies) == len(set(expanded['files']))),
        'samples': samples,
        'defines': expanded['defines'],
        'headers': headers,
        'regions': regions,
        'opcodes': dict(sorted(opcodes.items())),
        'opcodes_by_header': {header: dict(sorted(values.items()))
                              for header, values in sorted(opcodes_by_header.items())},
        'controller_numbers': sorted({cc for cc in control_ccs if 0 <= cc < 128}),
        'opcode_count': len(opcodes),
        'support': 'untested',
    }


def _split_tokens(line):
    """Split on whitespace, keeping quoted strings such as ``sample="a b.wav"`` intact."""
    tokens, buffer, quoted = [], '', False
    for character in line:
        if character == '"':
            quoted = not quoted
            buffer += character
        elif character.isspace() and not quoted:
            if buffer:
                tokens.append(buffer)
                buffer = ''
        else:
            buffer += character
    if buffer:
        tokens.append(buffer)
    return tokens


# ------------------------------------------------------------------------ feature matrix

FEATURE_PROBES = (
    {'feature': 'pitch and attack', 'probe': 'strike_loud',
     'opcodes': ('sample', 'pitch_keycenter', 'lokey', 'hikey'),
     'measure': 'single attack at the declared pitch and onset'},
    {'feature': 'velocity layers', 'probe': 'strike_soft_to_loud',
     'opcodes': ('lovel', 'hivel', 'amp_veltrack', 'volume'),
     'measure': 'monotone level and brightness across three strike velocities'},
    {'feature': 'repeated same-pitch strikes', 'probe': 'repeat_strikes',
     'opcodes': ('note_polyphony', 'polyphony', 'off_time'),
     'measure': 'three same-pitch attacks remain distinguishable'},
    {'feature': 'release samples', 'probe': 'release_pedal_up',
     'opcodes': ('trigger', 'rt_decay'),
     'measure': 'audible release layer present after key release'},
    {'feature': 'key release control', 'probe': 'release_key_held',
     'opcodes': (), 'measure': 'earlier key release damps relative to a held key'},
    {'feature': 'sustain pedal behaviour', 'probe': 'release_pedal_down',
     'opcodes': ('on_locc64', 'on_hicc64', 'locc64', 'hicc64'),
     'measure': 'pedal-down release differs from pedal-up'},
    {'feature': 'pedal lift', 'probe': 'pedal_lift',
     'opcodes': ('off_time',),
     'measure': 'damping occurs at pedal lift, not before'},
    {'feature': 'dense polyphony', 'probe': 'dense_chord',
     'opcodes': ('polyphony', 'group'),
     'measure': 'twelve-note chord does not truncate silently'},
    {'feature': 'deterministic render', 'probe': 'strike_loud',
     'opcodes': (),
     'measure': 'byte-identical output across two renders'},
)


def probe_plan(opcodes):
    """Which probes the mapping requires, and their status before any engine run."""
    present = set(opcodes)
    plan = []
    for definition in FEATURE_PROBES:
        declared = [name for name in definition['opcodes'] if name in present]
        plan.append({'feature': definition['feature'], 'probe': definition['probe'],
                     'mapping_opcodes': list(definition['opcodes']),
                     'opcodes_present': declared,
                     'opcodes_absent': [name for name in definition['opcodes']
                                        if name not in present],
                     'measure': definition['measure'],
                     'support': 'untested'})
    return {'schema': PROBE_SCHEMA, 'probes': plan,
            'note': 'Absent opcodes do not mean the feature is missing; the probe decides.'}


# --------------------------------------------------------------------------- probe MIDI

def _varlen(value):
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def _track(events, end_tick):
    body = b''
    previous = 0
    for tick, payload in sorted(events, key=lambda item: item[0]):
        body += _varlen(tick - previous) + payload
        previous = tick
    body += _varlen(max(0, end_tick - previous)) + b'\xFF\x2F\x00'
    return b'MTrk' + struct.pack('>I', len(body)) + body


def write_smf(path, events, end_tick):
    Path(path).write_bytes(smf_bytes(events, end_tick))
    return Path(path)


def smf_bytes(events, end_tick):
    return (b'MThd' + struct.pack('>IHHH', 6, 1, 1, DIVISION)
            + _track([(0, b'\xFF\x51\x03' + TEMPO.to_bytes(3, 'big'))] + list(events), end_tick))


def _note(on_tick, off_tick, pitch, velocity):
    return [(on_tick, bytes([0x90, pitch, velocity])),
            (off_tick, bytes([0x80, pitch, 0]))]


PROBE_MIDI = {
    'strike_loud': lambda: _note(0, 480, 60, 100),
    'strike_soft_to_loud': lambda: _note(0, 480, 60, 30) + _note(480, 960, 60, 70)
                            + _note(960, 1440, 60, 120),
    'repeat_strikes': lambda: _note(0, 160, 60, 90) + _note(240, 400, 60, 90)
                      + _note(480, 640, 60, 90),
    'release_pedal_up': lambda: _note(0, 480, 60, 90),
    'release_key_held': lambda: _note(0, 1440, 60, 90),
    'release_pedal_down': lambda: _note(0, 480, 60, 90)
                          + [(0, bytes([0xB0, 64, 127]))],
    'pedal_lift': lambda: _note(0, 320, 60, 90) + [(0, bytes([0xB0, 64, 127])),
                                                   (720, bytes([0xB0, 64, 0]))],
    'dense_chord': lambda: [event for index, pitch in enumerate(range(48, 60))
                            for event in _note(0, 960, pitch, 100)],
}
PROBE_END_TICK = {'strike_loud': 960, 'strike_soft_to_loud': 1920, 'repeat_strikes': 960,
                  'release_pedal_up': 960, 'release_pedal_down': 1920, 'pedal_lift': 1920,
                  'dense_chord': 1920, 'release_key_held': 1920}


def write_probes(directory):
    """Write the probe MIDI files and a manifest of what each one measures."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    written = []
    for name, builder in sorted(PROBE_MIDI.items()):
        path = directory / f'{name}.mid'
        write_smf(path, builder(), PROBE_END_TICK[name])
        written.append({'probe': name, 'file': str(path),
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest = {'schema': 'sampler-probe-files-1', 'probes': written,
                'note': 'These files measure the engine; they are not evidence until rendered.'}
    (directory / 'probes.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


# --------------------------------------------------------------------- selection artifact

def selection_artifact(inventory_value, engine=None, samples=None, measurements=None):
    """A decision artifact that stays honest when the engine or samples are missing."""
    blockers = []
    if engine is None:
        blockers.append('no sampler engine configured; opcode support untested')
    if samples is None:
        blockers.append('no instrument samples present; the mapping cannot be rendered')
    if inventory_value.get('missing_includes'):
        blockers.extend(f'missing include: {name}'
                        for name in inventory_value['missing_includes'])
    if not inventory_value.get('dependencies_hashed', False):
        blockers.append('mapping dependencies are not fully hashed; identity is incomplete')
    sample_state = inventory_value.get('samples') or {}
    if sample_state.get('missing'):
        blockers.append(f'{sample_state["missing"]} of {sample_state["referenced"]} referenced '
                        'sample file(s) are absent; renders would be incomplete')

    plan = probe_plan(inventory_value['opcodes'])
    required = required_features(inventory_value['opcodes'])
    support = {item['feature']: 'untested' for item in plan['probes']}
    evidence = {}
    if measurements:
        for feature, result in measurements.get('features', {}).items():
            verdict = result.get('supported')
            support[feature] = ('untested' if verdict is None else
                                'supported' if verdict is True else 'unsupported')
            evidence[feature] = result.get('evidence')

    mandatory = sorted(feature for feature, needed in required.items() if needed)
    untested_mandatory = sorted(feature for feature in mandatory
                                if support.get(feature) == 'untested')
    if measurements:
        expected = {'mapping_sha256': inventory_value.get('dependencies_sha256'),
                    'samples_sha256': sample_state.get('sha256'),
                    'probe_set_sha256': probe_set_sha256(),
                    'engine_sha256': engine.get('sha256') if isinstance(engine, dict) else None}
        if measurements.get('identity') != expected:
            blockers.append('probe measurements do not match the current mapping and samples')
    unsupported_mandatory = sorted(feature for feature in mandatory
                                   if support.get(feature) == 'unsupported')
    failures = ([f'mandatory feature(s) unsupported: {unsupported_mandatory}']
                if measurements and unsupported_mandatory else [])

    if blockers:
        decision = 'blocked'
    elif not measurements:
        decision = 'pending-probes'
    elif failures:
        decision = 'failed'
    elif untested_mandatory or not (isinstance(engine, dict) and engine.get('sha256')):
        decision = 'pending-probes'
    else:
        decision = 'passed'

    features = []
    for item in plan['probes']:
        features.append({**item, 'support': support.get(item['feature'], 'untested'),
                         'mandatory': required.get(item['feature'], False),
                         'evidence': evidence.get(item['feature'])})

    return {
        'schema': SELECTION_SCHEMA,
        'decision': decision,
        'blockers': blockers,
        'engine': engine,
        'samples': samples,
        'mapping': {'sfz': inventory_value['sfz'], 'sha256': inventory_value['sha256'],
                    'files': inventory_value['files'],
                    'dependencies': inventory_value.get('dependencies', []),
                    'dependencies_sha256': inventory_value.get('dependencies_sha256'),
                    'dependencies_hashed': inventory_value.get('dependencies_hashed', False),
                    'sample_state': sample_state,
                    'regions': inventory_value['regions'],
                    'opcode_count': inventory_value['opcode_count']},
        'licenses': {
            'engine': 'BSD-2-Clause (sfizz) - repository archived; maintenance owner required',
            'samples': 'CC BY 3.0 (Salamander Grand Piano V3, Alexander Holm)',
            'mapping': 'SFZ mapping by kinwie; retain upstream notice and identify changes',
        },
        'mandatory_features': mandatory,
        'unsupported_mandatory': unsupported_mandatory,
        'untested_mandatory': untested_mandatory,
        'engine_identity_verified': bool(isinstance(engine, dict) and engine.get('sha256')),
        'failures': failures,
        'features': features,
        'determinism': (support.get('deterministic render', 'untested')),
        'runtime': 'unmeasured',
        'note': ('Support is measured, never inferred from an opcode list. Features the '
                 'mapping does not require are optional and do not block selection.'),
    }


def execute(render_callable, sfz_path, probes_dir, output_dir=None):
    """Render every probe, measure it, and report support with its evidence."""
    probes_dir = Path(probes_dir)
    output_dir = Path(output_dir) if output_dir else probes_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    measurements = {}
    renders = {}
    before = inventory(sfz_path)
    for name in sorted(PROBE_MIDI):
        midi = probes_dir / f'{name}.mid'
        canonical = smf_bytes(PROBE_MIDI[name](), PROBE_END_TICK[name])
        if not midi.is_file() or midi.read_bytes() != canonical:
            raise SamplerError(f'{name}: missing or changed canonical probe MIDI')
        wav = output_dir / f'{name}.wav'
        wav.unlink(missing_ok=True)
        render_callable(sfz_path=str(sfz_path), midi_path=str(midi), wav_path=str(wav))
        audio, rate = audio_io.read_wav(wav)
        measurements[name] = measure_probe(audio, rate)
        renders[name] = file_sha256(wav)

    repeated = output_dir / 'strike_loud.repeat.wav'
    repeated.unlink(missing_ok=True)
    render_callable(sfz_path=str(sfz_path), midi_path=str(probes_dir / 'strike_loud.mid'),
                    wav_path=str(repeated))
    deterministic = file_sha256(repeated) == renders['strike_loud']
    measurements['determinism'] = {'byte_identical': deterministic,
                                   'first': renders['strike_loud'],
                                   'second': file_sha256(repeated)}

    features = evaluate_features(measurements)
    features['deterministic render'] = {'supported': deterministic,
                                        'evidence': {'byte_identical': deterministic}}
    # Ordinary decay/reverb is not evidence of a release-triggered sample layer.
    features['release samples'] = {
        'supported': None,
        'evidence': {'reason': 'release-layer ablation not measured', 'tail_rms_after_release':
                     measurements.get('release_pedal_up', {}).get('tail_rms')}}
    current = inventory(sfz_path)
    if (before['dependencies_sha256'] != current['dependencies_sha256'] or
        before['samples']['sha256'] != current['samples']['sha256']):
        raise SamplerError('mapping or samples changed while the probes were rendering')
    return {'schema': 'sampler-probe-results-1', 'sfz': str(sfz_path),
            'identity': {'mapping_sha256': current['dependencies_sha256'],
                         'samples_sha256': current['samples']['sha256'],
                         'probe_set_sha256': probe_set_sha256(),
                         'engine_sha256': getattr(render_callable, 'engine_sha256', None)},
            'probes': measurements, 'features': features,
            'deterministic': deterministic}


def run(engine_command=None, *, render_callable=None, sfz=None, probes=None, output=None):
    """Render and measure the probe set; refuses to invent results without an engine."""
    renderer = run_engine(engine_command, render_callable=render_callable)
    if sfz is None or probes is None:
        raise SamplerError('the probe run needs both the SFZ path and the probe directory')
    return execute(renderer, sfz, probes, output)


def run_engine(engine_command=None, *, render_callable=None):
    """Return a callable that renders one probe, or refuse without an engine.

    ``render_callable`` receives ``(sfz_path, midi_path, wav_path)`` and is used directly by
    tests. ``engine_command`` is an argv list with ``{sfz}``, ``{midi}`` and ``{wav}``;
    legacy string templates are parsed before path substitution. No shell is invoked.
    """
    if render_callable is None and not engine_command:
        raise EngineUnavailable(
            'no sampler engine is configured; provide an engine command template or a '
            'render callable, then render the probe set and measure the results')
    if render_callable is None:
        import shlex
        import shutil
        import subprocess

        template = (engine_command if isinstance(engine_command, (list, tuple)) else
                    [part.strip('"') for part in shlex.split(engine_command, posix=False)])
        if not template:
            raise EngineUnavailable('the sampler engine command is empty')

        def render_callable(sfz_path, midi_path, wav_path):
            command = [part.format(sfz=sfz_path, midi=midi_path, wav=wav_path) for part in template]
            try:
                result = subprocess.run(command, capture_output=True, text=True, timeout=120)
            except (OSError, subprocess.TimeoutExpired) as error:
                raise SamplerError(f'engine could not finish the probe: {error}') from error
            if result.returncode != 0:
                raise SamplerError(f'engine failed: {result.stderr.strip()[:400]}')
        executable = shutil.which(template[0])
        render_callable.engine_sha256 = file_sha256(executable) if executable else None
    return render_callable


def probe_set_sha256():
    records = {name: hashlib.sha256(smf_bytes(builder(), PROBE_END_TICK[name])).hexdigest()
               for name, builder in sorted(PROBE_MIDI.items())}
    return hashlib.sha256(json.dumps(records, sort_keys=True).encode()).hexdigest()


def _rms(values):
    if values.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(values.astype(np.float64)))))


def _centroid(values, rate):
    if values.size == 0:
        return 0.0
    spectrum = np.abs(np.fft.rfft(values * np.hanning(values.size)))
    frequencies = np.fft.rfftfreq(values.size, d=1.0 / rate)
    total = float(spectrum.sum())
    return float((spectrum * frequencies).sum() / total) if total > 1e-12 else 0.0


def measure_probe(audio, rate):
    """Level, brightness, segmentation and tail measurements for one rendered probe."""
    mono = np.asarray(audio, dtype=np.float32)
    if mono.ndim == 2:
        mono = mono.mean(axis=1, dtype=np.float32)
    if rate <= 0 or not mono.size or not np.isfinite(mono).all():
        raise SamplerError('probe audio must be nonempty and finite at a positive sample rate')
    segments = np.array_split(mono, 3)
    onset_count = 0
    previous = 0.0
    for chunk in np.array_split(mono, 24):
        level = _rms(chunk)
        if level > previous * 2.5 + 1e-4:
            onset_count += 1
        previous = level
    thirds = [{'rms': round(_rms(chunk), 6), 'centroid_hz': round(_centroid(chunk, rate), 2)}
              for chunk in segments]
    def window(start, end):
        return mono[int(start * rate):int(end * rate)]
    attacks = []
    previous_level = 0.0
    hop = max(1, int(.01 * rate))
    for first in range(0, mono.size, hop):
        level = _rms(mono[first:first + hop])
        if level > previous_level * 2.5 + 1e-4 and (not attacks or first / rate - attacks[-1] > .08):
            attacks.append(first / rate)
        previous_level = level
    head = _rms(mono[:int(0.25 * rate)])
    tail = _rms(mono[int(0.75 * rate):]) if mono.shape[0] > 0.5 * rate else 0.0
    pitch_window = mono[int(.05 * rate):int(.4 * rate)]
    if pitch_window.size < 32:
        raise SamplerError('probe audio is too short to measure pitch')
    size = max(16384, pitch_window.size)
    spectrum = np.abs(np.fft.rfft(pitch_window * np.hanning(pitch_window.size), n=size))
    frequencies = np.fft.rfftfreq(size, 1 / rate)
    eligible = (frequencies > 50) & (frequencies < 2000)
    dominant = float(frequencies[np.where(eligible)[0][np.argmax(spectrum[eligible])]]) if eligible.any() else 0.0
    energies = []
    for pitch in range(48, 60):
        frequency = 440 * 2 ** ((pitch - 69) / 12)
        band = (frequencies >= frequency * .987) & (frequencies <= frequency * 1.013)
        energies.append(float(spectrum[band].max()) if band.any() else 0.0)
    coverage = sum(value > float(spectrum.max()) * .03 for value in energies)
    return {'seconds': round(mono.shape[0] / float(rate), 4),
            'dominant_hz': dominant, 'chord_pitch_bands_present': coverage,
            'attack_times': attacks,
            'velocity_windows': [{'rms': _rms(window(start + .02, start + .15)),
                                  'centroid_hz': _centroid(window(start + .02, start + .15), rate)}
                                 for start in (0., .5, 1.)],
            'post_release_rms': _rms(window(.6, .72)),
            'before_lift_rms': _rms(window(.55, .7)),
            'after_lift_rms': _rms(window(.85, 1.)),
            'peak': round(float(np.max(np.abs(mono))) if mono.size else 0.0, 6),
            'rms': round(_rms(mono), 6), 'segments': thirds,
            'head_rms': round(head, 6), 'tail_rms': round(tail, 6),
            'onset_count': onset_count}


def _increasing(values):
    return all(second >= first * 0.98 for first, second in zip(values, values[1:]))


def evaluate_features(measurements):
    """Turn measurements into per-feature support, with the evidence beside each verdict."""
    results = {}

    def record(feature, passed, detail):
        results[feature] = {'supported': bool(passed), 'evidence': detail}

    loud = measurements.get('strike_soft_to_loud')
    if loud:
        levels = [segment['rms'] for segment in loud['velocity_windows']]
        brightness = [segment['centroid_hz'] for segment in loud['velocity_windows']]
        record('velocity layers', _increasing(levels) and levels[-1] > levels[0] * 1.05,
               {'rms_by_velocity': levels, 'centroid_by_velocity': brightness})
    single = measurements.get('strike_loud')
    if single:
        hz = single.get('dominant_hz', 0)
        cents = 1200 * np.log2(hz / 261.625565) if hz > 0 else None
        record('pitch and attack', single['peak'] > 1e-4 and single['onset_count'] >= 1
               and cents is not None and abs(cents) <= 35
               and single.get('attack_times') and single['attack_times'][0] <= .04,
               {'peak': single['peak'], 'onset_count': single['onset_count'],
                'dominant_hz': hz, 'cents_from_C4': cents})

    repeats = measurements.get('repeat_strikes')
    if repeats:
        attacks = repeats.get('attack_times', [])
        record('repeated same-pitch strikes', len(attacks) == 3
               and all(abs(actual - expected) <= .04 for actual, expected in zip(attacks, (0, .25, .5))),
               {'attack_times': attacks})

    up, down = measurements.get('release_pedal_up'), measurements.get('release_pedal_down')
    if up and down:
        ratio = down['post_release_rms'] / max(up['post_release_rms'], 1e-9)
        record('sustain pedal behaviour', ratio > 1.5,
               {'tail_ratio_pedal_vs_no_pedal': round(ratio, 3)})
    held = measurements.get('release_key_held')
    if up and held:
        ratio = up['post_release_rms'] / max(held['post_release_rms'], 1e-9)
        record('key release control', held['post_release_rms'] > 1e-4 and ratio < .5,
               {'released_to_held_ratio': ratio})

    lift = measurements.get('pedal_lift')
    if lift and down:
        lifted_ratio = lift['after_lift_rms'] / max(lift['before_lift_rms'], 1e-9)
        held_ratio = down['after_lift_rms'] / max(down['before_lift_rms'], 1e-9)
        record('pedal lift', lift['before_lift_rms'] > 1e-4
               and held_ratio > 0 and lifted_ratio < held_ratio * .5,
               {'lifted_decay_ratio': lifted_ratio, 'sustained_decay_ratio': held_ratio})

    chord = measurements.get('dense_chord')
    if chord:
        record('dense polyphony', 1e-4 < chord['peak'] < .999
               and chord.get('chord_pitch_bands_present', 0) == 12,
               {'peak': chord['peak'], 'rms': chord['rms'],
                'pitch_bands_present': chord.get('chord_pitch_bands_present', 0),
                'note': 'spectral coverage diagnostic, not independent voice-count proof'})

    return results


# Mapping opcodes that make a probe mandatory. Features without a mapping signal stay optional.
MANDATORY_SIGNALS = {
    'velocity layers': ('lovel', 'hivel', 'amp_veltrack'),
    'repeated same-pitch strikes': ('note_polyphony', 'polyphony'),
    'release samples': ('trigger', 'rt_decay'),
    'sustain pedal behaviour': ('on_locc64', 'on_hicc64', 'locc64', 'hicc64'),
    'pedal lift': ('off_time',),
}
ALWAYS_MANDATORY = ('pitch and attack', 'repeated same-pitch strikes',
                    'key release control', 'sustain pedal behaviour', 'pedal lift',
                    'dense polyphony', 'deterministic render')


def required_features(opcodes):
    """Classify the probes the mapping actually requires, instead of a blanket list."""
    present = set(opcodes)
    required = {feature: True for feature in ALWAYS_MANDATORY}
    for feature, signals in MANDATORY_SIGNALS.items():
        required[feature] = feature in ALWAYS_MANDATORY or any(signal in present for signal in signals)
    return required


def main(argv=None):
    parser = argparse.ArgumentParser(description='Inventory the pinned SFZ mapping.')
    parser.add_argument('--sfz', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--probes', type=Path,
                        help='directory to write probe MIDI files into')
    parser.add_argument('--summary', action='store_true')
    arguments = parser.parse_args(argv)

    try:
        inventory_value = inventory(arguments.sfz)
    except SamplerError as error:
        print(f'error: {error}', file=sys.stderr)
        return 2

    plan = probe_plan(inventory_value['opcodes'])
    selection = selection_artifact(inventory_value)
    summary = {
        'sfz': inventory_value['sfz'],
        'sha256': inventory_value['sha256'],
        'files_read': len(inventory_value['files']),
        'missing_includes': inventory_value['missing_includes'],
        'headers': inventory_value['headers'],
        'regions': inventory_value['regions'],
        'opcode_count': inventory_value['opcode_count'],
        'controller_numbers': inventory_value['controller_numbers'],
        'probes': [item['probe'] for item in plan['probes']],
        'decision': selection['decision'],
        'blockers': selection['blockers'],
    }

    if arguments.output:
        arguments.output.mkdir(parents=True, exist_ok=True)
        (arguments.output / 'opcode-inventory.json').write_text(
            json.dumps(inventory_value, indent=2, sort_keys=True), encoding='utf-8')
        (arguments.output / 'renderer-selection.json').write_text(
            json.dumps(selection, indent=2, sort_keys=True), encoding='utf-8')
        summary['written'] = str(arguments.output)
    if arguments.probes:
        write_probes(arguments.probes)
        summary['probes_written'] = str(arguments.probes)

    print(json.dumps(summary if arguments.summary else
                     {'inventory': inventory_value, 'selection': selection},
                     indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
