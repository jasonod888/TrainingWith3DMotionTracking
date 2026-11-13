"""Phase-A0 rights preflight denies by default and follows published grants exactly."""
import json
from pathlib import Path

import pytest

import scripts.piano_rights as rights

USES = {
    'acquisition_storage': 'acquire',
    'internal_evaluation': 'evaluate',
    'model_selection': 'select',
    'training': 'train',
    'calibration': 'calibrate',
    'hosted_inference': 'serve',
    'publication': 'publish',
    'redistribution_original': 'ship original',
    'redistribution_derived': 'ship derived',
}


def decisions(value, **overrides):
    return {use: overrides.get(use, value) for use in USES}


def source(identifier, value='approved', derived_from=(), **overrides):
    entry = {'id': identifier, 'kind': 'test', 'license': 'CC0-1.0',
             'decisions': decisions(value, **overrides), 'attribution_required': False}
    if derived_from:
        entry['derived_from'] = list(derived_from)
    return entry


def manifest(*sources):
    return {'schema': rights.SCHEMA, 'schema_version': rights.SCHEMA_VERSION,
            'reviewed_on': '2026-11-12', 'uses': dict(USES),
            'sources': list(sources)}


def test_checked_in_manifest_is_valid():
    loaded = rights.load_manifest()
    assert rights.validate_manifest(loaded)
    identifiers = {item['id'] for item in loaded['sources']}
    assert {'vienna-4x22-audio', 'vienna-4x22-corrected-midi', 'vcsl-piano-samples',
            'salamander-grand-piano-v3', 'sfizz-engine', 'fluidsynth-engine',
            'basic-pitch-0.4.0', 'transkun-checkpoint',
            'bytedance-piano-transcription', 'smd-midi', 'maestro'} <= identifiers


def test_selected_route_is_cleared_for_the_development_uses():
    loaded = rights.load_manifest()
    for identifier in ('vienna-4x22-audio', 'vienna-4x22-corrected-midi',
                       'vcsl-piano-samples', 'salamander-grand-piano-v3'):
        for use in ('acquisition_storage', 'internal_evaluation',
                    'model_selection', 'calibration'):
            decision = rights.require(loaded, identifier, use)
            assert decision.approved
            assert decision.source_ids == (identifier,)


@pytest.mark.parametrize('identifier,use,status', [
    ('smd-midi', 'internal_evaluation', rights.PROHIBITED),
    ('maestro', 'calibration', rights.PROHIBITED),
    ('bytedance-piano-transcription', 'internal_evaluation', rights.UNRESOLVED),
    ('transkun-checkpoint', 'model_selection', rights.UNRESOLVED),
    ('vienna-4x22-audio', 'hosted_inference', rights.NOT_APPLICABLE),
])
def test_non_approved_decisions_deny(identifier, use, status):
    loaded = rights.load_manifest()
    with pytest.raises(rights.RightsDenied) as caught:
        rights.require(loaded, identifier, use)
    assert caught.value.status == status
    assert caught.value.use == use
    assert caught.value.blockers


def test_unlicensed_checkpoint_is_recorded_as_unresolved_not_approved():
    loaded = rights.load_manifest()
    entry = next(item for item in loaded['sources']
                 if item['id'] == 'bytedance-piano-transcription')
    assert entry['license'] is None
    assert set(entry['decisions'].values()) == {rights.UNRESOLVED}
    assert any('no license' in condition.lower() for condition in entry['conditions'])


def test_the_training_repository_block_does_not_cover_the_published_artifacts():
    """Review W2: restrict the unlicensed checkout without banning the licensed release."""
    loaded = rights.load_manifest()
    package = rights.require(loaded, 'kong-piano-inference-package', 'model_selection')
    checkpoint = rights.require(loaded, 'kong-piano-checkpoint-4034264', 'model_selection')
    assert package.approved and checkpoint.approved
    assert rights.decide(loaded, 'bytedance-piano-transcription', 'model_selection').status == \
        rights.UNRESOLVED


