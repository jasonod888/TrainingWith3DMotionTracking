"""M6: `piano-quality-scorecard-1` — before/after evidence that cannot claim unknown success.

Rules this module enforces:

* an unavailable reference is `not_measured`; detected events are an observation, not a result;
* a new missing/extra note is damage and blocks any improvement claim, independent of F1 deadbands;
* metric-change thresholds are per metric and carry their own units;
* audio and listening evidence stay diagnostic/absent until real evidence exists;
* conditional rates are reported beside all-reference population rates.

No overall fidelity percentage is defined or reported.
"""
import argparse
import json
import sys
import time
from pathlib import Path

SCHEMA = 'piano-quality-scorecard-1'
STATUSES = ('not_measured', 'unscorable', 'diagnostic_only', 'measured',
            'qualified_for_scope')
OUTCOMES = ('improved', 'unchanged', 'regressed', 'insufficient_evidence')
DIRECTIONS = ('higher_is_better', 'lower_is_better')

# Metric-change materiality, in each metric's own units. Distinct from the matching tolerance.
MATERIALITY = {
    'f1': 0.002,
    'precision': 0.002,
    'recall': 0.002,
    'rate': 0.002,
    'seconds': 0.001,
    'midi_units': 0.5,
    'objective': 0.001,
    'points_0_100': 1.0,
}
MINIMUM_AUDIO_IMPROVEMENT = 0.10


class ScorecardError(ValueError):
    """The scorecard cannot be built as specified."""


def metric(*, name, version, units, direction, status, baseline=None, final=None,
           tolerance=None, materiality=None, denominator=None, coverage=None, reasons=(),
           scope=None, evidence=None, reference_status='verified'):
    if status not in STATUSES:
        raise ScorecardError(f'unsupported status {status!r}')
    if direction not in DIRECTIONS:
        raise ScorecardError(f'unsupported direction {direction!r}')
    for label, value in (('baseline', baseline), ('final', final)):
        if value is not None and not isinstance(value, (int, float)):
            raise ScorecardError(f'{name}: {label} must be numeric or null')
    absolute = (None if baseline is None or final is None else final - baseline)
    relative = None
    if absolute is not None and baseline not in (None, 0):
        relative = absolute / abs(baseline)
    return {'name': name, 'version': version, 'units': units, 'direction': direction,
            'tolerance': tolerance,
            'materiality': materiality if materiality is not None else MATERIALITY.get(units),
            'status': status, 'reference_status': reference_status,
            'baseline': baseline, 'final': final,
            'absolute_change': absolute, 'relative_change': relative,
            'denominator': denominator, 'coverage': coverage or {},
            'reasons': list(reasons), 'scope': scope, 'evidence': evidence}


def outcome(baseline, final, direction, materiality):
    if baseline is None or final is None:
        return 'insufficient_evidence'
    delta = float(final) - float(baseline)
    if abs(delta) <= float(materiality or 0.0):
        return 'unchanged'
    better = delta > 0 if direction == 'higher_is_better' else delta < 0
    return 'improved' if better else 'regressed'


def event_damage(baseline, final):
    """Damage is decided by event identities, not by net counts.

    Recovering one note while losing another leaves the totals unchanged, so the matched
    reference ids, the missing ids and the extra candidate ids are compared directly.
    """
    empty = {'damaged': False, 'lost_reference_ids': [], 'recovered_reference_ids': [],
             'new_extra_ids': [], 'new_missing': None, 'new_extra': None,
             'lost_matches': None}
    if not baseline or not final:
        return empty
    if (baseline.get('matched') is None or final.get('matched') is None):
        return empty
    base_matched = set(baseline.get('matched_reference_ids') or [])
    final_matched = set(final.get('matched_reference_ids') or [])
    base_extra = set(baseline.get('extra_candidate_ids') or [])
    final_extra = set(final.get('extra_candidate_ids') or [])
    lost = sorted(base_matched - final_matched)
    recovered = sorted(final_matched - base_matched)
    new_extra = sorted(final_extra - base_extra)
    return {'damaged': bool(lost or new_extra),
            'lost_reference_ids': lost[:50],
            'recovered_reference_ids': recovered[:50],
            'new_extra_ids': new_extra[:50],
            'new_missing': (final.get('missing') or 0) - (baseline.get('missing') or 0),
            'new_extra': (final.get('extra') or 0) - (baseline.get('extra') or 0),
            'lost_matches': (baseline.get('matched') or 0) - (final.get('matched') or 0)}


