"""W3: analyse listening sessions with clustered uncertainty and predeclared exclusions.

Guards before any arithmetic:

* the expected study identity is required, and every submission must declare it;
* each expected ``(item, label)`` may be rated exactly once;
* duplicate submissions from one listener are quarantined, not counted twice;
* timestamps and session duration must be valid, so a missing duration cannot bypass the cap.

Improvement is reported as a **paired** difference over the same listener/excerpt cells with a
clustered interval. A post-hoc pick of the best role is labelled exploratory, and conclusions
are suppressed when independent listeners or excerpts are too few.
"""
import argparse
import hashlib
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

try:  # prefer the package path so error classes have one identity under pytest
    from scripts import build_listening_study as study_builder
except ImportError:  # pragma: no cover - direct script execution
    import build_listening_study as study_builder

RATINGS_SCHEMA = 'piano-listening-ratings-1'
STUDY_SCHEMA = 'piano-listening-study-1'
REPORT_SCHEMA = 'piano-listening-report-1'
ANALYSIS_VERSION = 'piano-listening-analysis-2'
DEFAULT_ITERATIONS = 2000
DEFAULT_SEED = 20261112
DEFAULT_MINIMUM_LISTENERS = 5
DEFAULT_MINIMUM_PERFORMANCES = 2
DEFAULT_MINIMUM_EXCERPTS = 2
DUPLICATE_POLICIES = ('exclude_all', 'keep_first')
CONTROL_ROLES = ('hidden_reference', 'degraded_reference')


class AnalysisError(ValueError):
    """The sessions cannot be analysed as given."""


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_study(path):
    study = json.loads(Path(path).read_text(encoding='utf-8'))
    if study.get('schema') != STUDY_SCHEMA:
        raise AnalysisError(f'unsupported study schema {study.get("schema")!r}')
    return study


def load_sessions(paths):
    sessions = []
    for path in paths:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
        if value.get('schema') != RATINGS_SCHEMA:
            raise AnalysisError(f'{path}: unsupported ratings schema {value.get("schema")!r}')
        sessions.append(value)
    if not sessions:
        raise AnalysisError('no sessions were provided')
    return sessions


def role_map(study, rotation_index):
    rotation = next((item for item in study['rotations']
                     if item['index'] == rotation_index), None)
    if rotation is None:
        raise AnalysisError(f'rotation {rotation_index} is not in the study')
    mapping = {}
    for item in study['items']:
        order = rotation['label_order'][item['item_id']]
        for label_index, candidate_index in enumerate(order):
            mapping[(item['item_id'], label_index)] = item['candidates'][candidate_index]['role']
    return mapping


def session_timing(session):
    """Return ``(minutes, issue)``; invalid timing is an exclusion, not a bypass."""
    started, finished = session.get('started_at'), session.get('finished_at')
    if not started or not finished:
        return None, 'session is missing start or end timestamps'
    try:
        first = datetime.fromisoformat(str(started).replace('Z', '+00:00'))
        last = datetime.fromisoformat(str(finished).replace('Z', '+00:00'))
    except ValueError:
        return None, 'session timestamps are not valid ISO-8601'
    if first.utcoffset() is None or last.utcoffset() is None:
        return None, 'session timestamps must include time zones'
    minutes = (last - first).total_seconds() / 60.0
    if minutes < 0:
        return minutes, 'session end precedes its start'
    return minutes, None


