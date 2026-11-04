"""Music manifest v2 is a separate, reviewed-only contract."""
import json

import pytest
from pydantic import ValidationError

from apps.api.config import ROOT
from apps.api.contracts import LessonManifest, LessonSummary, MusicLessonManifest

FIXTURES = ROOT / 'packages' / 'lesson-schema' / 'fixtures'


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def test_reviewed_music_fixture_validates():
    manifest = MusicLessonManifest.model_validate(load(FIXTURES / 'music-v2.json'))
    assert manifest.schema_version == 2
    assert manifest.experience_family == 'music'
    assert manifest.subject == 'piano'
    assert manifest.section_set.duration == manifest.duration
    assert manifest.reference_reviewed is True


@pytest.mark.parametrize('name', ['music-v2-missing-subject.json', 'music-v2-sparse-sections.json',
                                  'music-v2-body-fields.json', 'music-v2-unreviewed.json'])
def test_invalid_music_fixtures_are_refused(name):
    with pytest.raises(ValidationError):
        MusicLessonManifest.model_validate(load(FIXTURES / 'invalid' / name))


def test_specific_refusals():
    cases = {
        'music-v2-missing-subject.json': 'subject',
        'music-v2-sparse-sections.json': 'Sections must',
        'music-v2-body-fields.json': 'Extra inputs are not permitted',
        'music-v2-unreviewed.json': 'reference_reviewed',
    }
    for name, fragment in cases.items():
        with pytest.raises(ValidationError) as error:
            MusicLessonManifest.model_validate(load(FIXTURES / 'invalid' / name))
        assert fragment in str(error.value), (name, str(error.value))


def test_body_contract_rejects_a_music_manifest_and_the_reverse():
    music = load(FIXTURES / 'music-v2.json')
    with pytest.raises(ValidationError):
        LessonManifest.model_validate(music)
    body = load(ROOT / 'packages' / 'lesson-schema' / 'fixture.json')
    with pytest.raises(ValidationError):
        MusicLessonManifest.model_validate(body)


def test_summary_fixture_validates():
    summary = LessonSummary.model_validate(load(FIXTURES / 'lesson-summary.json'))
    assert summary.subject == 'piano' and summary.subject_label == 'Piano'
    assert summary.experience_family == 'music'


def test_unreviewed_reference_cannot_be_a_manifest():
    """A draft is not publishable: the contract itself refuses it."""
    value = load(FIXTURES / 'music-v2.json')
    value['reference_reviewed'] = False
    with pytest.raises(ValidationError):
        MusicLessonManifest.model_validate(value)