def expression_damage(baseline, final):
    """A value measured before and absent afterwards is damage, not an improvement."""
    if not baseline or not final:
        return None
    base_measured = set(baseline.get('measured_note_ids') or [])
    final_measured = set(final.get('measured_note_ids') or [])
    base_errors = baseline.get('errors') or {}
    final_errors = final.get('errors') or {}
    lost = sorted(base_measured - final_measured)
    gained = sorted(final_measured - base_measured)
    common = sorted(set(base_errors) & set(final_errors))

    def mean_absolute(errors, ids):
        values = [abs(float(errors[identifier])) for identifier in ids]
        return None if not values else sum(values) / len(values)

    return {'damaged': bool(lost), 'lost_value_ids': lost[:50],
            'gained_value_ids': gained[:50], 'common_notes': len(common),
            'common_mae_baseline': mean_absolute(base_errors, common),
            'common_mae_final': mean_absolute(final_errors, common)}


def _event_metrics(baseline, final, tolerances, alignment_verified=True, source_verified=True):
    if final is None:
        return [metric(name='pitch_onset_f1', version='piano-event-metrics-2', units='f1',
                       direction='higher_is_better', status='not_measured',
                       reasons=['no event comparison was produced'])]
    status = final.get('reference_status', 'verified')
    if status == 'unavailable':
        return [metric(name='pitch_onset_f1', version=final['metric_version'], units='f1',
                       direction='higher_is_better', status='not_measured',
                       reference_status='unavailable',
                       coverage={'detected_notes': final.get('detected_notes')},
                       reasons=['reference pitch/onset is unavailable; detected notes are an '
                                'observation, not a correctness result'])]
    applicable = bool(final.get('applicable'))
    if not applicable:
        base_status = 'unscorable'
    elif not alignment_verified or not source_verified:
        base_status = 'diagnostic_only'
    else:
        base_status = 'measured'
    reasons = ([] if applicable else ['no scored notes on either side'])
    if not alignment_verified:
        reasons.append('alignment is not independently verified')
    if not source_verified:
        reasons.append('candidate source identity is not verified against the reference')

    rows = [metric(
        name='pitch_onset_f1', version=final['metric_version'], units='f1',
        direction='higher_is_better', tolerance=tolerances['onset_match_seconds'],
        status=base_status, reference_status=status,
        baseline=None if not baseline else baseline.get('f1'), final=final.get('f1'),
        denominator={'reference': final['reference_count'],
                     'candidate': final['candidate_count']},
        coverage={'matched': final['matched'], 'missing': final['missing'],
                  'extra': final['extra'], 'masked_extra': final.get('masked_extra'),
                  'ambiguous_reference': final.get('ambiguous_reference'),
                  'all_reference_within_tolerance':
                      final.get('all_reference_within_tolerance')},
        reasons=reasons, scope='exact-pitch, 50 ms onset window')]
    for name, key, units in (('pitch_precision', 'precision', 'precision'),
                             ('pitch_recall', 'recall', 'recall')):
        rows.append(metric(
            name=name, version=final['metric_version'], units=units,
            direction='higher_is_better', status=base_status, reference_status=status,
            baseline=None if not baseline else baseline.get(key), final=final.get(key),
            denominator={'candidate': final['candidate_count']} if key == 'precision'
            else {'reference': final['reference_count']},
            reasons=reasons, scope='conditional on the scored population'))
    rows.append(metric(
        name='onset_mae_seconds', version=final['metric_version'], units='seconds',
        direction='lower_is_better', tolerance=tolerances['onset_within_seconds'],
        status=base_status if final.get('matched') else 'unscorable', reference_status=status,
        baseline=None if not baseline else baseline.get('onset_mae_seconds'),
        final=final.get('onset_mae_seconds'), denominator={'matched': final['matched']},
        coverage={'conditioned_on_matching': True,
                  'matched_within_tolerance': final.get('matched_within_tolerance'),
                  'all_reference_within_tolerance':
                      final.get('all_reference_within_tolerance')},
        reasons=reasons, scope='matched, timing-scorable notes only'))
    for name, key in (('onset_p95_absolute_seconds', 'onset_p95_absolute_seconds'),
                      ('onset_bias_seconds', 'onset_bias_seconds')):
        rows.append(metric(
            name=name, version=final['metric_version'], units='seconds',
            direction='lower_is_better' if 'p95' in name else 'lower_is_better',
            status=base_status if final.get('matched') else 'unscorable',
            reference_status=status,
            baseline=None if not baseline else baseline.get(key), final=final.get(key),
            denominator={'matched': final['matched']}, reasons=reasons,
            scope='matched, timing-scorable notes only'))
    rows.append(metric(
        name='all_reference_within_tolerance', version=final['metric_version'], units='rate',
        direction='higher_is_better', status=base_status, reference_status=status,
        baseline=None if not baseline else baseline.get('all_reference_within_tolerance'),
        final=final.get('all_reference_within_tolerance'),
        denominator={'scorable_reference': final.get('scorable_reference')},
        reasons=reasons, scope='missed and ambiguous notes counted as failures'))
    return rows