def decode(study, session, study_sha256):
    reasons = []
    declared = session.get('study_sha256')
    if not declared:
        reasons.append('study identity missing from the submission')
    elif declared != study_sha256:
        reasons.append('submission was produced from a different study build')

    rotation = session.get('rotation')
    if isinstance(rotation, bool) or not isinstance(rotation, int) or not 0 <= rotation < study['rotation_count']:
        raise AnalysisError(f'{session.get("listener_id")}: invalid rotation {rotation!r}')
    mapping = role_map(study, rotation)

    expected = {(item['item_id'], index) for item in study['items']
                for index in range(len(item['candidates']))}
    counts = {}
    observations = []
    out_of_range = False
    for rating in session.get('ratings', []):
        try:
            index = rating['label_index']
            if isinstance(index, bool) or not isinstance(index, int):
                raise ValueError('label index must be an integer')
            key = (rating['item_id'], index)
        except (KeyError, TypeError, ValueError):
            reasons.append('rating is missing its item or label index')
            continue
        if key not in mapping:
            out_of_range = True
            continue
        counts[key] = counts.get(key, 0) + 1
        score = float(rating['score'])
        if not math.isfinite(score) or not 0.0 <= score <= 100.0:
            raise AnalysisError(f'{session.get("listener_id")}: score {score!r} out of range')
        observations.append({'listener_id': session['listener_id'], 'item_id': key[0],
                             'role': mapping[key], 'score': score,
                             'label_index': key[1],
                             'submitted_at': rating.get('submitted_at')})

    duplicate_keys = sorted(key for key, count in counts.items() if count > 1)
    if duplicate_keys:
        reasons.append(f'{len(duplicate_keys)} candidate(s) rated more than once')
        seen = set()
        unique = []
        for observation in observations:
            key = (observation['item_id'], observation['label_index'])
            if key in seen:
                continue
            seen.add(key)
            unique.append(observation)
        observations = unique
    if out_of_range:
        reasons.append('rating(s) refer to unknown candidates')

    missing = expected - set(counts)
    if missing:
        reasons.append(f'{len(missing)} candidate rating(s) missing')

    minutes, timing_issue = session_timing(session)
    if timing_issue:
        reasons.append(timing_issue)
    elif minutes is not None and minutes > study['bounds']['max_session_minutes']:
        reasons.append(f'session lasted {minutes:.1f} min, above the '
                       f'{study["bounds"]["max_session_minutes"]} min cap')

    scores = [observation['score'] for observation in observations]
    if len(scores) >= 8 and len(set(scores)) == 1:
        reasons.append('straight-lined: one score used for every candidate')

    return {'listener_id': session['listener_id'], 'rotation': rotation,
            'observations': observations, 'exclusions': reasons,
            'minutes': None if minutes is None else round(minutes, 2),
            'equipment': session.get('equipment'), 'excluded': bool(reasons)}


def _cells(observations):
    cells = {}
    for item in observations:
        cells.setdefault((item['listener_id'], item['item_id']), {})[item['role']] = item['score']
    return cells


def cluster_bootstrap(observations, seed=DEFAULT_SEED, iterations=DEFAULT_ITERATIONS):
    if not observations:
        return None
    listeners = sorted({item['listener_id'] for item in observations})
    excerpts = sorted({item['item_id'] for item in observations})
    listener_index = {value: index for index, value in enumerate(listeners)}
    excerpt_index = {value: index for index, value in enumerate(excerpts)}
    counts = np.zeros((len(listeners), len(excerpts)))
    totals = np.zeros_like(counts)
    for item in observations:
        row = listener_index[item['listener_id']]
        column = excerpt_index[item['item_id']]
        totals[row, column] += item['score']
        counts[row, column] += 1
    with np.errstate(invalid='ignore', divide='ignore'):
        cells = np.where(counts > 0, totals / counts, np.nan)

    rng = np.random.default_rng(seed)
    replicates = []
    for _ in range(iterations):
        rows = rng.integers(0, len(listeners), len(listeners))
        columns = rng.integers(0, len(excerpts), len(excerpts))
        sample = cells[np.ix_(rows, columns)]
        values = sample[np.isfinite(sample)]
        if values.size:
            replicates.append(float(values.mean()))
    if not replicates:
        return None
    return {'low': float(np.percentile(replicates, 2.5)),
            'high': float(np.percentile(replicates, 97.5)),
            'iterations': iterations, 'cluster': 'listener x excerpt'}


