"""Package 4: independent per-model scoring and an honest comparison aggregate.

Every attribute is scored against the same frozen reference and interval, using the
existing measurement layer. A cell is a value *plus* a state: capability gaps
(`not_estimated`), missing references (`reference_unavailable`), unverified alignment
(`diagnostic_only`) and licence blocks (`blocked_license`) are never rendered as zeros or
successes. No overall score and no automatic winner are produced.
"""
import argparse
import json
import math
import sys
from pathlib import Path

try:
    from scripts import piano_model_registry as registry_module
    from scripts import piano_performance as performance
    from scripts import piano_quality_events as events
    from scripts import piano_quality_expression as expression
    from scripts import piano_quality_reference as reference_contract
except ImportError:  # pragma: no cover - direct script execution
    import piano_model_registry as registry_module
    import piano_performance as performance
    import piano_quality_events as events
    import piano_quality_expression as expression
    import piano_quality_reference as reference_contract

SCHEMA = 'piano-model-comparison-1'
VERSION = '1.0.0'
MODE = 'raw-model-comparison-v1'
RECEIPT_SCHEMA = 'piano-model-run-receipt-1'

MEASURED = 'measured'
DIAGNOSTIC = 'diagnostic_only'
REFERENCE_UNAVAILABLE = 'reference_unavailable'
NOT_ESTIMATED = 'not_estimated'
UNSUPPORTED = 'unsupported_semantics'
PARTIAL = 'partial'
FAILED = 'failed'
BLOCKED = 'blocked_license'
NOT_RUN = 'not_run'
STATES = (MEASURED, DIAGNOSTIC, REFERENCE_UNAVAILABLE, NOT_ESTIMATED, UNSUPPORTED,
          PARTIAL, FAILED, BLOCKED, NOT_RUN)

TABLE_ORDER = ('detected_notes', 'note_correctness', 'fine_timing', 'key_release',
               'audible_end', 'velocity', 'relative_dynamics', 'pedal', 'written_rhythm',
               'audio', 'stereo_room', 'human_similarity', 'practicality')
TABLE_META = {
    'detected_notes': {'units': 'events', 'direction': None,
                       'note': 'observation only; more notes is not automatically better'},
    'note_correctness': {'units': 'f1', 'direction': 'higher_is_better',
                         'note': 'exact-pitch 50 ms correspondence against the reference'},
    'fine_timing': {'units': 'seconds', 'direction': 'lower_is_better',
                    'note': 'reference-only timing eligibility; fixed denominator'},
    'key_release': {'units': 'seconds', 'direction': 'lower_is_better',
                    'note': 'needs a candidate that estimates physical release'},
    'audible_end': {'units': 'seconds', 'direction': 'lower_is_better',
                    'note': 'needs independently annotated ending intervals'},
    'velocity': {'units': 'midi_units', 'direction': 'lower_is_better',
                 'note': 'amplitude proxies are not comparable MIDI velocity'},
    'relative_dynamics': {'units': 'rank_correlation', 'direction': 'higher_is_better',
                          'note': 'proxy only; never a replacement for calibrated velocity'},
    'pedal': {'units': 'f1', 'direction': 'higher_is_better',
              'note': 'per pedal type; absence is not pedal-off'},
    'written_rhythm': {'units': 'notation', 'direction': None,
                       'note': 'no notation output exists from these models'},
    'audio': {'units': 'objective', 'direction': 'lower_is_better',
              'note': 'synthetic common render; diagnostic, not fidelity'},
    'stereo_room': {'units': 'diagnostic', 'direction': None,
                    'note': 'no room-equivalence claim from a mono preview'},
    'human_similarity': {'units': 'points_0_100', 'direction': 'higher_is_better',
                         'note': 'no listener ratings exist yet'},
    'practicality': {'units': 'seconds', 'direction': 'lower_is_better',
                     'note': 'device/backend differ; not a same-device speed ranking'},
}


class ComparisonError(ValueError):
    """The comparison cannot be built as specified."""


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise ComparisonError(f'could not read {path}: {error}') from error