def test_published_checkpoint_records_the_verified_distribution_hashes():
    loaded = rights.load_manifest()
    entry = next(item for item in loaded['sources']
                 if item['id'] == 'kong-piano-checkpoint-4034264')
    assert entry['license'] == 'CC-BY-4.0'
    assert entry['artifact']['sha256'] == \
        'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141'
    assert entry['artifact']['md5'] == '22b961b77c1878239fec963362097045'
    assert entry['artifact']['bytes'] == 171966578
    assert any('training-data provenance' in note.lower() for note in entry['notes'])


def test_inference_package_records_its_own_distribution():
    loaded = rights.load_manifest()
    entry = next(item for item in loaded['sources']
                 if item['id'] == 'kong-piano-inference-package')
    assert entry['license'] == 'MIT'
    assert entry['artifact']['wheel_sha256'].startswith('64348200')
    assert rights.require(loaded, 'kong-piano-inference-package', 'hosted_inference')


def test_transkun_points_upstream_and_keeps_only_its_use_unresolved():
    loaded = rights.load_manifest()
    entry = next(item for item in loaded['sources'] if item['id'] == 'transkun-checkpoint')
    assert 'Yujia-Yan' in entry['license_url']
    assert 'thevoidmain' not in entry['license_url']
    assert entry['decisions']['acquisition_storage'] == rights.APPROVED
    assert entry['decisions']['model_selection'] == rights.UNRESOLVED
    assert entry['decisions']['publication'] == rights.APPROVED
    assert any('critical path' in note for note in entry['notes'])


def test_velocity_candidate_is_usable_for_evaluation_but_not_hosting():
    loaded = rights.load_manifest()
    assert rights.require(loaded, 'veloest-sfproxy', 'model_selection').approved
    with pytest.raises(rights.RightsDenied) as caught:
        rights.require(loaded, 'veloest-sfproxy', 'hosted_inference')
    assert caught.value.status == rights.UNRESOLVED
    assert rights.require(loaded, 'veloest-score-hpt', 'model_selection').approved


def test_missing_decision_is_a_manifest_defect():
    entry = source('only', 'approved')
    del entry['decisions']['training']
    with pytest.raises(rights.ManifestError, match='missing explicit decisions'):
        rights.validate_manifest(manifest(entry))


def test_undeclared_use_in_a_decision_is_a_manifest_defect():
    entry = source('only', 'approved')
    entry['decisions']['royalty_free'] = 'approved'
    with pytest.raises(rights.ManifestError, match='undeclared use'):
        rights.validate_manifest(manifest(entry))


def test_invalid_decision_value_is_a_manifest_defect():
    entry = source('only', 'approved', training='probably')
    with pytest.raises(rights.ManifestError, match='invalid decision'):
        rights.validate_manifest(manifest(entry))


def test_unknown_intended_use_is_rejected():
    with pytest.raises(rights.ManifestError, match='unknown intended use'):
        rights.decide(manifest(source('only')), 'only', 'benchmark')


def test_unknown_source_is_rejected():
    with pytest.raises(rights.ManifestError, match='unknown source id'):
        rights.decide(manifest(source('only')), 'elsewhere', 'internal_evaluation')


def test_duplicate_source_ids_are_rejected():
    with pytest.raises(rights.ManifestError, match='duplicate source id'):
        rights.validate_manifest(manifest(source('twin'), source('twin')))


def test_derived_artifact_inherits_unresolved_ancestor():
    base = source('corpus', 'approved', training='unresolved')
    derived = source('profile', 'approved', derived_from=('corpus',))
    decision = rights.decide(manifest(base, derived), 'profile', 'training')
    assert decision.status == rights.UNRESOLVED
    assert any(blocker.startswith('corpus:training') for blocker in decision.blockers)


def test_derived_artifact_inherits_prohibited_ancestor():
    base = source('corpus', 'approved', internal_evaluation='prohibited')
    derived = source('profile', 'approved', derived_from=('corpus',))
    decision = rights.decide(manifest(base, derived), 'profile', 'internal_evaluation')
    assert decision.status == rights.PROHIBITED


