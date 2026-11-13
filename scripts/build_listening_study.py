"""W3: build a listening study from source excerpts, candidates and control renders.

The builder applies one **common** treatment — interval, latency and a single gain derived
from the reference — to every stimulus. It never loudness-matches individual candidates,
because that would hide dynamics errors the listeners are asked to judge.

Outputs are immutable once written: every stimulus is hashed into the study manifest, and
``verify`` refuses a study whose audio no longer matches. Candidate labels are assigned by a
rotation derived from an anonymous listener id, so a listener cannot learn which label is the
hidden reference from inspecting the page source.
"""
import argparse
import hashlib
import json
import shutil
import secrets
import sys
import time
from pathlib import Path

import numpy as np

try:
    from scripts import piano_reconstruction_harness as audio_io
except ImportError:  # pragma: no cover - direct script execution
    import piano_reconstruction_harness as audio_io

SCHEMA = 'piano-listening-study-1'
BROWSER_SCHEMA = 'piano-listening-browser-1'
RATINGS_SCHEMA = 'piano-listening-ratings-1'
INSTRUMENT_VERSION = '0.4.0'
ANALYSIS_VERSION = 'piano-listening-analysis-2'
MIN_SECONDS = 8.0
MAX_SECONDS = 15.0
DEFAULT_ROTATIONS = 24
TARGET_RMS_DBFS = -20.0
DEGRADED_SHIFT_SECONDS = 0.120
DEGRADED_ATTENUATION_DB = -3.0
HIDDEN_REFERENCE = 'hidden_reference'
DEGRADED_REFERENCE = 'degraded_reference'
RESERVED_ROLES = (HIDDEN_REFERENCE, DEGRADED_REFERENCE)
EXCERPT_BOUNDS_NOTE = '8-15 s with attack and tail context'

QUESTION = ('How closely does this candidate reproduce the reference performance and sound? '
            'Consider played notes, timing, expression, sustain and piano/room sound. '
            'Rate what you hear, not whether you like the interpretation.')

SCALE = (
    {'value': 0, 'label': 'No meaningful resemblance to this excerpt'},
    {'value': 25, 'label': 'Some recognizable content, with major differences'},
    {'value': 50, 'label': 'Clearly the same passage, but substantial audible differences'},
    {'value': 75, 'label': 'Close reproduction with noticeable remaining differences'},
    {'value': 100, 'label': 'No audible difference noticed under these listening conditions'},
)

ROTATION_RULE = ('sum of UTF-16 code units of the anonymous listener id, modulo the '
                 'rotation count')
EXCLUSION_RULES = (
    'a session that does not rate every candidate of every item is incomplete',
    'a session longer than the declared cap is excluded',
    'a session whose scores never vary across at least eight ratings is straight-lined',
    'no listener is excluded for correctly identifying a defect',
)
ATTENTION = {'hidden_reference_min_mean': 85.0, 'degraded_reference_max_mean': 60.0,
             'note': ('These are facilitator checks on the scale, not listener exclusions. '
                      'A listener who notices the degradation is doing the task correctly.')}


class StudyError(ValueError):
    """The study cannot be built as specified."""


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _reduce_to_mono(audio):
    array = np.asarray(audio, dtype=np.float32)
    if array.ndim == 1:
        return array
    return array.mean(axis=1, dtype=np.float32)


def _rms(audio):
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio.astype(np.float64)))))


def gain_for(reference, target_dbfs=TARGET_RMS_DBFS, ceiling=0.99):
    """One gain derived from the reference and applied to every candidate.

    Per-candidate normalization would make a wrong dynamic balance look correct, so it is
    deliberately not offered.
    """
    level = _rms(reference)
    if level < 1e-9:
        raise StudyError('the reference excerpt is silent; choose another interval')
    gain = (10.0 ** (target_dbfs / 20.0)) / level
    peak = float(np.max(np.abs(reference))) if reference.size else 0.0
    if peak > 0:
        gain = min(gain, ceiling / peak)
    return gain