def _sha256(path):
    import hashlib
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_run(identifier, value):
    """Load one immutable run and verify its receipt before scoring it."""
    if not isinstance(value, dict) or 'receipt' not in value:
        raise ComparisonError(f'{identifier}: a run needs a receipt path')
    receipt_path = Path(value['receipt'])
    receipt = _read_json(receipt_path)
    if receipt.get('schema') != RECEIPT_SCHEMA:
        raise ComparisonError(f'{identifier}: unsupported receipt schema')
    if receipt.get('mode') != MODE:
        raise ComparisonError(f'{identifier}: receipt is not a raw comparison run')
    if receipt.get('variant') != identifier:
        raise ComparisonError(f'{identifier}: receipt belongs to {receipt.get("variant")!r}')
    if receipt.get('correction_enabled') is not False or \
            receipt.get('expression_correction_enabled') is not False:
        raise ComparisonError(f'{identifier}: corrections were enabled in this run')
    if receipt.get('correction_operations') != 0:
        raise ComparisonError(f'{identifier}: corrections were applied in this run')
    document_path = Path(value.get('document') or
                         receipt_path.parent / receipt['outputs']['document'])
    document = _read_json(document_path)
    try:
        performance.validate(document)
    except performance.PerformanceError as error:
        raise ComparisonError(f'{identifier}: invalid performance document: {error}') from error
    if _sha256(document_path) != receipt['outputs'].get('document_sha256'):
        raise ComparisonError(f'{identifier}: document hash does not match the receipt')
    if document['source']['sha256'] != receipt['source']['prepared_sha256']:
        raise ComparisonError(f'{identifier}: document source is not the prepared audio')
    native_path = Path(value.get('native') or
                       receipt_path.parent / receipt['outputs']['native'])
    native = _read_json(native_path)
    if dict(receipt.get('identity') or {}).get('checkpoint_sha256') and \
            native.get('variant') != identifier:
        raise ComparisonError(f'{identifier}: native sidecar belongs to another variant')
    return {'receipt': receipt, 'document': document, 'native': native,
            'document_path': document_path, 'receipt_path': receipt_path}


def _cell(value, state, reasons=()):
    if state not in STATES:
        raise ComparisonError(f'unsupported cell state {state!r}')
    return {'value': value, 'state': state, 'reasons': list(reasons)}


def _alignment_state(alignment_verified):
    return MEASURED if alignment_verified else DIAGNOSTIC


def _reference_events(reference):
    return [{'id': event['id'], 'pitch': event['pitch'],
             'onset_seconds': event['onset_seconds'],
             'onset_uncertainty_seconds': event.get('onset_uncertainty_seconds', 0.0),
             'status': event.get('status', 'verified')}
            for event in reference['attributes']['pitch_onset']['events']]


def _pairs(reference, notes, tolerance):
    verified = [event for event in _reference_events(reference)
                if event['status'] == 'verified']
    return events.match_events(verified, notes, tolerance)['pairs']