def build(*, reference, candidates, baseline_events=None, final_events=None,
          baseline_expression=None, final_expression=None, audio=None,
          listening=None, warnings=(), tolerances=None, scorecard_id=None,
          alignment_verified=None, source_verified=True, metric_config=None):
    """Assemble the scorecard from measured pieces; unsupported pieces stay explicit."""
    tolerances = dict(tolerances or (metric_config or {}).get('tolerances') or {})
    tolerances.setdefault('onset_match_seconds', 0.050)
    tolerances.setdefault('onset_within_seconds', 0.020)
    tolerances.setdefault('release_seconds', 0.080)
    tolerances.setdefault('velocity_units', 8)
    tolerances.setdefault('pedal_seconds', 0.050)
    if alignment_verified is None:
        alignment_verified = bool(
            reference.get('timeline', {}).get('video_to_analysis', {}).get('verified'))
    if not alignment_verified:
        warnings = list(warnings) + [
            'reference alignment is not independently verified; timing results are diagnostic']

    event_rows = _event_metrics(baseline_events, final_events, tolerances,
                                alignment_verified=alignment_verified,
                                source_verified=source_verified)
    categories = {'pitch_onset': event_rows,
                  'rhythm': [row for row in event_rows
                             if row['name'] in ('onset_mae_seconds',
                                                'onset_p95_absolute_seconds',
                                                'onset_bias_seconds',
                                                'all_reference_within_tolerance')]}
    baseline_expression = baseline_expression or {}
    final_expression = final_expression or {}

    def simple(prefix, result_name, units, direction, key, field, tolerance,
               *, result_override=None, baseline_override=None):
        result = (final_expression.get(result_name) or {}) if result_override is None else result_override
        reference_status = result.get('reference_status', 'unavailable')
        status = result.get('status', 'unscorable')
        if not result.get('applicable', False):
            status = 'unscorable'
        elif (not alignment_verified or not source_verified) and status == 'measured':
            status = 'diagnostic_only'
        reasons = list(result.get('reasons') or [])
        if not source_verified:
            reasons.append('candidate source identity is not verified against the reference')
        baseline_value = None
        baseline_result = (baseline_expression.get(result_name) or {}) if baseline_override is None else baseline_override
        if baseline_result:
            baseline_value = baseline_result.get(field)
        return metric(name=prefix, version=result.get('metric_version',
                                                      'piano-expression-metrics-1'),
                      units=units, direction=direction, tolerance=tolerance,
                      status=status, reference_status=reference_status,
                      baseline=baseline_value, final=result.get(field),
                      denominator={'reference_population': result.get('reference_population')},
                      coverage={key_: result.get(key_) for key_ in
                                ('n', 'unmatched', 'missing_candidate_release',
                                 'missing_candidate_velocity', 'abstained_uncertain_end',
                                 'outside_interval_mean_seconds',
                                 'interval_error_mean_seconds',
                                 'candidate_interval_width_mean_seconds',
                                 'time_weighted_agreement', 'false_on_seconds',
                                 'false_off_seconds', 'within_tolerance_rate',
                                 'all_reference_within_tolerance')
                                if result.get(key_) is not None},
                      reasons=reasons)

    def common_row(prefix, result_name, units):
        damage_record = expression_damage(baseline_expression.get(result_name),
                                          final_expression.get(result_name))
        if not damage_record or not damage_record['common_notes']:
            return metric(name=prefix, units=units, version='piano-expression-metrics-1',
                          direction='lower_is_better', status='unscorable',
                          reasons=['no common measured notes between baseline and final'])
        status = 'measured' if (alignment_verified and source_verified) else 'diagnostic_only'
        return metric(name=prefix, version='piano-expression-metrics-1', units=units,
                      direction='lower_is_better', status=status,
                      baseline=damage_record['common_mae_baseline'],
                      final=damage_record['common_mae_final'],
                      denominator={'common_notes': damage_record['common_notes']},
                      coverage={'lost_value_ids': damage_record['lost_value_ids'],
                                'gained_value_ids': damage_record['gained_value_ids']},
                      reasons=([] if status == 'measured' else
                               ['timing or source identity is not verified']))

    categories['key_release'] = [
        simple('release_mae_seconds', 'key_release', 'seconds', 'lower_is_better',
               'key_release_mae', 'mae', tolerances['release_seconds']),
        common_row('release_common_mae_seconds', 'key_release', 'seconds'),
        simple('release_p95_absolute_seconds', 'key_release', 'seconds', 'lower_is_better',
               'release_p95', 'p95_absolute', tolerances['release_seconds']),
        simple('release_bias_seconds', 'key_release', 'seconds', 'lower_is_better',
               'release_bias', 'bias', tolerances['release_seconds']),
        simple('release_all_reference_within_tolerance', 'key_release', 'rate',
               'higher_is_better', 'key_release_rate', 'all_reference_within_tolerance',
               tolerances['release_seconds']),
    ]
    categories['audible_end'] = [
        simple('audible_end_inside_rate', 'audible_end', 'rate', 'higher_is_better',
               'audible_end_rate', 'inside_interval_rate', None),
        simple('audible_end_interval_error_mean_seconds', 'audible_end', 'seconds',
               'lower_is_better', 'audible_end_interval_error', 'interval_error_mean_seconds',
               None),
        simple('audible_end_outside_interval_mean_seconds', 'audible_end', 'seconds',
               'lower_is_better', 'audible_end_outside', 'outside_interval_mean_seconds',
               None),
    ]
    categories['velocity'] = [
        simple('velocity_mae_units', 'velocity', 'midi_units', 'lower_is_better',
               'velocity_mae', 'mae', tolerances['velocity_units']),
        common_row('velocity_common_mae_units', 'velocity', 'midi_units'),
        simple('velocity_p95_absolute_units', 'velocity', 'midi_units', 'lower_is_better',
               'velocity_p95', 'p95_absolute', tolerances['velocity_units']),
        simple('velocity_bias_units', 'velocity', 'midi_units', 'lower_is_better',
               'velocity_bias', 'bias', tolerances['velocity_units']),
        simple('velocity_all_reference_within_tolerance', 'velocity', 'rate',
               'higher_is_better', 'velocity_rate', 'all_reference_within_tolerance',
               tolerances['velocity_units']),
    ]
    pedal_results = final_expression.get('pedal')
    if isinstance(pedal_results, dict):
        pedal_results = [pedal_results]
    pedal_results = pedal_results or []
    baseline_pedal = baseline_expression.get('pedal') or []
    if isinstance(baseline_pedal, dict):
        baseline_pedal = [baseline_pedal]
    categories['pedal'] = [
        simple(f'pedal_{result.get("pedal_type", "sustain")}_f1',
               'pedal', 'f1', 'higher_is_better',
               f'pedal_{result.get("pedal_type", "sustain")}', 'f1',
               tolerances['pedal_seconds'], result_override=result,
               baseline_override=next((item for item in baseline_pedal
                                       if item.get('pedal_type', 'sustain') ==
                                       result.get('pedal_type', 'sustain')), {}))
        for result in pedal_results if isinstance(result, dict)
    ] or [metric(name='pedal_f1', version='piano-expression-metrics-1', units='f1',
                 direction='higher_is_better', status='not_measured',
                 reasons=['no captured controller reference'])]

    if audio is None:
        categories['audio'] = [metric(
            name='reconstruction_objective', version='piano-reconstruction-objective-2',
            units='objective', direction='lower_is_better', status='not_measured',
            reasons=['no delivered-audio comparison was produced'])]
    else:
        final_audio = audio.get('final') or {}
        baseline_audio = audio.get('baseline') or {}
        categories['audio'] = [metric(
            name='reconstruction_objective', version='piano-reconstruction-objective-2',
            units='objective', direction='lower_is_better',
            status='diagnostic_only' if final_audio else 'not_measured',
            baseline=baseline_audio.get('objective'), final=final_audio.get('objective'),
            coverage={'components': final_audio.get('components'),
                      'baseline_components': baseline_audio.get('components'),
                      'absolute_objective': final_audio.get('absolute_objective'),
                      'baseline_absolute_objective': baseline_audio.get('absolute_objective'),
                      'gain_db': final_audio.get('gain_db'),
                      'baseline_gain_db': baseline_audio.get('gain_db'),
                      'common_gain_db': final_audio.get('common_gain_db'),
                      'common_gain_objective': final_audio.get('common_gain_objective'),
                      'common_gain_components': final_audio.get('common_gain_components'),
                      'complete': final_audio.get('complete'),
                      'baseline_complete': baseline_audio.get('complete'),
                      'interval': final_audio.get('interval'),
                      'render_sha256': final_audio.get('render_sha256'),
                      'baseline_render_sha256': baseline_audio.get('render_sha256'),
                      'renderer': audio.get('renderer'),
                      'qualification': audio.get('qualification')},
            reasons=audio.get('reasons') or ['audio comparison is diagnostic only'])]

    if listening is None:
        categories['listening'] = [metric(
            name='listening_similarity', version='piano-listening-analysis-2',
            units='points_0_100', direction='higher_is_better', status='not_measured',
            reasons=['no listener sessions were collected'])]
    else:
        categories['listening'] = [metric(
            name='listening_similarity', version='piano-listening-analysis-2',
            units='points_0_100', direction='higher_is_better',
            status='measured' if listening.get('adequate') else 'unscorable',
            baseline=None, final=listening.get('mean'),
            denominator={'listeners': listening.get('listeners'),
                         'performances': listening.get('performances'),
                         'performers': listening.get('performers')},
            reasons=[] if listening.get('adequate')
            else ['too few independent listeners or performances'])]
        if listening.get('mean_gain_points') is not None:
            categories['listening'].append(metric(
                name='listening_gain_points', version='piano-listening-analysis-2',
                units='points_0_100', direction='higher_is_better',
                status='measured' if listening.get('adequate') else 'diagnostic_only',
                baseline=0.0, final=listening['mean_gain_points'],
                coverage={'ci_low': listening.get('ci_low'),
                          'ci_high': listening.get('ci_high'),
                          'baseline_role': listening.get('baseline_role'),
                          'candidate_role': listening.get('candidate_role'),
                          'top_unit': listening.get('top_unit')},
                reasons=[] if listening.get('adequate')
                else ['too few independent listeners or performances']))

    damage = event_damage(baseline_events, final_events)
    expression_damages = {
        name: expression_damage(baseline_expression.get(name), final_expression.get(name))
        for name in ('key_release', 'velocity', 'audible_end')}
    outcomes = {}
    for name, metrics in categories.items():
        primary = metrics[0] if metrics else None
        if primary is None or primary['status'] not in ('measured', 'qualified_for_scope'):
            outcomes[name] = 'insufficient_evidence'
        else:
            outcomes[name] = outcome(primary['baseline'], primary['final'],
                                     primary['direction'], primary['materiality'])
    if damage['damaged']:
        outcomes['pitch_onset'] = 'regressed'
        outcomes['rhythm'] = 'regressed'
    for name in ('key_release', 'velocity', 'audible_end'):
        record = expression_damages.get(name)
        if not record:
            continue
        if record['damaged']:
            outcomes[name] = 'regressed'
        elif record['common_notes']:
            common_columns = {'key_release': 'release_common_mae_seconds',
                              'velocity': 'velocity_common_mae_units'}
            column = common_columns.get(name)
            row = next((item for item in categories.get(name, [])
                        if item['name'] == column), None)
            if row and row['status'] in ('measured', 'diagnostic_only'):
                outcomes[name] = outcome(record['common_mae_baseline'],
                                         record['common_mae_final'], 'lower_is_better',
                                         row['materiality'] or 0.0)

    scorecard = {
        'schema': SCHEMA,
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'scorecard_id': scorecard_id,
        'reference': {'reference_id': reference['reference_id'],
                      'sha256': reference.get('sha256'),
                      'split': reference['split'],
                      'scored_interval': reference['scored_interval'],
                      'alignment_verified':
                          reference['timeline']['video_to_analysis']['verified'],
                      'rights': reference['rights']['status'],
                      'attributes': {name: reference['attributes'][name]['status']
                                     for name in reference['attributes']}},
        'candidates': candidates,
        'source_verified': source_verified,
        'metric_config': metric_config,
        'tolerances': tolerances,
        'materiality': dict(MATERIALITY),
        'categories': categories,
        'damage': {'event': damage, 'expression': expression_damages,
                   'damaged': damage['damaged'] or any(
                       record and record['damaged']
                       for record in expression_damages.values())},
        'outcomes': outcomes,
        'descriptive_only': True,
        'qualification_established': False,
        'warnings': list(warnings),
        'limits': ['A single clip is descriptive; it is not a population estimate.',
                   'Corpus qualification requires the acceptance gates and untouched data.',
                   'No overall fidelity percentage is defined or reported.'],
    }
    scorecard['questions'] = answers(scorecard)
    return scorecard