def slice_interval(audio, sample_rate, start, end, latency_samples=0):
    """Take the declared interval, removing only a declared fixed latency."""
    if latency_samples < 0:
        raise StudyError('latency_samples must not be negative')
    first = int(round(start * sample_rate)) + latency_samples
    last = int(round(end * sample_rate)) + latency_samples
    if first < 0:
        raise StudyError('the interval plus latency starts before the recording')
    if last > audio.shape[0]:
        raise StudyError(
            f'the interval plus latency ends at sample {last}, beyond the '
            f'{audio.shape[0]}-sample recording')
    return audio[first:last]


def degrade(audio, sample_rate):
    """A deliberate, documented degradation used only as a low anchor."""
    shift = int(round(DEGRADED_SHIFT_SECONDS * sample_rate))
    shifted = np.zeros_like(audio)
    if shift < audio.shape[0]:
        shifted[shift:] = audio[:audio.shape[0] - shift]
    return shifted * (10.0 ** (DEGRADED_ATTENUATION_DB / 20.0))


def _stable_order(keys, salt):
    return sorted(keys, key=lambda key: hashlib.sha256(f'{salt}:{key}'.encode('utf-8'))
                  .hexdigest())


def _opaque_id(seed, item_id, role):
    """A neutral asset name that carries no role information."""
    return hashlib.sha256(f'{seed}:{item_id}:{role}'.encode('utf-8')).hexdigest()[:16]


def rotations(items, count=DEFAULT_ROTATIONS, seed=''):
    """Deterministic label and item orders, so every listener sees a different arrangement."""
    table = []
    for index in range(count):
        salt = f'{seed}:rotation:{index}'
        item_ids = [item['item_id'] for item in items]
        order = [item_ids.index(item_id) for item_id in _stable_order(item_ids, salt)]
        per_item = {}
        for item in items:
            roles = [candidate['role'] for candidate in item['candidates']]
            per_item[item['item_id']] = [
                roles.index(role) for role in
                _stable_order(roles, f'{salt}:{item["item_id"]}')]
        table.append({'index': index, 'item_order': order, 'label_order': per_item})
    return table


def rotation_index(listener_id, count):
    """The rule the browser also implements; documented in the manifest."""
    return sum(ord(character) for character in str(listener_id)) % count


def _write_stimulus(path, audio, sample_rate):
    audio_io.write_wav(path, audio, sample_rate, bit_depth=24)
    return {'path': path, 'sha256': file_sha256(path),
            'seconds': round(audio.shape[0] / float(sample_rate), 4)}


