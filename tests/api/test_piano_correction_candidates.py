"""Offline candidates must not bypass ambiguity, provenance or production preconditions."""
import copy
import json

import pytest

from scripts import benchmark_piano_correction_candidates as experiment
from scripts import piano_corrections as corrections
from scripts import piano_verifier as verifier


def fixture():
    events = [{'id': 'a', 'onset': 0.2, 'duration': 0.3, 'pitch': 60, 'velocity': 0.5},
              {'id': 'b', 'onset': 0.25, 'duration': 0.4, 'pitch': 60, 'velocity': 0.6}]
    finding = {'id': 'vf-1', 'kind': 'duplicate_event', 'status': 'suggested',
               'ambiguous': False,
               'proposed_edits': [{'op': 'merge', 'event_ids': ['a', 'b'],
                                   'before': copy.deepcopy(events),
                                   'after': {'onset': 0.2, 'duration': 0.45, 'pitch': 60}}]}
    report = {'status': 'complete',
              'source': {'proposal_sha256': verifier.proposal_digest(events)},
              'findings': [finding]}
    return events, report


def test_offline_merge_preserves_input_and_uses_production_application():
    events, report = fixture()
    snapshot = copy.deepcopy(events)
    result, ids, state = experiment.construct_candidate(events, report, 1)
    assert result == corrections.apply_finding(events, report['findings'][0], 1)
    assert ids == ['vf-1'] and state == 'diagnostic_candidate'
    assert events == snapshot


@pytest.mark.parametrize('field,value', [('ambiguous', True), ('status', 'unresolved')])
def test_uncertain_findings_never_become_candidate_edits(field, value):
    events, report = fixture()
    report['findings'][0][field] = value
    candidate, applied, state = experiment.construct_candidate(events, report, 1)
    assert candidate == events and not applied and state == 'no_supported_edits'


def test_partial_analysis_cannot_create_candidate():
    events, report = fixture()
    report['status'] = 'partial'
    candidate, applied, state = experiment.construct_candidate(events, report, 1)
    assert candidate == events and not applied and state == 'incomplete_analysis'


def test_stale_baseline_is_rejected():
    events, report = fixture()
    events[0]['onset'] += 0.01
    with pytest.raises(ValueError, match='frozen proposal'):
        experiment.construct_candidate(events, report, 1)


def test_stale_edit_fails_without_mutating_the_original():
    events, report = fixture()
    snapshot = copy.deepcopy(events)
    report['findings'][0]['proposed_edits'][0]['before'][0]['duration'] = 0.6
    with pytest.raises(corrections.PreconditionError):
        experiment.construct_candidate(events, report, 1)
    assert events == snapshot


def test_cross_category_operation_is_rejected():
    events, report = fixture()
    report['findings'][0]['proposed_edits'][0]['op'] = 'delete_note'
    with pytest.raises(ValueError, match='outside its correction category'):
        experiment.construct_candidate(events, report, 1)


def test_category_ablation_does_not_apply_other_categories():
    events, report = fixture()
    candidate, applied, _ = experiment.construct_candidate(events, report, 1, 'missing_pitch')
    assert candidate == events and applied == []


def test_existing_experiment_is_never_overwritten(tmp_path):
    out = tmp_path / 'evidence'
    out.mkdir()
    marker = out / 'baseline-input.json'
    marker.write_text('frozen')
    with pytest.raises(FileExistsError):
        experiment.run(audio='unused', baseline='unused', output=out)
    assert marker.read_text() == 'frozen'