def _format(value, units):
    if value is None:
        return 'n/a'
    if units == 'rate':
        return f'{100 * value:.1f}%'
    if units == 'seconds':
        return f'{1000 * value:.1f} ms'
    if units == 'midi_units':
        return f'{value:.1f} units'
    if units in ('f1', 'precision', 'recall'):
        return f'{value:.3f}'
    if units == 'points_0_100':
        return f'{value:.1f} / 100'
    return f'{value:.4f}'


def answers(scorecard):
    """Answer the seven questions from measured rows, never inventing a value."""
    categories = scorecard['categories']

    def rows(name):
        return categories.get(name) or []

    def first(name):
        metrics = rows(name)
        return metrics[0] if metrics else None

    def describe(value, units):
        if value is None:
            return 'not measured'
        return (f"{_format(value['baseline'], units)} to {_format(value['final'], units)} "
                f"({value['status']})")

    pitch = first('pitch_onset')
    rhythm = next((row for row in rows('rhythm') if row['name'] == 'onset_mae_seconds'),
                  first('rhythm'))
    all_reference_row = next((row for row in rows('rhythm')
                              if row['name'] == 'all_reference_within_tolerance'), None)
    release = first('key_release')
    ending = first('audible_end')
    velocity = first('velocity')
    pedal = first('pedal')
    sound = first('audio')
    listening = first('listening')

    if pitch and pitch['reference_status'] == 'unavailable':
        pitch_answer = (f"{pitch['coverage'].get('detected_notes')} notes detected; correctness "
                        'unknown because the reference pitch/onset is unavailable')
    elif pitch and pitch['status'] in ('measured', 'diagnostic_only'):
        pitch_answer = (f"F1 {describe(pitch, 'f1')}; missing "
                        f"{pitch['coverage'].get('missing')}, extra "
                        f"{pitch['coverage'].get('extra')}; damage "
                        f"{'yes' if scorecard['damage']['damaged'] else 'no'}")
    else:
        pitch_answer = 'not measured: no independent pitch/onset reference at this interval'

    return [
        {'question': 'Are the notes better?', 'answer': pitch_answer},
        {'question': 'Is rhythm closer?',
         'answer': (f"onset MAE {describe(rhythm, 'seconds')}; all-reference within tolerance "
                    f"{_format(all_reference_row['final'] if all_reference_row else None, 'rate')}"
                    if rhythm and rhythm['status'] != 'not_measured'
                    else 'not measured: no independent onset reference')},
        {'question': 'Are lengths closer?',
         'answer': (f"key release {describe(release, 'seconds')}; audible end inside "
                    f"{_format(ending['final'] if ending else None, 'rate')}"
                    if release and release['status'] not in ('not_measured', 'unscorable')
                    else 'not measured: physical release and audible endings are unavailable')},
        {'question': 'Are dynamics closer?',
         'answer': (f"velocity {describe(velocity, 'midi_units')}"
                    if velocity and velocity['status'] not in ('not_measured', 'unscorable')
                    else 'not measured: no captured MIDI velocity reference')},
        {'question': 'Does pedal match?',
         'answer': (f"{describe(pedal, 'f1')}"
                    if pedal and pedal['status'] not in ('not_measured', 'unscorable')
                    else 'not measured: no captured controller reference')},
        {'question': 'Does it sound closer?',
         'answer': (f"audio objective {describe(sound, 'objective')}; listening "
                    f"{listening['status'] if listening else 'not measured'}"
                    if sound and sound['status'] != 'not_measured'
                    else 'not measured: no delivered-audio comparison or listener evidence')},
        {'question': 'What percentage matches?',
         'answer': ('No overall fidelity percentage is defined. Scoped event and tolerance '
                    'percentages appear above; they are not a probability of identical sound.')},
    ]