def build(spec, output, *, seed=None, rotation_count=DEFAULT_ROTATIONS, created_at=None):
    spec_path = Path(spec)
    spec_value = json.loads(spec_path.read_text(encoding='utf-8'))
    seed = seed or spec_value.get('seed') or 'piano-listening-v1'
    blinding_key = spec_value.get('blinding_key') or secrets.token_hex(32)
    output = Path(output)
    if output.exists() and any(output.iterdir()) and not spec_value.get('allow_overwrite'):
        raise StudyError(f'{output} is not empty; a built study is immutable, choose a new '
                         'directory or set allow_overwrite in the spec')

    excerpts = spec_value.get('excerpts') or []
    if not excerpts:
        raise StudyError('the spec contains no excerpts')
    if isinstance(rotation_count, bool) or not isinstance(rotation_count, int) or rotation_count < 1:
        raise StudyError('rotation count must be a positive integer')
    identifiers = [str(excerpt['id']) for excerpt in excerpts]
    if len(set(identifiers)) != len(identifiers):
        raise StudyError('excerpt ids must be unique')
    for identifier in identifiers:
        if not identifier or any(character not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for character in identifier):
            raise StudyError('excerpt ids may contain only letters, digits, underscores and hyphens')
    stimuli_dir = output / 'stimuli'
    stimuli_dir.mkdir(parents=True, exist_ok=True)

    items = []
    warnings = []
    for excerpt in excerpts:
        identifier = str(excerpt['id'])
        interval = excerpt.get('interval')
        if not interval or len(interval) != 2:
            raise StudyError(f'{identifier}: an explicit interval [start, end] is required')
        start, end = float(interval[0]), float(interval[1])
        length = end - start
        if not MIN_SECONDS <= length <= MAX_SECONDS:
            raise StudyError(
                f'{identifier}: interval is {length:.2f}s; listening excerpts must be within '
                f'{MIN_SECONDS:g}-{MAX_SECONDS:g}s')
        reference_path = Path(excerpt['reference'])
        reference_audio, rate = audio_io.read_wav(reference_path)
        reference_mono = _reduce_to_mono(reference_audio)
        reference_slice = slice_interval(reference_mono, rate, start, end)
        gain = gain_for(reference_slice)

        if _rms(reference_slice[:int(0.05 * rate)]) < 1e-6:
            warnings.append(f'{identifier}: the interval starts in silence, so attack context '
                            'may be missing')
        if _rms(reference_slice[-int(0.05 * rate):]) < 1e-6:
            warnings.append(f'{identifier}: the interval ends in silence, so tail context may '
                            'be missing')

        directory = stimuli_dir / identifier
        directory.mkdir(parents=True, exist_ok=True)
        reference_stimulus = _write_stimulus(directory / 'reference.wav',
                                             np.clip(reference_slice * gain, -1.0, 1.0), rate)

        candidates = []
        roles = [str(candidate['role']) for candidate in excerpt.get('candidates') or []]
        if len(roles) != len(set(roles)):
            raise StudyError(f'{identifier}: candidate roles must be unique')

        def add_candidate(role, stimulus):
            opaque = _opaque_id(blinding_key, identifier, role)
            candidates.append({'role': role, 'id': opaque,
                               'sha256': stimulus['sha256'],
                               'seconds': stimulus['seconds'],
                               'file': f'stimuli/{identifier}/{opaque}.wav'})

        for candidate in excerpt.get('candidates') or []:
            role = str(candidate['role'])
            if role in RESERVED_ROLES:
                raise StudyError(f'{identifier}: role {role!r} is generated by the builder')
            audio, candidate_rate = audio_io.read_wav(candidate['path'])
            if candidate_rate != rate:
                raise StudyError(
                    f'{identifier}/{role}: candidate is {candidate_rate} Hz but the reference '
                    f'is {rate} Hz; resampling is not part of this builder')
            mono = _reduce_to_mono(audio)
            piece = slice_interval(mono, rate, start, end,
                                   int(candidate.get('latency_samples') or 0))
            if piece.shape[0] != reference_slice.shape[0]:
                warnings.append(f'{identifier}/{role}: length differs after latency removal')
            audible = np.zeros_like(reference_slice)
            usable = min(audible.shape[0], piece.shape[0])
            audible[:usable] = piece[:usable]
            opaque = _opaque_id(blinding_key, identifier, role)
            stimulus = _write_stimulus(directory / f'{opaque}.wav',
                                       np.clip(audible * gain, -1.0, 1.0), rate)
            add_candidate(role, stimulus)

        hidden_roles = ((HIDDEN_REFERENCE, reference_slice),
                        (DEGRADED_REFERENCE, degrade(reference_slice, rate)))
        for role, signal in hidden_roles:
            opaque = _opaque_id(blinding_key, identifier, role)
            stimulus = _write_stimulus(directory / f'{opaque}.wav',
                                       np.clip(signal * gain, -1.0, 1.0), rate)
            add_candidate(role, stimulus)

        # Shuffle the candidate array so its position carries no role information either.
        order = _stable_order([candidate['id'] for candidate in candidates],
                              f'{seed}:{identifier}:order')
        candidates = [next(candidate for candidate in candidates if candidate['id'] == opaque)
                      for opaque in order]

        registry_entry = (spec_value.get('performances') or {}).get(
            excerpt.get('performance_id') or '')
        items.append({
            'item_id': identifier,
            'excerpt_id': identifier,
            'performance_id': str(excerpt.get('performance_id') or identifier),
            'recording_id': str(excerpt.get('recording_id')
                               or (registry_entry or {}).get('recording_id')
                               or excerpt.get('performance_id') or identifier),
            'performer_id': ((registry_entry or {}).get('performer_id')),
            'performance_mapping': ('registered' if registry_entry else
                                    'explicit-unregistered'
                                    if excerpt.get('performance_id') else
                                    'excerpt-default'),
            'title': excerpt.get('title') or identifier,
            'interval_seconds': [round(start, 4), round(end, 4)],
            'sample_rate': rate,
            'reference': {'file': f'stimuli/{identifier}/reference.wav',
                          'sha256': reference_stimulus['sha256'],
                          'seconds': reference_stimulus['seconds']},
            'candidates': candidates,
            'attribution': excerpt.get('attribution') or '',
        })

    mapping_verified = all(item['performance_mapping'] == 'registered' for item in items)
    registry = spec_value.get('performances') or {}
    for excerpt in excerpts:
        performance_id = excerpt.get('performance_id')
        if performance_id and performance_id in registry:
            declared_recording = excerpt.get('recording_id')
            registered_recording = (registry[performance_id] or {}).get('recording_id')
            if declared_recording and registered_recording and \
                    declared_recording != registered_recording:
                raise StudyError(
                    f'{excerpt.get("id")}: recording_id {declared_recording!r} does not match '
                    f'the registered recording {registered_recording!r}')

    study = {
        'schema': SCHEMA,
        'title': spec_value.get('title') or 'Piano reconstruction listening pilot',
        'created_at': created_at or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'seed': seed,
        'blinding_key': blinding_key,
        'question': QUESTION,
        'scale': list(SCALE),
        'bounds': {'min_seconds': MIN_SECONDS, 'max_seconds': MAX_SECONDS,
                   'max_session_minutes': 60, 'excerpt_bounds': EXCERPT_BOUNDS_NOTE},
        'rotation_count': rotation_count,
        'rotation_rule': ROTATION_RULE,
        'items': items,
        'rotations': rotations(items, rotation_count, f'{seed}:{blinding_key}'),
        'attention': ATTENTION,
        'exclusion_rules': list(EXCLUSION_RULES),
        'analysis': {
            'version': ANALYSIS_VERSION,
            'performance_mapping_verified': mapping_verified,
            'performance_registry_sha256': (hashlib.sha256(
                json.dumps(registry, sort_keys=True, separators=(',', ':')).encode('utf-8')
            ).hexdigest() if registry else None),
            'weighting': 'performance-equal',
            'nested_resampling': 'excerpts-within-performance',
            'note': ('excerpts of one performance are not independent units; a study whose '
                     'excerpts lack a registered parent performance stays legacy diagnostic'),
        },
        'warnings': warnings,
        'note': ('Similarity scores are listener judgements. They are not a probability of '
                 'identity, and no objective value may be presented as a listener rating.'),
    }
    if 'comparisons' in spec_value:
        comparisons = spec_value['comparisons']
        if not isinstance(comparisons, list) or not comparisons:
            raise StudyError('comparisons must be a nonempty list')
        declared = []
        for comparison in comparisons:
            candidate, baseline = comparison['candidate'], comparison.get('baseline', 'model_only')
            if candidate == baseline or candidate in RESERVED_ROLES or baseline in RESERVED_ROLES:
                raise StudyError('planned comparisons must compare distinct practical candidates')
            if any(not {candidate, baseline} <= {record['role'] for record in item['candidates']}
                   for item in items):
                raise StudyError('each planned comparison must be available in every excerpt')
            declared.append({'candidate': candidate, 'baseline': baseline,
                             'exploratory': bool(comparison.get('exploratory', False))})
        study['comparisons'] = declared
    output.mkdir(parents=True, exist_ok=True)
    instrument = Path(__file__).resolve().parents[1] / 'tools' / 'listening-instrument'
    study['instrument_assets'] = {name: file_sha256(instrument / name)
                                 for name in ('index.html', 'app.js', 'protocol.js', 'styles.css')}
    analyst_text = json.dumps(study, indent=2, sort_keys=True)
    (output / 'study.json').write_text(analyst_text, encoding='utf-8')
    analyst_sha256 = file_sha256(output / 'study.json')

    # The browser sees opaque names and no roles. The role/rotation key stays with the
    # analyst copy, and the browser echoes the analyst digest only as a hash.
    browser = browser_manifest(study, analyst_sha256)
    (output / 'study.browser.json').write_text(json.dumps(browser, indent=2, sort_keys=True),
                                               encoding='utf-8')
    (output / 'instructions.md').write_text(_instructions(study), encoding='utf-8')
    (output / 'consent.md').write_text(_consent(), encoding='utf-8')
    (output / 'ratings.template.csv').write_text(
        'listener_id,item_id,label,role,score,notes_timing,expression_pedal,tone_room,'
        'confidence,equipment,duration_minutes\n', encoding='utf-8')
    (output / 'README.md').write_text(_readme(), encoding='utf-8')
    # Serve only this bundle. The analyst manifest/decoding key must stay outside the
    # HTTP document root, rather than merely going unused by the page.
    public = output / 'public'
    public.mkdir(exist_ok=True)
    shutil.copy2(output / 'study.browser.json', public / 'study.browser.json')
    for item in items:
        for record in [item['reference'], *item['candidates']]:
            target = public / record['file']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(output / record['file'], target)
    for name in ('index.html', 'app.js', 'protocol.js', 'styles.css'):
        shutil.copy2(instrument / name, public / name)
    return study


