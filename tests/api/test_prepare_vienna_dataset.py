"""W5 ingestion parses MIDI without a library, excludes variants and tests split feasibility."""
import json
import struct
import wave

import pytest

import scripts.prepare_vienna_dataset as vienna

DIVISION = 480
TEMPO = 500000  # 120 bpm: 480 ticks = 1.0 s


def varlen(value):
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(out))


def track_bytes(events, end_tick=0):
    """Build one MTrk from ``(absolute_tick, payload_bytes)`` pairs, no running status."""
    events = sorted(events, key=lambda item: item[0])
    body = b''
    previous = 0
    for tick, payload in events:
        body += varlen(tick - previous) + payload
        previous = tick
    body += varlen(max(0, end_tick - previous)) + b'\xFF\x2F\x00'
    return b'MTrk' + struct.pack('>I', len(body)) + body


def write_midi(path, notes=(), controllers=(), end_tick=3840, velocity_zero=False):
    events = [(0, b'\xFF\x51\x03' + TEMPO.to_bytes(3, 'big'))]
    for on, off, pitch, velocity in notes:
        events.append((on, bytes([0x90, pitch, velocity])))
        if velocity_zero:
            events.append((off, bytes([0x90, pitch, 0])))
        else:
            events.append((off, bytes([0x80, pitch, 0])))
    for tick, controller, value in controllers:
        events.append((tick, bytes([0xB0, controller, value])))
    data = (b'MThd' + struct.pack('>IHHH', 6, 1, 1, DIVISION)
            + track_bytes(events, end_tick))
    path.write_bytes(data)
    return path


def write_wav(path, seconds):
    frames = int(round(seconds * 8000))
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b'\x00\x00' * frames)
    return path


def corpus(directory):
    midi = directory / 'vienna-midi-corrected'
    midi.mkdir(parents=True)
    for performer in ('p01', 'p02', 'p03', 'p04'):
        for work in ('Chopin_op38', 'WorkB'):
            write_midi(midi / f'{work}_{performer}.mid',
                       notes=[(0, 480, 60, 80), (480, 960, 64, 70)],
                       controllers=[(0, 64, 127), (960, 64, 0),
                                    (0, 67, 127), (960, 67, 0)])
    write_midi(midi / 'Chopin_op38_p01-average.mid', notes=[(0, 960, 60, 80)],
               controllers=[(0, 64, 127), (960, 64, 0), (0, 67, 127), (960, 67, 0)])
    write_midi(midi / 'Chopin_op38_1st-3rd_p01.mid', notes=[(0, 480, 60, 80)],
               controllers=[(0, 64, 127), (480, 64, 0), (0, 67, 127), (480, 67, 0)],
               end_tick=960)
    write_wav(directory / 'vienna-original-sample.wav', 1.0)
    return directory


def test_parser_reads_notes_tempo_and_controllers(tmp_path):
    path = write_midi(tmp_path / 'a.mid', notes=[(0, 480, 60, 80)],
                      controllers=[(0, 64, 127), (960, 64, 0)])
    summary = vienna.performance_summary(path)
    assert summary['notes'] == 1
    assert summary['duration_seconds'] == pytest.approx(4.0, abs=0.01)
    assert summary['sustain_events'] == 2
    assert summary['sustain_is_binary'] is True
    assert summary['note_off_conventions']['note_off'] == 1


def test_velocity_zero_is_a_note_off(tmp_path):
    path = write_midi(tmp_path / 'b.mid', notes=[(0, 480, 60, 80)], velocity_zero=True)
    summary = vienna.performance_summary(path)
    assert summary['notes'] == 1
    assert summary['unmatched_note_offs'] == 0
    assert summary['note_off_conventions']['velocity_zero'] == 1


def test_running_status_is_supported(tmp_path):
    track = (varlen(0) + bytes([0x90, 0x3C, 0x40])
             + varlen(480) + bytes([0x3C, 0x00])       # running status: same 0x90
             + varlen(0) + b'\xFF\x2F\x00')
    data = (b'MThd' + struct.pack('>IHHH', 6, 1, 1, DIVISION)
            + b'MTrk' + struct.pack('>I', len(track)) + track)
    path = tmp_path / 'running.mid'
    path.write_bytes(data)
    summary = vienna.performance_summary(path)
    assert summary['notes'] == 1
    assert summary['note_off_conventions']['velocity_zero'] == 1