def paired_difference(cells, candidate, baseline, seed=DEFAULT_SEED,
                      iterations=DEFAULT_ITERATIONS):
    """Mean paired difference over cells that contain both roles, with a clustered interval."""
    pairs = [(key, value[candidate] - value[baseline])
             for key, value in cells.items()
             if candidate in value and baseline in value]
    if not pairs:
        return None
    listeners = sorted({key[0] for key, _difference in pairs})
    excerpts = sorted({key[1] for key, _difference in pairs})
    differences = {}
    for (listener, excerpt), difference in pairs:
        differences.setdefault(listener, {}).setdefault(excerpt, []).append(difference)
    matrix = np.full((len(listeners), len(excerpts)), np.nan)
    listener_index = {value: index for index, value in enumerate(listeners)}
    excerpt_index = {value: index for index, value in enumerate(excerpts)}
    for listener, per_excerpt in differences.items():
        for excerpt, values in per_excerpt.items():
            matrix[listener_index[listener], excerpt_index[excerpt]] = float(np.mean(values))

    observed = float(np.nanmean(matrix))
    rng = np.random.default_rng(seed)
    replicates = []
    for _ in range(iterations):
        rows = rng.integers(0, len(listeners), len(listeners))
        columns = rng.integers(0, len(excerpts), len(excerpts))
        sample = matrix[np.ix_(rows, columns)]
        values = sample[np.isfinite(sample)]
        if values.size:
            replicates.append(float(values.mean()))
    interval = None
    if replicates:
        interval = {'low': float(np.percentile(replicates, 2.5)),
                    'high': float(np.percentile(replicates, 97.5))}
    return {'mean_gain_points': round(observed, 3),
            'ci_low': None if interval is None else round(interval['low'], 3),
            'ci_high': None if interval is None else round(interval['high'], 3),
            'cells': len(pairs), 'listeners': len(listeners), 'excerpts': len(excerpts)}


def planned_comparisons(study, baseline):
    declared = study.get('comparisons')
    if declared:
        return [{'candidate': item['candidate'], 'baseline': item.get('baseline', baseline),
                 'exploratory': bool(item.get('exploratory', False))} for item in declared]
    practical = sorted({candidate['role'] for item in study['items']
                        for candidate in item['candidates']
                        if candidate['role'] not in CONTROL_ROLES
                        and candidate['role'] != baseline})
    return [{'candidate': role, 'baseline': baseline, 'exploratory': True}
            for role in practical]


def performance_map(study):
    """Items to parent performance and performer, and which top-level unit inference uses."""
    performance_of = {item['item_id']: item.get('performance_id') for item in study['items']}
    performer_of = {item['item_id']: item.get('performer_id') for item in study['items']}
    analysis = study.get('analysis') or {}
    verified = (analysis.get('version') == ANALYSIS_VERSION
                and analysis.get('performance_mapping_verified') is True
                and all(performance_of.values()))
    uses_performer = verified and all(performer_of.values())
    top_of = {item: (performer_of[item] if uses_performer else performance_of[item])
              for item in performance_of}
    return performance_of, performer_of, verified, uses_performer, top_of


def performance_cells(observations, performance_of):
    """Cells keyed by listener and performance, with excerpts nested inside the performance."""
    cells = {}
    for observation in observations:
        performance = performance_of.get(observation['item_id'])
        cells.setdefault((observation['listener_id'], performance), {}).setdefault(
            observation['role'], []).append(observation['score'])
    return cells


def _cell_means(cells):
    """Average excerpts within each listener/performance/role cell."""
    means = {}
    for key, roles in cells.items():
        means[key] = {role: float(sum(values)) / len(values)
                      for role, values in roles.items() if values}
    return means


def _hierarchy_value(perf_means, role, listeners, performers, performances_for):
    """Mean over performers of (mean over performances of (mean over listeners)).

    Listener and performer lists may contain repeats, which is how the bootstrap weights them.
    """
    performer_values = []
    for performer in performers:
        performance_values = []
        for performance in performances_for.get(performer, []):
            values = [perf_means[(listener, performance)][role]
                      for listener in listeners
                      if (listener, performance) in perf_means
                      and role in perf_means[(listener, performance)]]
            if values:
                performance_values.append(sum(values) / len(values))
        if performance_values:
            performer_values.append(sum(performance_values) / len(performance_values))
    if not performer_values:
        return None
    return sum(performer_values) / len(performer_values)


def _hierarchy_bootstrap(perf_means, role, performers, performances_for, seed, iterations):
    """Bootstrap listeners, performers and performances within the selected performer."""
    listener_pool = sorted({key[0] for key in perf_means})
    performer_pool = sorted(performers)
    if not listener_pool or not performer_pool:
        return None, None
    observed = _hierarchy_value(perf_means, role, listener_pool, performer_pool,
                                performances_for)
    rng = np.random.default_rng(seed)
    replicates = []
    for _ in range(iterations):
        listener_draw = [str(value) for value in
                         rng.choice(listener_pool, size=len(listener_pool), replace=True)]
        performer_draw = [str(value) for value in
                          rng.choice(performer_pool, size=len(performer_pool), replace=True)]
        performance_draw = {}
        for performer in set(performer_draw):
            pool = performances_for.get(performer, [])
            if pool:
                performance_draw[performer] = [str(value) for value in
                                               rng.choice(pool, size=len(pool), replace=True)]
        value = _hierarchy_value(perf_means, role, listener_draw, performer_draw,
                                 performance_draw)
        if value is not None:
            replicates.append(value)
    interval = None
    if replicates:
        interval = (float(np.percentile(replicates, 2.5)),
                    float(np.percentile(replicates, 97.5)))
    return observed, interval