def browser_manifest(study, analyst_sha256):
    """Canonical public projection, also used to verify the label-decoding contract."""
    return {
        'schema': BROWSER_SCHEMA,
        'instrument_version': INSTRUMENT_VERSION,
        'title': study['title'],
        'analyst_manifest_sha256': analyst_sha256,
        'question': study['question'],
        'scale': study['scale'],
        'bounds': study['bounds'],
        'rotation_count': study['rotation_count'],
        'rotation_rule': study['rotation_rule'],
        'items': [{'item_id': item['item_id'], 'title': item['title'],
                   'interval_seconds': item['interval_seconds'],
                   'sample_rate': item['sample_rate'],
                   'reference': {'file': item['reference']['file']},
                   'candidates': [{'id': candidate['id'], 'file': candidate['file']}
                                  for candidate in item['candidates']]}
                  for item in study['items']],
        'rotations': study['rotations'],
        'note': ('Rendered labels are anonymous. Role decoding is held in the analyst '
                 'manifest and the export records only the rotation index.'),
    }


def verify(study):
    """Confirm every stimulus and the browser manifest still match the record."""
    study_value = (json.loads(Path(study).read_text(encoding='utf-8'))
                   if isinstance(study, (str, Path)) else study)
    root = Path(study).parent if isinstance(study, (str, Path)) else Path('.')
    issues = []
    for item in study_value['items']:
        checks = [('reference', item['reference'])]
        checks.extend((candidate['role'], candidate) for candidate in item['candidates'])
        for name, record in checks:
            path = root / record['file']
            if not path.is_file():
                issues.append({'stimulus': str(path), 'problem': 'missing'})
            elif file_sha256(path) != record['sha256']:
                issues.append({'stimulus': str(path), 'problem': 'hash mismatch'})

    expected = (file_sha256(study) if isinstance(study, (str, Path)) else hashlib.sha256(
        json.dumps(study_value, indent=2, sort_keys=True).encode('utf-8')).hexdigest())
    for browser_path in (root / 'study.browser.json', root / 'public' / 'study.browser.json'):
        try:
            browser = json.loads(browser_path.read_text(encoding='utf-8'))
            if browser != browser_manifest(study_value, expected):
                issues.append({'stimulus': str(browser_path),
                               'problem': 'browser manifest does not match the analyst manifest'})
        except (OSError, ValueError):
            issues.append({'stimulus': str(browser_path), 'problem': 'missing or unreadable browser manifest'})
    for item in study_value['items']:
        for record in [item['reference'], *item['candidates']]:
            path = root / 'public' / record['file']
            if not path.is_file() or file_sha256(path) != record['sha256']:
                issues.append({'stimulus': str(path), 'problem': 'public stimulus missing or changed'})
    if not study_value.get('instrument_assets'):
        issues.append({'stimulus': 'instrument', 'problem': 'instrument asset identity missing'})
    for name, digest in study_value.get('instrument_assets', {}).items():
        path = root / 'public' / name
        if not path.is_file() or file_sha256(path) != digest:
            issues.append({'stimulus': str(path), 'problem': 'public instrument missing or changed'})
    if (root / 'public' / 'study.json').exists():
        issues.append({'stimulus': 'public/study.json', 'problem': 'analyst decoding key must not be served'})
    return {'ok': not issues, 'issues': issues, 'items': len(study_value['items']),
            'stimuli': sum(1 + len(item['candidates']) for item in study_value['items'])}


