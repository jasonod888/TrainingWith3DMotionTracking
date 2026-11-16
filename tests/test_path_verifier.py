import copy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'phase7_bench_paths', ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/bench-paths.py')
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def note(identifier, pitch=60, duration=0.5, onset=1.0, spelling='C4'):
    return {'id': identifier, 'pitch': pitch, 'duration': duration, 'onset': onset,
            'velocity': 0.6, 'confidence': None, 'optional': False, 'string': None, 'fret': None,
            'spelling': spelling, 'accidental': None, 'performance_ids': [identifier]}


def document(performance, events, segments=None):
    return {'performance': performance, 'events': events,
            'segments': segments or [], 'ties': [], 'performance_map': {n['id']: f"logical-{n['id']}" for n in performance},
            'measures': []}


def state(document_value, past=0):
    return {'document': document_value, 'past': past, 'future': 0, 'dirty': past > 0, 'selection': None}


def test_wrong_target_and_noop_fail():
    before = state(document([note('a', 60)], [{'id': 'e', 'duration': 240,
                                                'notes': [{'id': 'a', 'pitch': 60, 'performance_ids': ['a']}]}]))
    after = copy.deepcopy(before)
    after['past'] = 1
    assert bench.verify_edit('roll_pitch', before, after, {'occurrence': 'a', 'pitch': 60}) is False
    assert bench.verify_edit('written_duration', before, after, {'occurrence': 'a', 'ticks': 480}) is False
    assert bench.verify_edit('respell', before, after, {'occurrence': 'a', 'spelling': 'B#3'}) is False
    assert bench.verify_edit('add_note', before, after, {'total': 1}) is False
    assert bench.verify_edit('delete_note', before, after, {'occurrence': 'a'}) is False


def test_pitch_edit_with_corrupted_preserved_onset_fails():
    before = state(document([note('a', 60)], [{'id': 'e', 'duration': 240,
                                                'notes': [{'id': 'a', 'pitch': 60, 'performance_ids': ['a']}]}]))
    after = copy.deepcopy(before)
    after['past'] = 1
    after['document']['performance'][0]['pitch'] = 61
    after['document']['events'][0]['notes'][0]['pitch'] = 61
    after['document']['performance'][0]['onset'] += 0.01
    assert bench.verify_edit('roll_pitch', before, after, {'occurrence': 'a', 'pitch': 60}) is False



def test_wrong_written_ticks_and_respell_fail_even_when_changed():
    before = state(document([note('a', 60)], [{'id': 'e', 'duration': 240,
                                                'notes': [{'id': 'a', 'pitch': 60, 'performance_ids': ['a']}]}]))
    after = copy.deepcopy(before)
    after['past'] = 1
    after['document']['events'][0]['duration'] = 480
    assert bench.verify_edit('written_duration', before, after,
                             {'occurrence': 'a', 'ticks': 960}) is False
    changed_spelling = copy.deepcopy(before)
    changed_spelling['past'] = 1
    changed_spelling['document']['events'][0]['notes'][0]['spelling'] = 'C#4'
    assert bench.verify_edit('respell', before, changed_spelling,
                             {'occurrence': 'a', 'spelling': 'Db4'}) is False