def hierarchical_paired(cells, candidate, baseline, performer_of_performance,
                        performances_for, seed=DEFAULT_SEED, iterations=DEFAULT_ITERATIONS):
    """Paired difference preserving excerpt -> performance -> performer weighting."""
    pairs = {}
    for (listener, performance), roles in cells.items():
        if candidate in roles and baseline in roles:
            count = min(len(roles[candidate]), len(roles[baseline]))
            differences = [roles[candidate][index] - roles[baseline][index]
                           for index in range(count)]
            pairs[(listener, performance)] = {'gain': float(np.mean(differences))}
    if not pairs:
        return None
    performers = sorted({performer_of_performance[performance]
                         for _listener, performance in pairs})
    observed, interval = _hierarchy_bootstrap(pairs, 'gain', performers, performances_for,
                                              seed, iterations)
    if observed is None:
        return None
    return {'mean_gain_points': round(observed, 3),
            'ci_low': None if interval is None else round(interval[0], 3),
            'ci_high': None if interval is None else round(interval[1], 3),
            'cells': len(pairs),
            'listeners': len({key[0] for key in pairs}),
            'performances': len({key[1] for key in pairs}),
            'performers': len(performers),
            'excerpts': sum(len(roles.get(candidate, [])) for roles in cells.values()
                            if candidate in roles and baseline in roles),
            'weighting': 'excerpt -> performance -> performer, equal at each level',
            'cluster': 'listener x performer; performances nested; excerpts nested'}