def _audio_segment(path, rate, interval):
    """Load a mono segment at ``rate``, trimmed to the declared interval."""
    import math
    import numpy as np
    from scipy.signal import resample_poly
    from scripts import piano_reconstruction_harness as harness
    samples, source_rate = harness.read_wav(path)
    if samples.ndim == 1:
        samples = samples[:, None]
    start = int(round(interval[0] * source_rate))
    end = min(int(round(interval[1] * source_rate)), samples.shape[0])
    segment = samples[start:end].mean(axis=1)
    if source_rate != rate:
        divisor = math.gcd(int(source_rate), int(rate))
        segment = resample_poly(segment, rate // divisor, source_rate // divisor)
    return np.ascontiguousarray(segment, dtype=np.float32)


def _audio_cell(run, source_audio, interval):
    from scripts import piano_reconstruction_metrics as metrics
    directory = Path(run['receipt_path']).parent
    manifest_path = directory / 'preview' / 'preview.json'
    preview_path = directory / 'preview' / 'preview.wav'
    if not manifest_path.is_file() or not preview_path.is_file():
        return _cell(None, NOT_RUN, ['no common preview was rendered for this run'])
    if source_audio is None:
        return _cell(None, NOT_RUN, ['source audio was not supplied for audio diagnostics'])
    manifest = _read_json(manifest_path)
    rate = int(manifest['common']['sample_rate'])
    reference = _audio_segment(source_audio, rate, interval)
    from scripts import piano_reconstruction_harness as harness
    candidate, candidate_rate = harness.read_wav(preview_path)
    if candidate_rate != rate:
        return _cell(None, FAILED, ['preview sample rate does not match its manifest'])
    if candidate.ndim == 1:
        candidate = candidate[:, None]
    candidate = candidate.mean(axis=1)
    length = min(reference.shape[0], candidate.shape[0])
    if length < 1000:
        return _cell(None, FAILED, ['audio is shorter than the comparison interval'])
    normalized = metrics.compare(reference[:length], candidate[:length], rate,
                                 gain_normalize=True)
    fixed_gain = manifest['common']['gain_policy']['common_gain_db']
    fixed = metrics.compare(reference[:length], candidate[:length], rate,
                            fixed_gain_db=fixed_gain)
    return _cell({'objective': normalized.objective,
                  'components': normalized.components,
                  'gain_db': normalized.gain_db,
                  'fixed_gain_db': fixed_gain,
                  'fixed_gain_objective': fixed.objective,
                  'clipping': manifest['previews']['as_transcribed']['clipping'],
                  'renderer': manifest['common']['renderer']},
                 DIAGNOSTIC,
                 ['synthetic common render; diagnostic only, not fidelity evidence'])


def _relative_dynamics(reference, document, pairs):
    """Rank agreement between model-estimated and captured velocity, if both exist."""
    if reference is None:
        return _cell(None, REFERENCE_UNAVAILABLE, ['no captured velocity reference'])
    velocities = {event['note_id']: event['velocity_midi']
                  for event in reference['attributes']['velocity']['events']}
    candidate = {str(note['id']): note.get('velocity_midi')
                 for note in document['notes']}
    values = [(velocities[pair['reference_id']], candidate[pair['candidate_id']])
              for pair in pairs
              if pair['reference_id'] in velocities
              and candidate.get(pair['candidate_id']) is not None]
    if len(values) < 3:
        return _cell(None, NOT_ESTIMATED,
                     ['fewer than three comparable velocity pairs'])
    from scipy.stats import spearmanr
    x = [item[0] for item in values]
    y = [item[1] for item in values]
    if len(set(x)) < 2 or len(set(y)) < 2:
        return _cell(None, NOT_ESTIMATED,
                     ['captured velocity has no rankable variation on these pairs'])
    rank = float(spearmanr(x, y).statistic)
    if not math.isfinite(rank):
        return _cell(None, NOT_ESTIMATED,
                     ['captured velocity has no rankable variation on these pairs'])
    return _cell({'rank_correlation': round(rank, 6), 'pairs': len(values)},
                 DIAGNOSTIC,
                 ['rank proxy only; model velocity is not calibrated'])



def score_model(identifier, entry, run, reference, *, master_sha256, interval,
                source_audio=None):
    """Score one model; capability gaps are states, not zero values."""
    document = run['document']
    notes = [{'id': str(note['id']), 'pitch': note['pitch_midi'],
              'onset_seconds': float(note['onset_seconds'])} for note in document['notes']]
    duration = float(interval[1]) - float(interval[0])
    capabilities = (entry or {}).get('capabilities') or {}
    attributes = {}

    attributes['detected_notes'] = _cell(
        {'notes': len(notes), 'per_second': round(len(notes) / duration, 3)
         if duration > 0 else None}, MEASURED)

    reference_available = reference is not None
    pitch_status = (reference['attributes']['pitch_onset']['status']
                    if reference_available else None)
    alignment_verified = bool(reference_available and reference['timeline']
                              ['video_to_analysis']['verified'])

    if not reference_available or pitch_status != 'verified':
        reason = ('no independent reference was supplied' if not reference_available
                  else 'the reference pitch/onset attribute is not verified')
        attributes['note_correctness'] = _cell(None, REFERENCE_UNAVAILABLE, [reason])
        attributes['fine_timing'] = _cell(None, REFERENCE_UNAVAILABLE, [reason])
    else:
        tolerance = reference_contract.TOLERANCES['onset_match_seconds']
        score = events.score_events(_reference_events(reference), notes,
                                    tolerance=tolerance,
                                    within=reference_contract.TOLERANCES[
                                        'onset_within_seconds'],
                                    reference_status=pitch_status)
        state = _alignment_state(alignment_verified)
        reasons = [] if alignment_verified else ['alignment is not independently verified']
        if not score.get('applicable'):
            state = REFERENCE_UNAVAILABLE
            reasons.append('no scorable reference or candidate events')
        attributes['note_correctness'] = _cell({
            'matched': score.get('matched'), 'missing': score.get('missing'),
            'extra': score.get('extra'), 'precision': score.get('precision'),
            'recall': score.get('recall'), 'f1': score.get('f1'),
            'reference_count': score.get('reference_count'),
            'candidate_scored': score.get('candidate_scored'),
            'masked_extra': score.get('masked_extra')}, state, reasons)
        attributes['fine_timing'] = _cell({
            'mae_seconds': score.get('onset_mae_seconds'),
            'p95_seconds': score.get('onset_p95_absolute_seconds'),
            'bias_seconds': score.get('onset_bias_seconds'),
            'all_reference_within_tolerance': score.get('all_reference_within_tolerance'),
            'scorable_reference': score.get('scorable_reference'),
            'ambiguous_reference': score.get('ambiguous_reference')}, state, reasons)

    # Capability-first states: a model without the target cannot be scored as a failure.
    attributes['key_release'] = _cell(None, NOT_ESTIMATED,
                                      ['no model estimates physical key release'])
    attributes['audible_end'] = _cell(None, NOT_ESTIMATED,
                                      ['no model estimates an independently annotated '
                                       'audible ending'])
    attributes['written_rhythm'] = _cell(None, UNSUPPORTED,
                                         ['no model outputs written notation'])
    velocity_mode = capabilities.get('velocity')
    if velocity_mode is None:
        kinds = {(note.get('velocity_provenance') or {}).get('kind')
                 for note in document['notes']}
        velocity_mode = ('amplitude_proxy' if 'amplitude_proxy' in kinds
                         else 'model_estimated' if 'model_estimated' in kinds else None)
    if velocity_mode == 'amplitude_proxy':
        attributes['velocity'] = _cell(None, NOT_ESTIMATED,
                                       ['amplitude proxy, not comparable MIDI velocity'])
        attributes['relative_dynamics'] = _cell(
            None, NOT_ESTIMATED, ['amplitude proxy is not a calibrated velocity'])
    elif not reference_available or reference['attributes']['velocity']['status'] != 'verified':
        attributes['velocity'] = _cell(None, REFERENCE_UNAVAILABLE,
                                       ['no captured MIDI velocity reference'])
        attributes['relative_dynamics'] = _cell(
            None, REFERENCE_UNAVAILABLE, ['no captured MIDI velocity reference'])
    else:
        pairs = _pairs(reference, notes, reference_contract.TOLERANCES[
            'onset_match_seconds'])
        result = expression.velocity_scores(
            reference, expression.candidate_notes(document), pairs,
            tolerance=reference_contract.TOLERANCES['velocity_units'],
            reference_status=reference['attributes']['velocity']['status'])
        state = _alignment_state(alignment_verified)
        if not result.get('applicable'):
            state = NOT_ESTIMATED
        attributes['velocity'] = _cell(result, state,
                                       [] if state != DIAGNOSTIC else
                                       ['alignment is not independently verified'])
        attributes['relative_dynamics'] = _relative_dynamics(reference, document, pairs)

    pedal_mode = capabilities.get('pedal')
    if pedal_mode is None:
        if document['pedal']:
            pedal_mode = 'sustain'
        else:
            pedal_mode = (run['native'].get('pedal') or {}).get('status')
    if pedal_mode in (None, 'none', 'not_estimated'):
        attributes['pedal'] = _cell(None, NOT_ESTIMATED,
                                    ['the model does not estimate pedal'])
    elif not reference_available or reference['attributes']['pedal']['status'] != 'verified':
        attributes['pedal'] = _cell(None, REFERENCE_UNAVAILABLE,
                                    ['no captured controller reference'])
    else:
        types = [pedal_type for pedal_type in ('sustain',) if any(
            event['type'] == pedal_type
            for event in reference['attributes']['pedal']['events'])]
        results = [expression.pedal_scores(
            reference, expression.candidate_pedal(document, pedal_type), interval,
            pedal_type=pedal_type,
            tolerance=reference_contract.TOLERANCES['pedal_seconds'],
            reference_status='verified') for pedal_type in types]
        state = _alignment_state(alignment_verified)
        attributes['pedal'] = _cell({'types': results}, state,
                                    [] if state != DIAGNOSTIC else
                                    ['alignment is not independently verified'])

    attributes['audio'] = _audio_cell(run, source_audio, interval)
    channels = 1
    if source_audio is not None:
        from scripts import piano_reconstruction_harness as harness
        channels = harness.inspect_wav(source_audio)['channels']
    if channels < 2:
        attributes['stereo_room'] = _cell(
            None, REFERENCE_UNAVAILABLE,
            ['the registered source is mono; no stereo or room reference exists'])
    else:
        attributes['stereo_room'] = _cell(
            None, UNSUPPORTED,
            ['the common preview is mono; it cannot support a room-equivalence claim'])
    attributes['human_similarity'] = _cell(
        None, REFERENCE_UNAVAILABLE,
        ['no listener ratings exist; no automatic human score is produced'])

    runtime = run['receipt'].get('runtime') or {}
    attributes['practicality'] = _cell({
        'inference_seconds': runtime.get('seconds'),
        'device': runtime.get('device'),
        'backend': runtime.get('backend'),
        'checkpoint_sha256': (run['receipt'].get('identity') or {}).get('checkpoint_sha256'),
        'cold_load_seconds': None,
        'peak_memory_mib': runtime.get('peak_memory_mib')},
        PARTIAL,
        ['cold model load and peak memory were not recorded'])

    return {'variant': identifier,
            'family': (entry or {}).get('family') or run['receipt'].get('family'),
            'label': (entry or {}).get('label', identifier),
            'document_path': str(run['document_path']),
            'attributes': attributes}


def evaluate(reference_path, runs, *, interval=None, output=None, registry=None,
             created_at=None, source_audio=None):
    """Score every run against the same reference and build the comparison."""
    reference = None
    master_sha256 = None
    alignment_verified = False
    if reference_path is not None:
        reference = _read_json(reference_path)
        reference_contract.validate(reference)
        master_sha256 = reference['source']['sha256']
        alignment_verified = bool(reference['timeline']['video_to_analysis']['verified'])
        if interval is None:
            interval = [float(value) for value in reference['scored_interval']]
    if interval is None:
        raise ComparisonError('an interval is required for a source-only comparison')
    interval = [float(interval[0]), float(interval[1])]

    entries = {}
    if registry is not None:
        entries = {variant['id']: variant for variant in registry['variants']}

    models = {}
    for identifier, value in runs.items():
        run = load_run(identifier, value)
        if master_sha256 is None:
            master_sha256 = run['receipt']['source']['master_sha256']
        elif run['receipt']['source']['master_sha256'] != master_sha256:
            raise ComparisonError(f'{identifier}: run source does not match the comparison')
        receipt_interval = run['receipt']['source']['interval']
        if any(abs(float(receipt_interval[index]) - interval[index]) > 1e-6
               for index in (0, 1)):
            raise ComparisonError(f'{identifier}: run interval does not match the comparison')
        models[identifier] = score_model(identifier, entries.get(identifier), run,
                                         reference, master_sha256=master_sha256,
                                         interval=interval, source_audio=source_audio)

    blocked = []
    if registry is not None:
        for variant in registry['variants']:
            if variant['status'] == registry_module.STATUS_BLOCKED:
                blocked.append({'variant': variant['id'], 'label': variant['label'],
                                'state': BLOCKED,
                                'reasons': list(variant['rights']['blockers'])})

    table_rows = []
    for attribute in TABLE_ORDER:
        cells = {}
        for identifier, model in models.items():
            cells[identifier] = model['attributes'][attribute]
        for row in blocked:
            cells[row['variant']] = {'value': None, 'state': BLOCKED,
                                     'reasons': row['reasons']}
        table_rows.append({'attribute': attribute, **TABLE_META[attribute],
                           'cells': cells})

    aggregate = {'models': len(models), 'blocked': len(blocked),
                 'states': {}}
    for identifier, model in models.items():
        counts = {}
        for cell in model['attributes'].values():
            counts[cell['state']] = counts.get(cell['state'], 0) + 1
        aggregate['states'][identifier] = counts

    comparison = {
        'schema': SCHEMA,
        'version': VERSION,
        'mode': MODE,
        'created_at': created_at,
        'source': {'master_sha256': master_sha256, 'interval': interval,
                   'reference': (None if reference is None else {
                       'reference_id': reference['reference_id'],
                       'sha256': reference_contract.reference_sha256(reference),
                       'split': reference['split'],
                       'alignment_verified': alignment_verified,
                       'attributes': {name: reference['attributes'][name]['status']
                                      for name in reference['attributes']}})},
        'models': models,
        'table': table_rows,
        'blocked': blocked,
        'aggregate': aggregate,
        'limits': [
            'Attribute rows are not combined into an overall score or an automatic winner.',
            'A diagnostic or reference-unavailable state is not a pass or a failure.',
            'Model agreement is not evidence of correctness; only the reference measures it.',
        ],
    }
    if output:
        output = Path(output)
        output.mkdir(parents=True, exist_ok=True)
        (output / 'comparison.json').write_text(
            json.dumps(comparison, indent=2, sort_keys=True), encoding='utf-8')
        (output / 'comparison.md').write_text(markdown(comparison), encoding='utf-8')
    return comparison


def _format(value):
    if value is None:
        return ''
    if isinstance(value, float):
        return f'{value:.4g}'
    if isinstance(value, dict):
        return ', '.join(f'{key}={_format(item)}' for key, item in sorted(value.items())
                         if item is not None)
    return str(value)


def markdown(comparison):
    models = list(comparison['models']) + [row['variant'] for row in comparison['blocked']]
    lines = ['# Raw piano model comparison', '',
             f"Source `{comparison['source']['master_sha256'][:12]}…`, interval "
             f"{comparison['source']['interval']}.",
             '', '| attribute | ' + ' | '.join(models) + ' |',
             '|---|' + '---|' * len(models)]
    for row in comparison['table']:
        cells = []
        for identifier in models:
            cell = row['cells'].get(identifier) or {'value': None, 'state': NOT_RUN}
            if cell['state'] in (BLOCKED, NOT_ESTIMATED, REFERENCE_UNAVAILABLE,
                                 UNSUPPORTED):
                cells.append(f"{cell['state']}")
            else:
                cells.append(f"{_format(cell['value'])} ({cell['state']})")
        lines.append(f"| {row['attribute']} | " + ' | '.join(cells) + ' |')
    if comparison['blocked']:
        lines += ['', '## Blocked rows', '']
        for row in comparison['blocked']:
            lines.append(f"- **{row['label']}**: {', '.join(row['reasons'])}")
    lines += ['', '## Limits', ''] + [f'- {limit}' for limit in comparison['limits']]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Score raw model runs side by side.')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--source-audio', type=Path,
                        help='master audio for preview diagnostics')
    parser.add_argument('--runs', type=Path, required=True,
                        help='JSON object mapping variant id to receipt/document/native paths')
    parser.add_argument('--interval', nargs=2, type=float)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--json', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        runs = json.loads(arguments.runs.read_text(encoding='utf-8'))
        registry = registry_module.build()
        comparison = evaluate(arguments.reference, runs,
                              interval=arguments.interval, output=arguments.output,
                              registry=registry, source_audio=arguments.source_audio)
    except (ComparisonError, registry_module.RegistryError,
            reference_contract.ReferenceError, performance.PerformanceError,
            OSError, json.JSONDecodeError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    print(json.dumps(comparison, indent=2, sort_keys=True) if arguments.json
          else markdown(comparison))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
