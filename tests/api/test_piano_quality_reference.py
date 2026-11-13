"""M0/M1a: the reference contract keeps unknown attributes unknown and validates identity."""
import json
import struct

import pytest

import scripts.piano_quality_reference as reference
from scripts.piano_reconstruction_harness import write_wav

DIVISION = 480
TEMPO = 500000
SOURCE = {'sha256': 'a' * 64, 'seconds': 2.0, 'sample_rate': 8000, 'channels': 1}
PERFORMANCE = {'performance_id': 'perf-1', 'performer_id': 'p01',
               'recording_id': 'rec01', 'work_id': 'workA'}
RIGHTS = {'license': 'CC-BY-4.0', 'status': 'approved', 'receipt_id': 'r-1',
          'dataset_revision': 'rev-1'}


def varlen(value):
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def write_midi(path, notes, controllers=(), end_tick=1920):
    events = [(0, b'\xFF\x51\x03' + TEMPO.to_bytes(3, 'big'))]
    for on, off, pitch, velocity in notes:
        events.append((on, bytes([0x90, pitch, velocity])))
        events.append((off, bytes([0x80, pitch, 0])))
    for tick, controller, value in controllers:
        events.append((tick, bytes([0xB0, controller, value])))
    body = b''
    previous = 0
    for tick, payload in sorted(events, key=lambda item: item[0]):
        body += varlen(tick - previous) + payload
        previous = tick
    body += varlen(max(0, end_tick - previous)) + b'\xFF\x2F\x00'
    path.write_bytes(b'MThd' + struct.pack('>IHHH', 6, 1, 1, DIVISION)
                     + b'MTrk' + struct.pack('>I', len(body)) + body)
    return path


def verified_timeline():
    timeline = reference.default_timeline()
    timeline['video_to_analysis'].update({'method': 'manual-markers', 'verified': True,
                                          'uncertainty_seconds': 0.002})
    return timeline


def base_reference(**overrides):
    payload = {'reference_id': 'ref-1', 'source': dict(SOURCE),
               'performance': dict(PERFORMANCE), 'scored_interval': [0.0, 2.0],
               'rights': dict(RIGHTS), 'timeline': verified_timeline()}
    payload.update(overrides)
    return reference.new_reference(**payload)


def pitch_attribute(events, status='verified'):
    return reference.attribute(status, events, 'reviewed')


def test_new_reference_defaults_to_unknown_attributes():
    value = base_reference()
    assert set(value['attributes']) == set(reference.ATTRIBUTES)
    assert all(value['attributes'][name]['status'] == 'unavailable'
               for name in reference.ATTRIBUTES)
    assert value['metric_versions']['events'] == 'piano-event-metrics-2'


def test_source_and_interval_are_validated():
    with pytest.raises(reference.ReferenceError, match='sha256'):
        base_reference(source=dict(SOURCE, sha256='short'))
    with pytest.raises(reference.ReferenceError, match='beyond the source duration'):
        base_reference(scored_interval=[0.0, 5.0])
    with pytest.raises(reference.ReferenceError, match='increasing'):
        base_reference(scored_interval=[1.0, 1.0])
    with pytest.raises(reference.ReferenceError, match='channels'):
        base_reference(source=dict(SOURCE, channels=3))


def test_unavailable_attributes_may_not_carry_events():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset']['events'] = [{'id': 'n1', 'pitch': 60, 'onset_seconds': 0.5}]
    with pytest.raises(reference.ReferenceError, match='must not carry events'):
        base_reference(attributes=attributes)


def test_attribute_set_is_fixed():
    attributes = reference.unavailable_attributes()
    del attributes['pedal']
    with pytest.raises(reference.ReferenceError, match='exactly'):
        base_reference(attributes=attributes)


def test_event_validation_rejects_out_of_interval_and_duplicates():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 60,
                                                  'onset_seconds': 2.5}])
    with pytest.raises(reference.ReferenceError, match='outside the scored interval'):
        base_reference(attributes=attributes)

    attributes['pitch_onset'] = pitch_attribute([
        {'id': 'n1', 'pitch': 60, 'onset_seconds': 0.5},
        {'id': 'n1', 'pitch': 62, 'onset_seconds': 0.6}])
    with pytest.raises(reference.ReferenceError, match='duplicate event id'):
        base_reference(attributes=attributes)