def test_continuous_pedal_values_are_reported_as_not_binary(tmp_path):
    path = write_midi(tmp_path / 'c.mid', notes=[(0, 960, 60, 80)],
                      controllers=[(0, 64, 100), (480, 64, 40), (960, 64, 0)])
    summary = vienna.performance_summary(path)
    assert summary['sustain_is_binary'] is False
    assert 100 in summary['sustain_values']


def test_releases_under_the_pedal_are_counted(tmp_path):
    path = write_midi(tmp_path / 'd.mid', notes=[(0, 480, 60, 80)],
                      controllers=[(0, 64, 127), (960, 64, 0)])
    summary = vienna.performance_summary(path)
    assert summary['notes_released_under_sustain'] == 1


def test_malformed_files_are_rejected(tmp_path):
    path = tmp_path / 'bad.mid'
    path.write_bytes(b'not a midi file')
    with pytest.raises(vienna.MidiError, match='MThd'):
        vienna.parse_smf(path)


@pytest.mark.parametrize('name,work,performer,variant', [
    ('Chopin_op38_p01.mid', 'Chopin_op38', 'p01', 'primary'),
    ('Chopin_op10_no3_p23-average.mid', 'Chopin_op10_no3', 'p23', 'average'),
    ('Chopin_op38_1st-3rd_p07.mid', 'Chopin_op38', 'p07', 'excerpt'),
    ('Mozart_K331_1st-mov_p12.mid', 'Mozart_K331_1st-mov', 'p12', 'primary'),
])
def test_filename_classification(name, work, performer, variant):
    assert vienna.classify(name) == {'work': work, 'performer': performer, 'variant': variant}