def _instructions(study):
    return f"""# Listening instructions

{study['question']}

You will hear a short reference excerpt, then several anonymous candidates. Play the
reference as often as you need. Seek within a candidate if you want to compare a passage.

Rate each candidate on the 0-100 scale:

""" + '\n'.join(f'- **{anchor["value"]}** — {anchor["label"]}' for anchor in study['scale']) + f"""

The scale values are response anchors, not ground truth. Use the whole scale. A candidate
you cannot tell apart from the reference deserves a high score; one that is clearly a
different rendering does not.

Optional comment boxes cover notes/timing, expression/pedal and tone/room. Comments are more
useful than a bare score, but leaving them empty is fine.

Session cap: {study['bounds']['max_session_minutes']} minutes. Take breaks between blocks.

Do not try to guess which candidate is which. There is no correct answer, and identifying a
deliberate defect is doing the task well, not failing it.
"""


def _consent():
    return """# Consent and payment record (facilitator copy)

Record before any session:

- Participant code (anonymous, used as the rotation id): ____________
- Date, start time: ____________
- Informed consent given: yes / no
- Data use explained: audio judgements only; no audio of the participant is recorded
- Payment or voucher reference: ____________
- Equipment used (headphones/monitors, model): ____________
- Facilitator: ____________

A participant may stop at any time without giving a reason. Stopping is not an exclusion
unless the participant asks for their data to be removed.
"""


