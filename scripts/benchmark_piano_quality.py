"""M4: evaluate candidates A/B/C against a frozen reference and emit a scorecard.

Enforced before any measured comparison:

* the reference must be a `piano-quality-reference-1` document with attribute statuses;
* every candidate that carries a performance document must declare the same source hash;
* the scored interval is applied to candidate events and to the audio comparison;
* one frozen metric configuration supplies the tolerances used by the scorers and the report.

An unavailable reference attribute is never scored as verified silence: the result is an
observation ("N notes detected"), not an accuracy claim.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

try:
    from scripts import piano_quality_events as event_scorer
    from scripts import piano_quality_expression as expression_scorer
    from scripts import piano_quality_reference as reference_contract
    from scripts import report_piano_quality as reporting
except ImportError:  # pragma: no cover - direct script execution
    import piano_quality_events as event_scorer
    import piano_quality_expression as expression_scorer
    import piano_quality_reference as reference_contract
    import report_piano_quality as reporting

CONFIG_VERSION = reference_contract.CONFIG_VERSION
ATTRIBUTE_STATUSES = reference_contract.ATTRIBUTES


class RunnerError(ValueError):
    """The candidate evaluation cannot be completed as specified."""


def _file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _reference_events(value):
    """Every reference pitch event, including uncertain ones, with its status and uncertainty.

    Detection is scored only against verified events; uncertain events define masks so a
    candidate near an unresolved note is not reported as a false extra.
    """
    return [{'id': event['id'], 'pitch': event['pitch'],
             'onset_seconds': event['onset_seconds'],
             'onset_uncertainty_seconds': event.get('onset_uncertainty_seconds', 0.0),
             'status': event.get('status', 'verified')}
            for event in value['attributes']['pitch_onset']['events']]


def load_reference(path):
    path = Path(path)
    if path.suffix.lower() in ('.mid', '.midi'):
        raise RunnerError(
            'event comparison needs a piano-quality-reference document; a bare MIDI file has '
            'no attribute status, provenance or scored interval')
    value = json.loads(path.read_text(encoding='utf-8'))
    if value.get('schema') != reference_contract.SCHEMA:
        raise RunnerError(f'{path} is not a {reference_contract.SCHEMA} document')
    reference_contract.validate(value)
    return {'reference': value, 'events': _reference_events(value),
            'statuses': {name: value['attributes'][name]['status']
                         for name in ATTRIBUTE_STATUSES},
            'source_sha256': value['source']['sha256'],
            'interval': [float(value['scored_interval'][0]),
                         float(value['scored_interval'][1])]}


def load_candidate(path):
    path = Path(path)
    if path.suffix.lower() in ('.mid', '.midi'):
        try:
            from scripts import prepare_vienna_dataset as capture
        except ImportError:  # pragma: no cover
            import prepare_vienna_dataset as capture
        try:
            events = capture.performance_events(path)
        except Exception as error:  # noqa: BLE001 - surfaced as a runner error
            raise RunnerError(f'could not read {path} as MIDI: {error}') from error
        return {'events': [{'id': note['id'], 'pitch': note['pitch'],
                            'onset_seconds': note['onset_seconds']}
                           for note in events['notes']],
                'document': {
                    'notes': [{'id': note['id'],
                               'velocity_midi': note['velocity_midi'],
                               'key_release_seconds': None,
                               'audible_end': None,
                               'legacy': None}
                              for note in events['notes']],
                    'pedal': [{'id': event['id'], 'type': event['type'],
                               'onset_seconds': event['onset_seconds'],
                               'value': event['value']}
                              for event in events['pedal']],
                },
                'path': str(path), 'source_sha256': None,
                'fields': {'pitch_onset': 'model_output',
                           'key_release': 'not_captured',
                           'velocity': 'model_output',
                           'audible_end': 'not_captured',
                           'pedal': 'model_output' if events['pedal'] else 'not_captured'}}
    value = json.loads(path.read_text(encoding='utf-8'))
    if isinstance(value, dict) and value.get('schema') == reference_contract.SCHEMA:
        return {'events': _reference_events(value), 'document': None,
                'path': str(path), 'source_sha256': None,
                'fields': {'pitch_onset': 'reference', 'key_release': 'reference',
                           'velocity': 'reference', 'audible_end': 'reference',
                           'pedal': 'reference'}}
    if isinstance(value, dict) and value.get('schema') == 'piano-performance-1':
        try:
            from scripts import piano_performance as performance
        except ImportError:  # pragma: no cover - direct script execution
            import piano_performance as performance
        document = performance.validate(value)
        events = [{'id': str(note['id']), 'pitch': note['pitch_midi'],
                   'onset_seconds': float(note['onset_seconds'])}
                  for note in document['notes']]
        fields = {
            'pitch_onset': 'model_output',
            'key_release': ('measured' if any(note.get('key_release_seconds') is not None
                                              for note in document['notes'])
                            else 'legacy_estimate' if any(
                                (note.get('legacy') or {}).get('duration_seconds')
                                for note in document['notes']) else 'not_captured'),
            'velocity': ('measured' if any(note.get('velocity_midi') is not None
                                           for note in document['notes'])
                         else 'not_captured'),
            'audible_end': ('annotated' if any(note.get('audible_end') is not None
                                               for note in document['notes'])
                            else 'not_captured'),
            'pedal': 'captured' if document['pedal'] else 'not_captured',
        }
        return {'events': events, 'document': document, 'path': str(path),
                'source_sha256': document['source'].get('sha256'), 'fields': fields}
    if isinstance(value, dict) and 'events' in value:
        events = value['events']
    elif isinstance(value, list):
        events = value
    else:
        raise RunnerError(f'{path} contains neither events nor a performance document')
    normalized, _ = event_scorer.normalize_events(events)
    return {'events': [{'id': event['id'], 'pitch': event['pitch'],
                        'onset_seconds': event['onset_seconds'],
                        'onset_uncertainty_seconds': event['onset_uncertainty_seconds']}
                       for event in normalized],
            'document': None, 'path': str(path), 'source_sha256': None,
            'fields': {name: 'model_output' for name in ATTRIBUTE_STATUSES}}


def _clip_events(events, interval):
    start, end = interval
    return [event for event in events if start <= event['onset_seconds'] <= end]


def _evaluate_candidate(name, candidate, reference, statuses, interval, tolerances):
    events = _clip_events(candidate['events'], interval)
    reference_events = reference['events']
    if statuses['pitch_onset'] == 'unavailable':
        score = event_scorer.unavailable_result(len(events))
        pairs = []
    else:
        score = event_scorer.score_events(
            reference_events, events,
            tolerance=tolerances['onset_match_seconds'],
            within=tolerances['onset_within_seconds'],
            reference_status=statuses['pitch_onset'])
        pairs = event_scorer.match_events(
            reference_events, events,
            tolerance=tolerances['onset_match_seconds'])['pairs']
    expression = None
    if candidate['document'] is not None:
        notes = expression_scorer.candidate_notes(candidate['document'])
        expression = {
            'key_release': expression_scorer.release_scores(
                reference['reference'], notes, pairs,
                tolerance=tolerances['release_seconds'],
                reference_status=statuses['key_release']),
            'audible_end': expression_scorer.audible_end_scores(
                reference['reference'], notes, pairs,
                reference_status=statuses['audible_end']),
            'velocity': expression_scorer.velocity_scores(
                reference['reference'], notes, pairs,
                tolerance=tolerances['velocity_units'],
                reference_status=statuses['velocity']),
            'pedal': [
                ({**expression_scorer.unavailable('pedal', 'candidate controller data was not captured'),
                  'pedal_type': pedal_type}
                 if candidate.get('fields', {}).get('pedal') == 'not_captured'
                 else expression_scorer.pedal_scores(
                    reference['reference'],
                    expression_scorer.candidate_pedal(candidate['document'], pedal_type),
                    interval, pedal_type=pedal_type,
                    tolerance=tolerances['pedal_seconds'],
                    reference_status=statuses['pedal']))
                for pedal_type in expression_scorer.PEDAL_TYPES
                if any(event['type'] == pedal_type
                       for event in reference['reference']['attributes']['pedal']['events'])
            ],
        }
    return {'name': name, 'score': score, 'pairs': pairs, 'expression': expression,
            'detected': len(events)}


def _audio_comparison(source_audio, candidates, baseline, final, renderer, interval, warnings):
    try:
        from scripts import piano_reconstruction_harness as harness
        import scripts.piano_render as render
    except ImportError:  # pragma: no cover
        import piano_reconstruction_harness as harness
        import piano_render as render
    renderer = renderer or render.get_renderer()
    results = {}
    qualification = None

    def measure(identifier, fixed_gain_db=None):
        candidate = candidates.get(identifier) or {}
        path = candidate.get('path')
        if not path or not candidate.get('document'):
            return None
        try:
            report = harness.run(source_audio, path, None, renderer=renderer,
                                 interval=interval, fixed_gain_db=fixed_gain_db)
        except (harness.HarnessError, render.RenderError) as error:
            warnings.append(f'audio comparison for {identifier} failed: {error}')
            return None
        normalized = report['objective']['delivered']['normalized']
        absolute = report['objective']['delivered']['absolute']
        summary = {
            'objective': normalized['objective'],
            'components': normalized['components'],
            'raw_components': normalized.get('raw_components'),
            'gain_db': normalized.get('gain_db'),
            'fixed_gain_db': fixed_gain_db,
            'complete': normalized.get('complete'),
            'absolute_objective': absolute['objective'],
            'interval': normalized['interval'],
            'render_sha256': report['output']['delivered']['sha256'],
            'renderer': report['renderer']['name'],
            'renderer_version': report['renderer']['version'],
            'qualification': report['qualification']['valid_for_qualification'],
        }
        if not report['qualification']['valid_for_qualification']:
            warnings.append(f'audio comparison for {identifier} is diagnostic only')
        return summary, report['qualification']

    baseline_result = measure(baseline)
    if baseline_result:
        results[baseline], qualification = baseline_result
    final_result = measure(final)
    if final_result:
        results[final], qualification = final_result
    # Frozen common-gain view: the same gain applied to every candidate, so a fitted per-clip
    # gain cannot hide a level error.
    if results.get(baseline) and results.get(final):
        common = measure(final, fixed_gain_db=results[baseline]['gain_db'])
        if common:
            results[final]['common_gain_db'] = results[baseline]['gain_db']
            results[final]['common_gain_objective'] = common[0]['objective']
            results[final]['common_gain_components'] = common[0]['components']
    return {'baseline': results.get(baseline), 'final': results.get(final),
            'renderer': {'name': renderer.name, 'version': renderer.version,
                         'asset_sha256': getattr(renderer, 'asset_sha256', None)},
            'qualification': qualification,
            'diagnostic_only': True,
            'reasons': ['audio comparison is diagnostic while the renderer is approximate']}


def evaluate(reference_path, candidate_paths, *, baseline='A', final=None, output=None,
             source_audio=None, renderer=None, scorecard_id=None, tolerances=None,
             allow_config_override=False):
    """Evaluate every candidate against the reference and build the scorecard."""
    loaded_reference = load_reference(reference_path)
    reference = loaded_reference['reference']
    interval = loaded_reference['interval']
    statuses = loaded_reference['statuses']

    if tolerances is not None and dict(tolerances) != dict(reference_contract.TOLERANCES):
        if not allow_config_override:
            raise RunnerError(
                'the supplied tolerances differ from the frozen metric configuration; pass '
                'allow_config_override to record a deliberate override')
    config = {'version': CONFIG_VERSION,
              'tolerances': dict(tolerances or reference_contract.TOLERANCES)}
    thresholds = config['tolerances']

    if baseline not in candidate_paths:
        raise RunnerError(f'baseline candidate {baseline!r} is not among the supplied candidates')
    if final is not None and final not in candidate_paths:
        raise RunnerError(f'final candidate {final!r} is not among the supplied candidates')

    candidates = {identifier: load_candidate(path)
                  for identifier, path in candidate_paths.items()}

    source_verified = True
    for identifier, candidate in candidates.items():
        declared = candidate.get('source_sha256')
        if declared is not None and declared != loaded_reference['source_sha256']:
            raise RunnerError(
                f'candidate {identifier} was built against a different source '
                f'({declared[:12]}... vs {loaded_reference["source_sha256"][:12]}...)')
        if declared is None:
            source_verified = False

    if source_audio is not None:
        if _file_sha256(source_audio) != loaded_reference['source_sha256']:
            raise RunnerError('the supplied source audio does not match the reference source hash')

    evaluation = {identifier: _evaluate_candidate(identifier, candidate, loaded_reference,
                                                  statuses, interval, thresholds)
                  for identifier, candidate in candidates.items()}
    final_id = final or baseline
    warnings = []
    if final is None:
        warnings.append('no corrected candidate was supplied; improvement is not established')
    for identifier, candidate in candidates.items():
        if candidate['document'] is None:
            warnings.append(f'candidate {identifier} has no performance document; expression '
                            'attributes are unavailable for it')
    if not source_verified:
        warnings.append('at least one candidate has no source identity; measured comparisons '
                        'are diagnostic only')

    audio = None
    if source_audio is not None:
        audio = _audio_comparison(source_audio, candidates, baseline, final_id, renderer,
                                  interval, warnings)
    else:
        warnings.append('no source audio was supplied; audio comparison was not run')

    scorecard = reporting.build(
        reference=reference,
        candidates={identifier: {'path': candidate['path'],
                                 'sha256': _file_sha256(candidate['path']),
                                 'fields': candidate['fields'],
                                 'source_sha256': candidate.get('source_sha256')}
                    for identifier, candidate in candidates.items()},
        baseline_events=evaluation[baseline]['score'],
        final_events=evaluation[final_id]['score'],
        baseline_expression=evaluation[baseline]['expression'],
        final_expression=evaluation[final_id]['expression'],
        audio=audio, warnings=warnings, tolerances=thresholds,
        scorecard_id=scorecard_id or f'scorecard-{int(time.time())}',
        source_verified=source_verified,
        metric_config={'version': CONFIG_VERSION, 'tolerances': thresholds,
                       'materiality': reporting.MATERIALITY})
    scorecard['reference']['sha256'] = reference_contract.reference_sha256(reference)
    scorecard['baseline_candidate'] = baseline
    scorecard['final_candidate'] = final_id
    scorecard['scored_interval'] = interval
    scorecard['attribute_statuses'] = statuses
    scorecard['detected_notes'] = {name: record['detected']
                                   for name, record in evaluation.items()}
    scorecard['implementation'] = {
        'events': _implementation_sha(event_scorer.__file__),
        'expression': _implementation_sha(expression_scorer.__file__),
        'reference': _implementation_sha(reference_contract.__file__),
        'report': _implementation_sha(reporting.__file__),
    }

    gains = [value for name, value in scorecard['outcomes'].items()
             if name not in ('audio', 'listening')]
    descriptive = (final is not None and 'improved' in gains and 'regressed' not in gains
                   and not scorecard['damage']['damaged'] and source_verified)
    scorecard['descriptive_improvement'] = descriptive
    scorecard['improvement_established'] = descriptive
    scorecard['qualification_established'] = False
    scorecard['activation_authorized'] = False
    if scorecard['damage']['damaged']:
        scorecard['warnings'].append('event damage detected: a new missing/extra note or lost '
                                     'match blocks any improvement claim')
    if final is None:
        for name in ('pitch_onset', 'rhythm', 'key_release', 'audible_end', 'velocity',
                     'pedal'):
            scorecard['outcomes'][name] = 'insufficient_evidence'

    if output:
        output = Path(output)
        reporting.write(scorecard, output / 'scorecard.json', output / 'scorecard.md')
    return scorecard


def _implementation_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description='Evaluate A/B/C candidates and score them.')
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--candidate', action='append', default=[],
                        metavar='ID=PATH', help='candidate identifier and path, repeatable')
    parser.add_argument('--baseline', default='A')
    parser.add_argument('--final')
    parser.add_argument('--source-audio', type=Path)
    parser.add_argument('--output', type=Path)
    arguments = parser.parse_args(argv)
    if not arguments.candidate:
        parser.error('at least one --candidate ID=PATH is required')
    candidate_paths = {}
    for item in arguments.candidate:
        if '=' not in item:
            parser.error('--candidate expects ID=PATH')
        identifier, path = item.split('=', 1)
        candidate_paths[identifier] = Path(path)
    try:
        scorecard = evaluate(arguments.reference, candidate_paths,
                             baseline=arguments.baseline, final=arguments.final,
                             output=arguments.output, source_audio=arguments.source_audio)
    except (RunnerError, reference_contract.ReferenceError, event_scorer.ScorerError,
            json.JSONDecodeError, OSError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    print(reporting.markdown(scorecard))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