def summarise(study, sessions, baseline='model_only', seed=DEFAULT_SEED,
              iterations=DEFAULT_ITERATIONS, study_sha256=None,
              duplicate_policy='exclude_all',
              minimum_listeners=DEFAULT_MINIMUM_LISTENERS,
              minimum_performances=DEFAULT_MINIMUM_PERFORMANCES,
              minimum_excerpts=DEFAULT_MINIMUM_EXCERPTS):
    if not study_sha256:
        raise AnalysisError('the expected study identity (study_sha256) is required')
    if duplicate_policy not in DUPLICATE_POLICIES:
        raise AnalysisError(f'unknown duplicate policy {duplicate_policy!r}')

    for session in sessions:
        if session.get('schema') != RATINGS_SCHEMA:
            raise AnalysisError(f'unsupported ratings schema '
                                f'{session.get("schema")!r}')
        if not session.get('listener_id'):
            raise AnalysisError('a session is missing its listener id')

    by_listener = {}
    for session in sessions:
        by_listener.setdefault(session['listener_id'], []).append(session)
    duplicated = {name for name, group in by_listener.items() if len(group) > 1}

    decoded = []
    for session in sessions:
        record = decode(study, session, study_sha256)
        if session['listener_id'] in duplicated:
            if duplicate_policy == 'exclude_all':
                record['exclusions'].append('duplicate submissions for this listener')
            else:
                first = by_listener[session['listener_id']][0]
                if session is not first:
                    record['exclusions'].append('later duplicate submission for this listener')
        record['excluded'] = bool(record['exclusions'])
        decoded.append(record)

    included = [record for record in decoded if not record['excluded']]
    excluded = [record for record in decoded if record['excluded']]

    by_role = {}
    for record in included:
        for observation in record['observations']:
            by_role.setdefault(observation['role'], []).append(observation)

    performance_of, performer_of, mapping_verified, uses_performer, _top_of = performance_map(
        study)
    observations = [observation for record in included
                    for observation in record['observations']]
    cells = performance_cells(observations, performance_of)
    perf_means = _cell_means(cells)

    performer_of_performance = {}
    for item in study['items']:
        performance = performance_of[item['item_id']]
        performer = performer_of[item['item_id']] if uses_performer else performance
        performer_of_performance.setdefault(performance, performer)
    performances_for = {}
    for performance, performer in performer_of_performance.items():
        performances_for.setdefault(performer, []).append(performance)
    performers_pool = sorted(performances_for)

    roles = {}
    for role, role_observations in sorted(by_role.items()):
        scores = np.array([item['score'] for item in role_observations])
        if mapping_verified:
            observed, interval = _hierarchy_bootstrap(perf_means, role, performers_pool,
                                                      performances_for, seed, iterations)
            mean = None if observed is None else round(observed, 3)
            low = None if interval is None else round(interval[0], 3)
            high = None if interval is None else round(interval[1], 3)
        else:
            legacy = cluster_bootstrap(role_observations, seed=seed, iterations=iterations)
            mean = round(float(scores.mean()), 3)
            low = None if legacy is None else round(legacy['low'], 3)
            high = None if legacy is None else round(legacy['high'], 3)
        roles[role] = {'n': int(scores.size),
                       'listeners': len({item['listener_id'] for item in role_observations}),
                       'performances': len({item['item_id'] for item in role_observations}),
                       'mean': mean,
                       'sd': round(float(scores.std(ddof=1)), 3) if scores.size > 1 else None,
                       'ci_low': low, 'ci_high': high}

    comparisons = []
    for planned in planned_comparisons(study, baseline):
        if mapping_verified:
            result = hierarchical_paired(cells, planned['candidate'],
                                         planned['baseline'], performer_of_performance,
                                         performances_for, seed=seed,
                                         iterations=iterations)
        else:
            result = paired_difference(_cells(observations), planned['candidate'],
                                       planned['baseline'], seed=seed,
                                       iterations=iterations)
        entry = {**planned, 'available': result is not None}
        if result:
            entry.update(result)
            entry['top_unit'] = 'performer' if uses_performer else 'performance'
        if not mapping_verified:
            entry['exploratory'] = True
            entry['legacy_diagnostic'] = True
        comparisons.append(entry)

    listeners_seen = len({record['listener_id'] for record in included})
    excerpts_seen = len({item['item_id'] for record in included
                         for item in record['observations']})
    performances_seen = (len({performance_of[item['item_id']] for record in included
                              for item in record['observations']})
                         if mapping_verified else None)
    performers_seen = (len({performer_of[item['item_id']] for record in included
                            for item in record['observations']})
                       if uses_performer else None)
    top_units = performers_seen if uses_performer else performances_seen
    adequate = (mapping_verified and listeners_seen >= minimum_listeners
                and (top_units or 0) >= minimum_performances)

    attention = {}
    if 'hidden_reference' in roles:
        attention['hidden_reference_mean'] = roles['hidden_reference']['mean']
        attention['hidden_reference_ok'] = (roles['hidden_reference']['mean'] >=
                                            study['attention']['hidden_reference_min_mean'])
    if 'degraded_reference' in roles:
        attention['degraded_reference_mean'] = roles['degraded_reference']['mean']
        attention['degraded_reference_ok'] = (roles['degraded_reference']['mean'] <=
                                              study['attention']['degraded_reference_max_mean'])

    return {
        'schema': REPORT_SCHEMA,
        'analysis_version': ANALYSIS_VERSION,
        'legacy_diagnostic': not mapping_verified,
        'study': {'items': len(study['items']), 'seed': study['seed'],
                  'rotations': study['rotation_count']},
        'sessions': {'provided': len(decoded), 'included': len(included),
                     'excluded': len(excluded)},
        'duplicate_policy': duplicate_policy,
        'duplicate_listeners': sorted(duplicated),
        'exclusions': [{'listener_id': record['listener_id'],
                        'reasons': record['exclusions']} for record in excluded],
        'roles': roles,
        'comparisons': comparisons,
        'coverage': {'listeners': listeners_seen,
                     'performances': performances_seen,
                     'performers': performers_seen,
                     'top_unit': 'performer' if uses_performer else 'performance',
                     'excerpts': excerpts_seen,
                     'minimum_listeners': minimum_listeners,
                     'minimum_performances': minimum_performances,
                     'minimum_excerpts': minimum_excerpts,
                     'performance_mapping_verified': mapping_verified,
                     'adequate': adequate},
        'conclusion': (None if not adequate else
                       'pilot evidence only; qualification requires the predeclared study'),
        'attention': attention,
        'scale_note': ('Scores are listener similarity judgements on the study scale. They '
                       'are not an indistinguishability probability and must not be replaced '
                       'by an objective metric.'),
        'limitations': [
            'Development material only; not the confirmatory study.',
            'Listener and performance clusters are resampled; excerpts are nested, not '
            'independent.',
            ('This study has no verified parent-performance mapping and remains legacy '
             'diagnostic.' if not mapping_verified else
             'Performers may still overlap across performances; the generalisation claim '
             'needs the performer hierarchy.'),
        ],
    }