def test_pitch_range_and_release_ordering_are_validated():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 200,
                                                  'onset_seconds': 0.5}])
    with pytest.raises(reference.ReferenceError, match='0..127'):
        base_reference(attributes=attributes)

    attributes['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 60,
                                                  'onset_seconds': 0.5}])
    attributes['key_release'] = reference.attribute(
        'verified', [{'id': 'r1', 'note_id': 'n1', 'release_seconds': 0.2}], 'capture')
    with pytest.raises(reference.ReferenceError, match='must follow its note onset'):
        base_reference(attributes=attributes)


def test_release_may_not_reference_an_unknown_note():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 60,
                                                  'onset_seconds': 0.5}])
    attributes['velocity'] = reference.attribute(
        'verified', [{'id': 'v1', 'note_id': 'n9', 'velocity_midi': 60}], 'capture')
    with pytest.raises(reference.ReferenceError, match='unknown note'):
        base_reference(attributes=attributes)


def test_rights_and_split_are_validated():
    with pytest.raises(reference.ReferenceError, match='rights status'):
        base_reference(rights={'license': 'CC-BY-4.0', 'status': 'probably'})
    with pytest.raises(reference.ReferenceError, match='split'):
        base_reference(split='training')


def test_a_reference_from_another_configuration_is_rejected():
    value = base_reference()
    value['config_version'] = 'piano-quality-config-0'
    with pytest.raises(reference.ReferenceError, match='tolerance configuration'):
        reference.validate(value)


def test_qualification_requires_status_rights_and_verified_alignment():
    value = base_reference()
    assert reference.is_qualified(value, 'pitch_onset') is False
    assert 'unavailable' in reference.qualification_reasons(value, 'pitch_onset')[0]

    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 60,
                                                  'onset_seconds': 0.5}])
    value = base_reference(attributes=attributes)
    assert reference.is_qualified(value, 'pitch_onset') is True

    unverified = reference.default_timeline()
    features = reference.unavailable_attributes()
    features['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 60,
                                                'onset_seconds': 0.5}])
    features['velocity'] = reference.attribute(
        'verified', [{'id': 'v1', 'note_id': 'n1', 'velocity_midi': 60}], 'capture')
    value = base_reference(attributes=features, timeline=unverified)
    assert reference.is_qualified(value, 'pitch_onset') is False
    assert reference.is_qualified(value, 'velocity') is True


def test_captured_midi_import_keeps_release_and_velocity_separate(tmp_path):
    path = write_midi(tmp_path / 'capture.mid',
                      notes=[(0, 480, 60, 80), (480, 960, 62, 55)],
                      controllers=[(0, 64, 127), (960, 64, 0)])
    value = reference.from_captured_midi(path, reference_id='ref-midi', source=SOURCE,
                                         performance=PERFORMANCE, rights=RIGHTS,
                                         timeline=verified_timeline())
    attributes = value['attributes']
    assert attributes['pitch_onset']['status'] == 'verified'
    assert len(attributes['pitch_onset']['events']) == 2
    assert attributes['key_release']['status'] == 'verified'
    assert len(attributes['key_release']['events']) == 2
    assert attributes['velocity']['events'][0]['velocity_midi'] == 80
    assert attributes['audible_end']['status'] == 'unavailable'
    assert 'not an audible-ending annotation' in attributes['audible_end']['provenance']
    assert attributes['pedal']['events']
    assert value['notes'][0].startswith('capture sha256')


def test_audio_only_reference_marks_everything_unavailable(tmp_path):
    path = write_wav(tmp_path / 'clip.wav', [0.0] * 16000, 8000, bit_depth=16)
    source = reference.source_from_audio(path)
    value = reference.from_audio_only(reference_id='clip', source=source,
                                      performance=PERFORMANCE, rights=RIGHTS,
                                      reason='no independent annotation yet')
    assert all(value['attributes'][name]['status'] == 'unavailable'
               for name in reference.ATTRIBUTES)
    assert all(reference.is_qualified(value, name) is False
               for name in reference.ATTRIBUTES)
    assert value['source']['seconds'] == pytest.approx(2.0, abs=0.01)


def test_annotation_template_lists_known_events():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = pitch_attribute([{'id': 'n1', 'pitch': 60,
                                                  'onset_seconds': 0.5}])
    value = base_reference(attributes=attributes)
    rows = reference.annotation_template(value)
    assert rows[0]['id'] == 'n1'
    assert rows[0]['reviewer'] == ''


