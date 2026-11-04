"""Schema artifacts are generated from the contracts and drift-checked individually."""
import json

from apps.api import export_lesson_schemas as exporter
from apps.api.contracts import LessonManifest, MusicLessonManifest


def read(name):
    return json.loads((exporter.SCHEMA_DIR / name).read_text(encoding='utf-8'))


def test_all_artifacts_are_current():
    assert exporter.main(['--check']) == 0


def test_body_artifact_still_describes_only_the_body_contract():
    schema = read('manifest.schema.json')
    assert schema == LessonManifest.model_json_schema()
    assert 'experience_family' not in schema['properties']
    assert 'subject' not in schema['properties']


def test_music_artifact_matches_the_music_contract():
    schema = read('music-manifest.schema.json')
    assert schema == MusicLessonManifest.model_json_schema()
    for name in ('schema_version', 'experience_family', 'instrument', 'section_set',
                 'reference', 'reference_reviewed', 'assessment'):
        assert name in schema['properties']
    for body_only in ('animation', 'landmarks', 'standing_time', 'engine'):
        assert body_only not in schema['properties']


def test_boundary_artifact_is_a_three_way_union():
    schema = read('lesson-boundary.schema.json')
    assert len(schema['anyOf']) == 3
    rendered = json.dumps(schema)
    for name in ('LessonManifest', 'MusicLessonManifest', 'LessonSummary'):
        assert name in rendered


def test_drift_check_names_each_artifact_independently(tmp_path, monkeypatch, capsys):
    for name in exporter.ARTIFACTS:
        (tmp_path / name).write_text((exporter.SCHEMA_DIR / name).read_text(encoding='utf-8'), encoding='utf-8')
    monkeypatch.setattr(exporter, 'SCHEMA_DIR', tmp_path)
    assert exporter.main(['--check']) == 0

    (tmp_path / 'music-manifest.schema.json').write_text('{}\n', encoding='utf-8')
    assert exporter.main(['--check']) == 1
    assert 'music-manifest.schema.json' in capsys.readouterr().err

    (tmp_path / 'music-manifest.schema.json').write_text(
        exporter.render(exporter.ARTIFACTS['music-manifest.schema.json']()), encoding='utf-8')
    (tmp_path / 'manifest.schema.json').write_text('{}\n', encoding='utf-8')
    assert exporter.main(['--check']) == 1
    assert 'manifest.schema.json' in capsys.readouterr().err


def test_generation_is_deterministic():
    first = exporter.render(exporter.ARTIFACTS['lesson-boundary.schema.json']())
    second = exporter.render(exporter.ARTIFACTS['lesson-boundary.schema.json']())
    assert first == second and first.endswith('\n')
