"""Package 3: immutable attempts, honest child states and a static bypass guarantee."""
import json
from pathlib import Path

import pytest

import scripts.run_piano_comparison as jobs

ROOT = Path(__file__).resolve().parents[2]


def source(tmp_path):
    path = tmp_path / 'master.wav'
    path.write_bytes(b'not real audio, only an identity for this test')
    return path


def fake_runner(calls=None, *, fail=(), correction=False, warnings=None):
    calls = calls if calls is not None else []

    def runner(entry, path, interval, output_dir, *, timeout, python):
        calls.append({'variant': entry['id'], 'interval': list(interval),
                      'timeout': timeout})
        if entry['id'] in fail:
            raise jobs.ComparisonJobError('simulated failure')
        receipt = {
            'schema': 'piano-model-run-receipt-1', 'version': 1,
            'mode': jobs.MODE, 'variant': entry['id'],
            'correction_enabled': correction,
            'expression_correction_enabled': False,
            'correction_operations': 0,
            'warnings': warnings or [],
        }
        (output_dir / 'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
        return receipt
    return runner


def create(tmp_path, variants=('basic-pitch-native', 'kong-piano')):
    created = jobs.create(source(tmp_path), [0.0, 1.5], variants,
                          base_dir=tmp_path / 'comparisons',
                          comparison_id='comparison-1')
    return Path(created['directory'])


def test_create_freezes_source_interval_and_variants(tmp_path):
    directory = create(tmp_path, ('basic-pitch-native', 'transkun-v2'))
    record = json.loads((directory / 'comparison.json').read_text(encoding='utf-8'))
    assert record['schema'] == jobs.SCHEMA
    assert record['source']['interval'] == [0.0, 1.5]
    assert record['source']['sha256']
    assert record['requested'] == ['basic-pitch-native', 'transkun-v2']
    assert record['runs']['transkun-v2']['blocked'] is True
    assert record['correction_enabled'] is False


def test_execute_runs_permitted_children_and_records_blocked_rows(tmp_path):
    directory = create(tmp_path, ('basic-pitch-native', 'kong-piano',
                                  'transkun-v2', 'onsets-frames-piano'))
    calls = []
    record = jobs.execute(directory, runner=fake_runner(calls))
    assert record['status'] == 'partial'
    assert len(calls) == 2                       # blocked rows never execute
    assert record['runs']['basic-pitch-native']['status'] == 'ready'
    assert record['runs']['kong-piano']['status'] == 'ready'
    assert record['runs']['transkun-v2']['status'] == 'blocked_license'
    assert record['runs']['onsets-frames-piano']['status'] == 'blocked_license'
    assert record['runs']['transkun-v2']['blocked_reasons']
    assert record['runs']['basic-pitch-native']['attempts'][0]['status'] == 'ready'
    assert record['correction_enabled'] is False


def test_a_receipt_without_the_bypass_fails_the_child(tmp_path):
    directory = create(tmp_path, ('kong-piano',))
    record = jobs.execute(directory, runner=fake_runner(correction=True))
    child = record['runs']['kong-piano']
    assert child['status'] == 'failed'
    assert 'bypass was not recorded' in child['error']
    assert record['status'] == 'failed'


def test_a_failed_child_does_not_stop_the_next_one(tmp_path):
    directory = create(tmp_path, ('basic-pitch-native', 'kong-piano'))
    record = jobs.execute(directory, runner=fake_runner(fail=('basic-pitch-native',)))
    assert record['runs']['basic-pitch-native']['status'] == 'failed'
    assert record['runs']['kong-piano']['status'] == 'ready'
    assert record['status'] == 'partial'


def test_execute_runs_one_inference_at_a_time(tmp_path):
    directory = create(tmp_path, ('basic-pitch-native', 'kong-piano'))
    active = []

    def runner(entry, path, interval, output_dir, *, timeout, python):
        active.append(entry['id'])
        assert len(active) == 1
        active.pop()
        return fake_runner()(entry, path, interval, output_dir, timeout=timeout,
                             python=python)
    jobs.execute(directory, runner=runner)
    assert active == []


def test_retry_creates_a_new_attempt_without_touching_the_old_one(tmp_path):
    directory = create(tmp_path, ('kong-piano',))
    first = jobs.execute(directory, runner=fake_runner())
    first_dir = Path(first['runs']['kong-piano']['attempts'][0]['directory'])
    first_bytes = (first_dir / 'receipt.json').read_bytes()
    second = jobs.execute(directory, runner=fake_runner())
    attempts = second['runs']['kong-piano']['attempts']
    assert [attempt['attempt'] for attempt in attempts] == [1, 2]
    assert Path(attempts[1]['directory']).name == 'attempt-2'
    assert (first_dir / 'receipt.json').read_bytes() == first_bytes


def test_an_already_running_parent_is_not_executed_twice(tmp_path):
    directory = create(tmp_path, ('kong-piano',))
    record = json.loads((directory / 'comparison.json').read_text(encoding='utf-8'))
    record['status'] = 'running'
    (directory / 'comparison.json').write_text(json.dumps(record), encoding='utf-8')
    with pytest.raises(jobs.ComparisonJobError, match='already being executed'):
        jobs.execute(directory, runner=fake_runner())


def test_a_warning_child_makes_the_parent_partial(tmp_path):
    directory = create(tmp_path, ('kong-piano',))
    record = jobs.execute(directory, runner=fake_runner(warnings=['output clipped']))
    assert record['runs']['kong-piano']['status'] == 'partial'
    assert record['status'] == 'partial'


def test_all_ready_children_make_the_parent_complete(tmp_path):
    directory = create(tmp_path, ('kong-piano',))
    record = jobs.execute(directory, runner=fake_runner())
    assert record['status'] == 'complete'


def test_all_blocked_parent_is_blocked_not_complete(tmp_path):
    directory = create(tmp_path, ('transkun-v2', 'onsets-frames-piano'))
    record = jobs.execute(directory, runner=fake_runner())
    assert record['status'] == 'blocked'
    assert all(child['status'] == 'blocked_license'
               for child in record['runs'].values())


def test_unknown_variant_is_refused(tmp_path):
    with pytest.raises(jobs.ComparisonJobError, match='unknown variants'):
        jobs.create(source(tmp_path), [0.0, 1.0], ['not-a-model'],
                    base_dir=tmp_path / 'comparisons')


def test_duplicate_comparison_id_is_refused(tmp_path):
    create(tmp_path)
    with pytest.raises(jobs.ComparisonJobError, match='already exists'):
        create(tmp_path)


def test_the_runner_never_imports_a_correction_stage():
    text = Path(jobs.__file__).read_text(encoding='utf-8')
    for forbidden in ('music_verification', 'piano_verifier', 'piano_expression',
                      'conversions', 'automatic_working_document',
                      'automatic_expression_document'):
        assert forbidden not in text


def test_interpreter_layouts_are_platform_aware():
    windows = jobs._venv_python('.venv-music', 'nt')
    posix = jobs._venv_python('.venv-music', 'posix')
    assert windows.parts[-2:] == ('Scripts', 'python.exe')
    assert posix.parts[-2:] == ('bin', 'python')
    assert '.venv-music' in windows.parts and '.venv-music' in posix.parts


def test_each_family_uses_its_own_pinned_interpreter(tmp_path, monkeypatch):
    from scripts import piano_model_registry
    built = piano_model_registry.build()
    basic = piano_model_registry.variant(built, 'basic-pitch-native')
    kong = piano_model_registry.variant(built, 'kong-piano')
    basic_python = tmp_path / 'basic-python'
    kong_python = tmp_path / 'kong-python'
    basic_python.touch()
    kong_python.touch()
    monkeypatch.setitem(jobs.RUNTIME_INTERPRETERS, 'basic-pitch', basic_python)
    monkeypatch.setitem(jobs.RUNTIME_INTERPRETERS, 'kong', kong_python)
    assert Path(jobs._interpreter(basic)) == basic_python
    assert Path(jobs._interpreter(kong)) == kong_python
    assert jobs._interpreter(kong, 'custom-python') == 'custom-python'


def test_markdown_reports_blocked_reasons(tmp_path):
    directory = create(tmp_path, ('kong-piano', 'transkun-v2'))
    record = jobs.execute(directory, runner=fake_runner())
    text = jobs.markdown(record)
    assert 'transkun-v2' in text
    assert 'blocked_license' in text
    assert 'model_selection=unresolved' in text