def test_merge_annotations_marks_disagreement_uncertain(tmp_path):
    attributes = reference.unavailable_attributes()
    value = base_reference(attributes=attributes)
    first = [{'reviewer': 'R1', 'pitch': 60, 'onset_seconds': 0.500},
             {'reviewer': 'R1', 'pitch': 64, 'onset_seconds': 0.900}]
    second = [{'reviewer': 'R2', 'pitch': 60, 'onset_seconds': 0.502},
              {'reviewer': 'R2', 'pitch': 67, 'onset_seconds': 1.400}]
    merged = reference.merge_annotations(value, first, second)
    events = merged['attributes']['pitch_onset']['events']
    verified = [event for event in events if event['status'] == 'verified']
    uncertain = [event for event in events if event['status'] == 'uncertain']
    assert len(verified) == 1
    assert len(uncertain) == 2
    assert merged['attributes']['pitch_onset']['status'] == 'verified'
    receipts = merged['attributes']['pitch_onset']['receipts']
    assert {receipt['reviewer'] for receipt in receipts} == {'R1', 'R2'}
    assert all(len(receipt['input_sha256']) == 64 for receipt in receipts)


def test_annotations_require_independent_reviewer_identities():
    attributes = reference.unavailable_attributes()
    value = base_reference(attributes=attributes)
    rows = [{'pitch': 60, 'onset_seconds': 0.500}]
    with pytest.raises(reference.ReferenceError, match='reviewer identity'):
        reference.merge_annotations(value, rows, [{'reviewer': 'R2', 'pitch': 60,
                                                   'onset_seconds': 0.500}])
    with pytest.raises(reference.ReferenceError, match='distinct reviewers'):
        reference.merge_annotations(value, [{'reviewer': 'R1', 'pitch': 60,
                                             'onset_seconds': 0.500}],
                                    [{'reviewer': 'R1', 'pitch': 60,
                                      'onset_seconds': 0.500}])
    with pytest.raises(reference.ReferenceError, match='exactly one reviewer'):
        reference.merge_annotations(value, [{'reviewer': 'R1', 'pitch': 60,
                                             'onset_seconds': 0.500},
                                            {'reviewer': 'R3', 'pitch': 62,
                                             'onset_seconds': 0.700}],
                                    [{'reviewer': 'R2', 'pitch': 60,
                                      'onset_seconds': 0.500}])


def test_negative_onset_uncertainty_is_rejected():
    attributes = reference.unavailable_attributes()
    attributes['pitch_onset'] = pitch_attribute(
        [{'id': 'n1', 'pitch': 60, 'onset_seconds': 0.5,
          'onset_uncertainty_seconds': -0.01}])
    with pytest.raises(reference.ReferenceError, match='must not be negative'):
        base_reference(attributes=attributes)


def test_adjudication_can_keep_or_drop_uncertain_events():
    attributes = reference.unavailable_attributes()
    value = base_reference(attributes=attributes)
    first = [{'reviewer': 'R1', 'pitch': 60, 'onset_seconds': 0.500}]
    second = [{'reviewer': 'R2', 'pitch': 60, 'onset_seconds': 0.500},
              {'reviewer': 'R2', 'pitch': 72, 'onset_seconds': 1.200}]
    merged = reference.merge_annotations(value, first, second)
    extra = next(event for event in merged['attributes']['pitch_onset']['events']
                 if event['status'] == 'uncertain')
    reference.merge_annotations(value, first, second,
                                adjudicated=[{'id': extra['id'], 'decision': 'keep'}])
    assert all(event['status'] == 'verified'
               for event in value['attributes']['pitch_onset']['events'])


def test_reference_hash_is_stable_and_content_sensitive():
    first = base_reference()
    second = base_reference()
    assert reference.reference_sha256(first) == reference.reference_sha256(second)
    second['scored_interval'] = [0.0, 1.5]
    assert reference.reference_sha256(first) != reference.reference_sha256(second)


def test_cli_summary_reports_qualified_attributes(tmp_path, capsys):
    value = base_reference()
    path = tmp_path / 'reference.json'
    path.write_text(json.dumps(value), encoding='utf-8')
    assert reference.main(['--reference', str(path), '--summary']) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload['attributes']['pitch_onset']['qualified'] is False
    assert payload['alignment_verified'] is True
    assert payload['sha256']
