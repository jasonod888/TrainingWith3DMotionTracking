"""Creator feedback switch: strict persistence, legacy fallback and projection."""
import copy

import pytest
from pydantic import ValidationError

from apps.api.conversions import NewConversion
from apps.api.lessons import SaveSections
from apps.api.music_assessment import effective_feedback_enabled, with_effective_feedback
from apps.api.music_review import ReviewAssessment, ReviewMusic


def legacy_music(subject, assessment='none'):
    return {
        'schema_version': 2, 'experience_family': 'music', 'subject': subject,
        'reference_reviewed': True,
        'assessment': {'assessment': assessment,
                       'input_modes': ['none'] if assessment == 'none' else ['midi', 'microphone'],
                       'dimensions': [] if assessment == 'none' else ['pitch', 'timing'],
                       'rubric_version': 'music-watch-v1' if assessment == 'none' else f'{subject}-notes-v1'},
    }


def test_legacy_music_none_stays_disabled_and_projection_never_mutates():
    original = legacy_music('piano')
    snapshot = copy.deepcopy(original)
    assert effective_feedback_enabled(original) is False
    projected = with_effective_feedback(original)
    assert projected['feedback_enabled'] is False
    assert projected['assessment'] == original['assessment']
    assert original == snapshot
    assert projected is not original


def test_legacy_music_notes_and_body_keep_prior_availability():
    assert effective_feedback_enabled(legacy_music('guitar', 'notes')) is True
    assert effective_feedback_enabled({'schema_version': 1}) is True


def test_explicit_boolean_wins_even_when_rubric_disagrees():
    off = {**legacy_music('piano', 'notes'), 'feedback_enabled': False}
    on = {**legacy_music('piano'), 'feedback_enabled': True}
    assert effective_feedback_enabled(off) is False
    assert effective_feedback_enabled(on) is True
    assert with_effective_feedback(off)['feedback_enabled'] is False


def test_invalid_stored_values_fall_back_without_coercion():
    assert effective_feedback_enabled({**legacy_music('piano'), 'feedback_enabled': 'false'}) is False
    assert effective_feedback_enabled({'schema_version': 1, 'feedback_enabled': 'false'}) is True


def test_review_contract_accepts_legacy_watch_only_but_new_review_defaults_notes():
    legacy = ReviewAssessment(assessment='none', input_modes=['none'], dimensions=[],
                              rubric_version='music-watch-v1')
    assert legacy.assessment == 'none'
    assert ReviewAssessment().assessment == 'notes'


@pytest.mark.parametrize('value', ['false', 'true', 0, 1])
def test_explicit_feedback_setting_is_strict_bool_in_partial_edits(value):
    with pytest.raises(ValidationError):
        SaveSections(base_revision_id='r', title='T',
                     sections=[{'id': 'whole', 'label': 'Whole', 'start': 0, 'end': 1}],
                     feedback_enabled=value)
    with pytest.raises(ValidationError):
        ReviewMusic(draft_id='d', reference_sha256='a' * 64, title='T', events=[], spans=[],
                    sections=[{'id': 'whole', 'label': 'Whole', 'start': 0, 'end': 1}],
                    confirm_reviewed=True, feedback_enabled=value)
    with pytest.raises(ValidationError):
        NewConversion(title='T', filename='clip.mp4', bytes=1, start=0, duration=1,
                      feedback_enabled=value)


def test_absent_and_explicit_false_remain_distinct_in_requests():
    body = ReviewMusic(draft_id='d', reference_sha256='a' * 64, title='T', events=[], spans=[],
                       sections=[{'id': 'whole', 'label': 'Whole', 'start': 0, 'end': 1}],
                       confirm_reviewed=True)
    assert body.feedback_enabled is None
    assert body.model_copy(update={'feedback_enabled': False}).feedback_enabled is False