def test_manifest_excludes_variants_from_independent_counts(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    assert manifest['summary']['primary_performances'] == 8
    assert manifest['summary']['excluded_files'] == 2
    assert manifest['summary']['works'] == ['Chopin_op38', 'WorkB']
    reasons = sorted(record['reason'] for record in manifest['excluded'])
    assert any('average' in reason for reason in reasons)
    assert any('excerpt' in reason for reason in reasons)
    assert all(record['notes'] == 2 for record in manifest['performances'])


def test_feasibility_table_shows_the_ceiling_before_a_split_is_fixed(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    table = vienna.feasibility(manifest)
    row = next(item for item in table['rows'] if item['held_out_performers'] == 2)
    assert row['max_holdout_performances'] == 4
    assert row['meets_40_gate_at_ceiling'] is False
    assert table['works'] == 2


def test_real_grid_arithmetic_matches_the_plan():
    """22 performers over four works: 12 held out yields at most 48 performances."""
    fake = {'summary': {'works': ['a', 'b', 'c', 'd'],
                        'performers': [f'p{index:02d}' for index in range(1, 23)]}}
    table = vienna.feasibility(fake)
    twelve = next(item for item in table['rows'] if item['held_out_performers'] == 12)
    nine = next(item for item in table['rows'] if item['held_out_performers'] == 9)
    assert twelve['max_holdout_performances'] == 48
    assert twelve['meets_40_gate_at_ceiling'] is True
    assert nine['max_holdout_performances'] == 36
    assert nine['meets_40_gate_at_ceiling'] is False


def test_split_is_deterministic_disjoint_and_forces_inspected_data_to_development(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    first = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    second = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    assert first == second
    people = first['performers']
    assert not set(people['holdout']) & set(people['calibration'])
    assert not set(people['holdout']) & set(people['development'])
    assert first['counts']['holdout'] == 4
    assert first['counts']['calibration'] == 2
    assert first['counts']['development'] == 2

    inspected = next(item for item in first['assignments']
                     if item['work'] == 'Chopin_op38' and item['performer'] == 'p01')
    assert inspected['split'] == 'development'


def test_split_refuses_to_consume_every_performer(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    with pytest.raises(ValueError, match='development performers'):
        vienna.propose_split(manifest, holdout_performers=4, calibration_performers=0)


def test_validation_rejects_a_duplicated_assignment(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    assert vienna.validate(manifest, split)['passed'] is True

    split['assignments'][1] = dict(split['assignments'][0])
    report = vienna.validate(manifest, split)
    assert report['passed'] is False
    assert 'assignments are a bijection over the primary performances' in report['failures']


def test_validation_rejects_an_omitted_performance(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    split['assignments'] = split['assignments'][:-1]
    report = vienna.validate(manifest, split)
    assert report['passed'] is False
    assert any('bijection' in failure for failure in report['failures'])


def test_validation_rejects_a_performer_moved_between_splits(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    moved = split['performers']['holdout'][0]
    split['performers']['holdout'] = split['performers']['holdout'][1:]
    split['performers']['development'] = sorted(
        set(split['performers']['development']) | {moved})
    report = vienna.validate(manifest, split)
    assert report['passed'] is False
    assert any('performer mapping' in failure or 'cover the corpus' in failure
               for failure in report['failures'])


def test_validation_rejects_overlapping_performer_sets(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    shared = split['performers']['development'][0]
    split['performers']['holdout'] = sorted(set(split['performers']['holdout']) | {shared})
    report = vienna.validate(manifest, split)
    assert report['passed'] is False
    assert any('performer' in failure for failure in report['failures'])


def test_validation_rejects_an_inspected_performance_in_holdout(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    inspected = next(item for item in split['assignments']
                     if item['work'] == 'Chopin_op38' and item['performer'] == 'p01')
    inspected['split'] = 'holdout'
    report = vienna.validate(manifest, split)
    assert report['passed'] is False
    assert any('inspected' in failure for failure in report['failures'])


def test_validation_checks_performer_against_file_identity(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    inspected = next(item for item in split['assignments'] if item['file'].endswith('Chopin_op38_p01.mid'))
    inspected['work'] = 'WorkB'
    inspected['performer'] = 'p02'
    inspected['split'] = 'holdout'
    report = vienna.validate(manifest, split)
    assert 'assignment metadata matches the actual performance' in report['failures']
    assert any('inspected' in failure for failure in report['failures'])


def test_validation_rejects_unknown_split_labels(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    split['performers']['experimental'] = split['performers'].pop('development')
    for item in split['assignments']:
        if item['split'] == 'development':
            item['split'] = 'experimental'
    assert 'split labels are supported' in vienna.validate(manifest, split)['failures']


def test_manifest_reports_metadata_complete_but_paired_data_partial(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    summary = manifest['summary']
    assert summary['metadata_complete'] is True
    assert summary['primary_performances'] == 8
    assert summary['audio_files'] == 1
    assert summary['paired_performances'] == 1
    assert summary['paired_readiness'] == 'partial'
    pair = manifest['audio_pairs'][0]
    assert pair['performance'] == 'Chopin_op38_p01'
    assert pair['alignment_verified'] is False


def test_end_of_performance_timings_are_reported_separately(tmp_path):
    path = write_midi(tmp_path / 'a.mid', notes=[(0, 480, 60, 80)],
                      controllers=[(0, 64, 127), (960, 64, 0)], end_tick=1920)
    summary = vienna.performance_summary(path)
    assert summary['last_note_release_seconds'] == pytest.approx(0.5, abs=0.01)
    assert summary['last_controller_seconds'] == pytest.approx(1.0, abs=0.01)
    assert summary['recording_end_seconds'] == pytest.approx(2.0, abs=0.01)


def test_validation_passes_and_reports_the_audio_end_difference(tmp_path):
    manifest = vienna.build_manifest(corpus(tmp_path))
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    report = vienna.validate(manifest, split)
    assert report['failures'] == []
    assert report['passed'] is True
    assert any('audio end' in item or 'explicit interval' in item
               for item in report['advisory'])
    assert any('captured key releases' in item for item in report['review_required'])


def test_validation_flags_missing_sustain(tmp_path):
    directory = corpus(tmp_path)
    write_midi(directory / 'vienna-midi-corrected' / 'WorkB_p02.mid',
               notes=[(0, 480, 60, 80)], controllers=[])
    manifest = vienna.build_manifest(directory)
    split = vienna.propose_split(manifest, holdout_performers=2, calibration_performers=1)
    report = vienna.validate(manifest, split)
    assert 'all primary performances carry sustain CC64' in report['failures']


def test_ingest_writes_all_artifacts(tmp_path):
    directory = corpus(tmp_path)
    output = tmp_path / 'out'
    result = vienna.ingest(directory, output, holdout_performers=2,
                           calibration_performers=1)
    assert result['validation']['passed'] is True
    for name in ('dataset-manifest.json', 'split-feasibility.json',
                 'split-proposal.json', 'validation.json'):
        assert (output / name).is_file(), name
    manifest = json.loads((output / 'dataset-manifest.json').read_text(encoding='utf-8'))
    assert manifest['schema'] == vienna.SCHEMA
    assert manifest['source']['license'] == 'CC-BY-4.0'
    assert manifest['performances'][0]['sha256']