def markdown(report):
    lines = ['# Listening report', '',
             f"Sessions: {report['sessions']['included']} included, "
             f"{report['sessions']['excluded']} excluded.", '',
             '| role | n | listeners | performances | mean | 95% CI |',
             '|---|---:|---:|---:|---:|---|']
    for role, value in report['roles'].items():
        interval = ('-' if value['ci_low'] is None
                    else f"{value['ci_low']:.1f} - {value['ci_high']:.1f}")
        lines.append(f"| {role} | {value['n']} | {value['listeners']} "
                     f"| {value.get('performances')} "
                     f"| {value['mean']:.1f} | {interval} |")
    if report['comparisons']:
        lines += ['', '| candidate | baseline | mean gain | 95% CI | cells | note |',
                  '|---|---|---:|---|---:|---|']
        for entry in report['comparisons']:
            if not entry.get('available'):
                lines.append(f"| {entry['candidate']} | {entry['baseline']} | - | - | 0 | "
                             'no paired cells |')
                continue
            interval = (f"{entry['ci_low']:.1f} to {entry['ci_high']:.1f}"
                        if entry['ci_low'] is not None else '-')
            note = 'exploratory (post-hoc)' if entry['exploratory'] else 'predeclared'
            lines.append(f"| {entry['candidate']} | {entry['baseline']} "
                         f"| {entry['mean_gain_points']:+.1f} | {interval} "
                         f"| {entry['cells']} | {note} |")
    coverage = report['coverage']
    performances = coverage.get('performances')
    lines += ['', f"Coverage: {coverage['listeners']} listeners, "
                  f"{'n/a' if performances is None else performances} performances, "
                  f"{coverage['excerpts']} nested excerpts (minimum "
                  f"{coverage['minimum_listeners']} listeners / "
                  f"{coverage['minimum_performances']} performances)."]
    if report.get('legacy_diagnostic'):
        lines.append('Legacy diagnostic: excerpts have no verified parent performance, so '
                     'independent-unit counts are unavailable.')
    if report['conclusion'] is None:
        lines.append('Conclusion suppressed: too few independent listeners or performances, '
                     'or an unverified performance mapping.')
    if report['attention']:
        lines += ['', 'Attention checks:']
        for key, value in sorted(report['attention'].items()):
            if key.endswith('_ok'):
                lines.append(f'- {key[:-3]}: {"pass" if value else "review"}')
            else:
                lines.append(f'- {key}: {value:.1f}')
    if report['exclusions']:
        lines += ['', 'Exclusions:']
        lines += [f"- {item['listener_id']}: {'; '.join(item['reasons'])}"
                  for item in report['exclusions']]
    lines += ['', report['scale_note']]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Analyse listening sessions.')
    parser.add_argument('--study', type=Path, required=True)
    parser.add_argument('--ratings', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--baseline', default='model_only')
    parser.add_argument('--seed', type=int, default=DEFAULT_SEED)
    parser.add_argument('--iterations', type=int, default=DEFAULT_ITERATIONS)
    parser.add_argument('--duplicate-policy', default='exclude_all',
                        choices=DUPLICATE_POLICIES)
    arguments = parser.parse_args(argv)

    try:
        study = load_study(arguments.study)
        verification = study_builder.verify(arguments.study)
        if not verification['ok']:
            raise AnalysisError(
                f'study verification failed for {len(verification["issues"])} item(s): '
                f'{verification["issues"][:3]}')
        study_sha256 = file_sha256(arguments.study)
        sessions = load_sessions(arguments.ratings)
        report = summarise(study, sessions, baseline=arguments.baseline,
                           seed=arguments.seed, iterations=arguments.iterations,
                           study_sha256=study_sha256,
                           duplicate_policy=arguments.duplicate_policy)
    except (AnalysisError, KeyError, ValueError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2

    text = json.dumps(report, indent=2, sort_keys=True)
    summary = markdown(report)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(text, encoding='utf-8')
        arguments.output.with_suffix('.md').write_text(summary, encoding='utf-8')
    print(summary)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