def test_not_applicable_ancestor_does_not_block_a_derived_artifact():
    base = source('corpus', 'approved', hosted_inference='not_applicable')
    derived = source('profile', 'approved', derived_from=('corpus',))
    decision = rights.decide(manifest(base, derived), 'profile', 'hosted_inference')
    assert decision.approved


def test_missing_decision_cannot_be_inherited_as_permission():
    base = source('corpus', 'approved')
    del base['decisions']['calibration']
    derived = source('profile', 'approved', derived_from=('corpus',))
    with pytest.raises(rights.ManifestError, match='missing explicit decisions'):
        rights.decide(manifest(base, derived), 'profile', 'calibration')


def test_derived_from_cycle_is_rejected():
    first = source('first', 'approved', derived_from=('second',))
    second = source('second', 'approved', derived_from=('first',))
    with pytest.raises(rights.ManifestError, match='cycle'):
        rights.validate_manifest(manifest(first, second))


def test_unknown_derived_from_parent_is_rejected():
    with pytest.raises(rights.ManifestError, match='unknown'):
        rights.validate_manifest(manifest(source('orphan', 'approved', derived_from=('absent',))))


def test_unlicensed_source_needs_a_recorded_reason():
    entry = source('mystery')
    entry['license'] = None
    with pytest.raises(rights.ManifestError, match='explaining the gap'):
        rights.validate_manifest(manifest(entry))
    entry['notes'] = ['no published license; written permission requested']
    rights.validate_manifest(manifest(entry))


def test_attribution_requirement_must_be_satisfied():
    entry = source('borrowed')
    entry['license'] = 'CC-BY-4.0'
    entry['attribution_required'] = True
    entry['attribution'] = ''
    with pytest.raises(rights.ManifestError, match='declares none'):
        rights.validate_manifest(manifest(entry))
    entry['attribution'] = 'Example, CC BY 4.0.'
    rights.validate_manifest(manifest(entry))


def test_clearance_record_binds_the_manifest_and_denies_unapproved_uses():
    loaded = rights.load_manifest()
    record = rights.clearance_record(loaded, 'salamander-grand-piano-v3', 'hosted_inference')
    assert record['status'] == rights.APPROVED
    assert record['manifest_sha256'] == rights.manifest_sha256(loaded)
    assert record['attributions'] and 'Salamander' in record['attributions'][0]
    with pytest.raises(rights.RightsDenied):
        rights.clearance_record(loaded, 'maestro', 'hosted_inference')


def test_manifest_hash_is_canonical():
    first = manifest(source('only'))
    second = json.loads(json.dumps(first))
    second['sources'][0]['decisions'] = dict(reversed(list(second['sources'][0]['decisions'].items())))
    assert rights.manifest_sha256(first) == rights.manifest_sha256(second)


def test_report_and_unresolved_views_agree():
    loaded = rights.load_manifest()
    reported = rights.report(loaded)
    assert reported['sources']['maestro']['license'] == 'CC-BY-NC-SA-4.0'
    unresolved = reported['unresolved']
    assert unresolved
    assert all(item['decision'] != rights.APPROVED for item in unresolved)
    assert rights.approved_sources(loaded, 'acquisition_storage')


def test_cli_reports_denial_with_exit_code(capsys):
    assert rights.main(['--check', 'vcsl-piano-samples', '--use', 'redistribution_derived']) == 0
    assert 'approved' in capsys.readouterr().out

    assert rights.main(['--check', 'smd-midi', '--use', 'internal_evaluation']) == 1
    captured = capsys.readouterr()
    assert 'DENIED' in captured.err
    assert 'condition' in captured.err


def test_cli_report_writes_valid_json(capsys):
    assert rights.main(['--report']) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload['schema'] == 'piano-rights-report-1'
    assert payload['manifest_sha256']


def test_checked_in_manifest_path_is_tracked():
    assert rights.DEFAULT_MANIFEST_PATH.is_file()
    assert Path('docs/piano-reconstruction-rights-manifest.json').is_file()