def markdown(scorecard):
    lines = ['# Piano reconstruction quality scorecard', '',
             f"Reference: `{scorecard['reference']['reference_id']}` "
             f"({scorecard['reference']['split']}), interval "
             f"{scorecard['reference']['scored_interval']}.",
             'Descriptive single-clip report; corpus qualification is not established.', '',
             '| category | metric | baseline | final | status | outcome |',
             '|---|---|---|---|---|---|']
    for name, metrics in scorecard['categories'].items():
        for metric_value in metrics:
            lines.append(
                f"| {name} | {metric_value['name']} "
                f"| {_format(metric_value['baseline'], metric_value['units'])} "
                f"| {_format(metric_value['final'], metric_value['units'])} "
                f"| {metric_value['status']} | {scorecard['outcomes'].get(name)} |")
    damage = scorecard.get('damage') or {}
    if damage.get('damaged'):
        event = damage.get('event') or {}
        lines += ['', '**Damage detected.**']
        if event.get('lost_reference_ids'):
            lines.append(f"- lost reference notes: {event['lost_reference_ids'][:8]}")
        if event.get('new_extra_ids'):
            lines.append(f"- new extra candidates: {event['new_extra_ids'][:8]}")
        for name, record in (damage.get('expression') or {}).items():
            if record and record.get('damaged'):
                lines.append(f"- {name}: lost value(s) {record['lost_value_ids'][:8]}")
    lines += ['', '## Answers', '']
    for entry in scorecard['questions']:
        lines.append(f"**{entry['question']}** {entry['answer']}")
        lines.append('')
    if scorecard.get('warnings'):
        lines += ['## Warnings', ''] + [f'- {warning}' for warning in scorecard['warnings']]
        lines.append('')
    lines += ['## Limits', ''] + [f'- {limit}' for limit in scorecard['limits']]
    return '\n'.join(lines) + '\n'


def write(scorecard, json_path=None, markdown_path=None):
    if json_path:
        Path(json_path).parent.mkdir(parents=True, exist_ok=True)
        Path(json_path).write_text(json.dumps(scorecard, indent=2, sort_keys=True),
                                   encoding='utf-8')
    if markdown_path:
        Path(markdown_path).parent.mkdir(parents=True, exist_ok=True)
        Path(markdown_path).write_text(markdown(scorecard), encoding='utf-8')
    return scorecard


def main(argv=None):
    parser = argparse.ArgumentParser(description='Render a piano quality scorecard.')
    parser.add_argument('--scorecard', type=Path, required=True)
    parser.add_argument('--json', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        scorecard = json.loads(arguments.scorecard.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    if scorecard.get('schema') != SCHEMA:
        print(f'error: unsupported scorecard schema {scorecard.get("schema")!r}',
              file=sys.stderr)
        return 2
    print(json.dumps(scorecard, indent=2, sort_keys=True) if arguments.json
          else markdown(scorecard))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