def _readme():
    return """# Internal listening instrument v0.1

This is a local, dependency-free questionnaire. It is a development instrument, not the
confirmatory indistinguishability study.

## Run

```
python -m http.server 8765 --bind 127.0.0.1 --directory <study-directory>/public
```

Then open `http://127.0.0.1:8765/`. The builder includes the page, app.js, protocol.js,
styles.css, browser manifest and stimuli in public/. Serve only public/; study.json holds
the analyst decoding key and must never be inside the HTTP document root.

## Build a study

```
python scripts/build_listening_study.py --spec spec.json --output .local/listening/study-01
python scripts/build_listening_study.py --verify .local/listening/study-01/study.json
```

The spec lists each excerpt's reference, interval and candidates. The builder adds a hidden
reference and a deliberately degraded reference, applies one gain derived from the reference
to every stimulus, and hashes every file into `study.json`.

## Export

The page downloads a JSON file when a session finishes. Keep it unedited; the analyzer decodes
labels using the manifest rotation.

## Analyse

```
python scripts/analyze_listening_study.py --study <study-directory>/study.json --ratings sessions/*.json --output report.json
```

## Boundaries

- One piano, one room, development material only.
- Scores are listener judgements on a 0-100 similarity scale, not a probability of identity.
- No objective metric may be substituted for a listener rating.
"""


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build or verify a listening study.')
    parser.add_argument('--spec', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--seed')
    parser.add_argument('--rotations', type=int, default=DEFAULT_ROTATIONS)
    parser.add_argument('--verify', type=Path)
    arguments = parser.parse_args(argv)

    if arguments.verify:
        result = verify(arguments.verify)
        print(json.dumps(result, indent=2))
        return 0 if result['ok'] else 1
    if not arguments.spec or not arguments.output:
        parser.error('--spec and --output are required unless --verify is used')
    try:
        study = build(arguments.spec, arguments.output, seed=arguments.seed,
                      rotation_count=arguments.rotations)
    except (StudyError, audio_io.HarnessError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    summary = {'items': len(study['items']),
               'stimuli': sum(1 + len(item['candidates']) for item in study['items']),
               'rotations': study['rotation_count'],
               'warnings': study['warnings'],
               'output': str(arguments.output)}
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
