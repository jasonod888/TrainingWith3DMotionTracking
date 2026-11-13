"""W4 inventories the real mapping structure and refuses to claim untested support."""
import json
from pathlib import Path

import pytest

import scripts.prepare_vienna_dataset as vienna
import scripts.probe_sampler as sampler

ROOT_SFZ = '''// test mapping
<control>
default_path=Samples/
label_cc64=Sus Pedal

#define $VEL v1

<group> #include "Data/defs.txt" lovel=1 hivel=26 #include "Data/regions.txt"

<master>
locc$VOL=1
amplitude_oncc$VOL=200
#include "Data/noise.txt"
'''


def build_mapping(directory, missing=False):
    (directory / 'Data').mkdir(parents=True, exist_ok=True)
    (directory / 'Samples').mkdir(parents=True, exist_ok=True)
    (directory / 'Data' / 'defs.txt').write_text('#define $VEL v2\n#define $OFF01 481\n',
                                                 encoding='utf-8')
    (directory / 'Data' / 'regions.txt').write_text(
        'group_label=$VEL\n'
        '<region> lokey=21 hikey=22 pitch_keycenter=21 '
        'offset_oncc98=$OFF01 sample=a$VEL.flac\n',
        encoding='utf-8')
    if not missing:
        (directory / 'Data' / 'noise.txt').write_text(
            '<region> sample=noise.wav trigger=release lovel=1\n', encoding='utf-8')
    path = directory / 'mapping.sfz'
    path.write_text(ROOT_SFZ, encoding='utf-8')
    return path


def test_expansion_is_in_order_and_root_relative(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    expanded = sampler.expand(path)
    text = '\n'.join(expanded['lines'])
    assert 'sample=av2.flac' in text           # the include defined $VEL before use
    assert 'offset_oncc98=481' in text
    assert expanded['missing_includes'] == []
    assert len(expanded['files']) == 4


def test_missing_include_is_recorded_not_ignored(tmp_path):
    path = build_mapping(tmp_path / 'instrument', missing=True)
    expanded = sampler.expand(path)
    assert expanded['missing_includes']
    value = sampler.inventory(path)
    selection = sampler.selection_artifact(value)
    assert any('missing include' in blocker for blocker in selection['blockers'])


def test_macro_substitution_follows_dependency_order(tmp_path):
    path = tmp_path / 'a.sfz'
    path.write_text('#define $A x\n#define $B $A-y\n<region> sample=$B.wav\n',
                    encoding='utf-8')
    expanded = sampler.expand(path)
    assert 'sample=x-y.wav' in '\n'.join(expanded['lines'])


def test_inventory_counts_headers_opcodes_and_controllers(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    value = sampler.inventory(path)
    assert value['schema'] == sampler.SCHEMA
    assert value['headers']['region'] == 2
    assert value['regions'] == 2
    assert value['opcodes']['lovel'] == 2
    assert value['opcodes']['pitch_keycenter'] == 1
    assert value['support'] == 'untested'
    assert 98 in value['controller_numbers']
    assert 64 in value['controller_numbers']
    assert len(value['sha256']) == 64


def test_probe_plan_separates_present_from_absent_opcodes(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    plan = sampler.probe_plan(sampler.inventory(path)['opcodes'])
    assert plan['schema'] == sampler.PROBE_SCHEMA
    assert all(item['support'] == 'untested' for item in plan['probes'])
    velocity = next(item for item in plan['probes'] if item['probe'] == 'strike_soft_to_loud')
    assert 'lovel' in velocity['opcodes_present']
    release = next(item for item in plan['probes'] if item['probe'] == 'release_pedal_up')
    assert 'trigger' in release['opcodes_present']
    pedal = next(item for item in plan['probes'] if item['probe'] == 'release_pedal_down')
    assert 'on_locc64' in pedal['opcodes_absent']


def test_probe_files_are_valid_midi_and_measure_what_they_claim(tmp_path):
    manifest = sampler.write_probes(tmp_path / 'probes')
    assert manifest['schema'] == 'sampler-probe-files-1'
    files = {item['probe']: item for item in manifest['probes']}
    assert 'dense_chord' in files
    for item in files.values():
        from pathlib import Path
        assert Path(item['file']).is_file()

    chord = vienna.performance_summary(tmp_path / 'probes' / 'dense_chord.mid')
    assert chord['notes'] == 12

    repeated = vienna.performance_summary(tmp_path / 'probes' / 'repeat_strikes.mid')
    assert repeated['notes'] == 3
    assert repeated['same_pitch_overlaps'] == 0

    pedal_down = vienna.performance_summary(tmp_path / 'probes' / 'release_pedal_down.mid')
    assert pedal_down['sustain_events'] == 1
    assert pedal_down['notes_released_under_sustain'] == 1

    pedal_up = vienna.performance_summary(tmp_path / 'probes' / 'release_pedal_up.mid')
    assert pedal_up['sustain_events'] == 0


def test_inventory_hashes_every_included_file(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    value = sampler.inventory(path)
    assert value['dependencies_hashed'] is True
    assert len(value['dependencies']) == 4
    assert {item['path'] for item in value['dependencies']} == {
        'mapping.sfz', 'Data/defs.txt', 'Data/regions.txt', 'Data/noise.txt'}
    assert all(len(item['sha256']) == 64 for item in value['dependencies'])
    assert len(value['dependencies_sha256']) == 64


def test_changing_an_included_value_changes_the_aggregate_digest(tmp_path):
    """The review probe: a changed include kept the opcode counts but must not keep identity."""
    directory = tmp_path / 'instrument'
    path = build_mapping(directory)
    before = sampler.inventory(path)
    regions = (directory / 'Data' / 'regions.txt')
    regions.write_text(regions.read_text(encoding='utf-8').replace(
        'lokey=21', 'lokey=22'), encoding='utf-8')
    after = sampler.inventory(path)
    assert after['opcode_count'] == before['opcode_count']
    assert after['dependencies_sha256'] != before['dependencies_sha256']


def test_missing_include_disables_the_hashed_claim(tmp_path):
    path = build_mapping(tmp_path / 'instrument', missing=True)
    value = sampler.inventory(path)
    assert value['dependencies_hashed'] is False
    assert value['missing_includes']


def test_sample_references_are_counted_without_being_loaded(tmp_path):
    directory = tmp_path / 'instrument'
    path = build_mapping(directory)
    value = sampler.inventory(path)
    assert value['samples']['referenced'] == 2      # av2.flac and noise.wav
    assert value['samples']['missing'] == 2
    (directory / 'Samples' / 'av2.flac').write_bytes(b'not really a flac')
    (directory / 'Samples' / 'noise.wav').write_bytes(b'not really a wav')
    present = sampler.inventory(path)
    assert present['samples']['present'] == 2
    assert present['samples']['missing'] == 0


def test_selection_artifact_reports_dependency_and_sample_state(tmp_path):
    directory = tmp_path / 'instrument'
    path = build_mapping(directory)
    selection = sampler.selection_artifact(sampler.inventory(path))
    assert selection['mapping']['dependencies_hashed'] is True
    assert selection['mapping']['dependencies_sha256']
    assert selection['mapping']['sample_state']['missing'] == 2
    assert any('sample file(s) are absent' in blocker for blocker in selection['blockers'])
    (directory / 'Samples' / 'av2.flac').write_bytes(b'x')
    (directory / 'Samples' / 'noise.wav').write_bytes(b'x')
    complete = sampler.selection_artifact(sampler.inventory(path),
                                          engine='sfizz-1.2.3', samples='salamander-v3')
    assert complete['decision'] == 'pending-probes'
    assert complete['blockers'] == []


def test_selection_artifact_stays_blocked_without_engine_and_samples(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    value = sampler.inventory(path)
    selection = sampler.selection_artifact(value)
    assert selection['schema'] == sampler.SELECTION_SCHEMA
    assert selection['decision'] == 'blocked'
    assert any('no sampler engine' in blocker for blocker in selection['blockers'])
    assert any('no instrument samples' in blocker for blocker in selection['blockers'])
    assert selection['determinism'] == 'untested'
    assert all(item['support'] == 'untested' for item in selection['features'])
    assert 'BSD-2-Clause' in selection['licenses']['engine']
    assert 'CC BY 3.0' in selection['licenses']['samples']


def test_selection_artifact_moves_to_pending_probes_once_configured(tmp_path):
    directory = tmp_path / 'instrument'
    path = build_mapping(directory)
    (directory / 'Samples' / 'av2.flac').write_bytes(b'x')
    (directory / 'Samples' / 'noise.wav').write_bytes(b'x')
    selection = sampler.selection_artifact(sampler.inventory(path),
                                           engine='sfizz-1.2.3', samples='salamander-v3')
    assert selection['decision'] == 'pending-probes'
    assert selection['blockers'] == []


def _fake_renderer(flat_velocity=False):
    """A deterministic stand-in engine, so the runner and measurements can be tested."""
    from scripts.piano_reconstruction_harness import write_wav
    import numpy as np

    def render(sfz_path, midi_path, wav_path):
        name = Path(midi_path).stem
        rate = 8000
        seconds = {'strike_soft_to_loud': 2.0, 'repeat_strikes': 1.0,
                   'release_pedal_up': 1.0, 'release_pedal_down': 2.0, 'pedal_lift': 2.0,
                   'dense_chord': 2.0, 'strike_loud': 1.0, 'release_key_held': 2.0}[name]
        times = np.arange(int(seconds * rate)) / rate
        tone = np.sin(2 * np.pi * 261.625565 * times)
        if name == 'strike_soft_to_loud':
            levels = np.array([0.9, 0.9, 0.9]) if flat_velocity else np.array([0.1, 0.3, 0.9])
            audio = np.zeros_like(times)
            for start, level in zip((0., .5, 1.), levels):
                audio += ((times >= start) & (times < start + .4)) * level * tone
        elif name == 'repeat_strikes':
            audio = np.zeros_like(times)
            for strike in range(3):
                start = strike * 0.25
                audio += ((times >= start) & (times < start + 0.18)) * 0.5 * tone
        elif name == 'release_pedal_up':
            audio = 0.4 * tone * np.exp(-times / 0.2)
        elif name == 'release_pedal_down':
            audio = 0.4 * tone * np.exp(-times / 2.0)
        elif name == 'release_key_held':
            audio = 0.4 * tone * np.exp(-times / 2.0)
        elif name == 'pedal_lift':
            audio = 0.4 * tone * np.where(times < .75, 1.0, 0.02)
        elif name == 'dense_chord':
            audio = 0.04 * sum(np.sin(2 * np.pi * 440 * 2 ** ((pitch - 69) / 12) * times)
                               for pitch in range(48, 60))
        else:
            audio = 0.4 * tone
        write_wav(wav_path, audio.astype(np.float32), rate, bit_depth=16)

    return render


def test_probe_runner_measures_a_passing_engine(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    directory = tmp_path / 'instrument'
    (directory / 'Samples' / 'av2.flac').write_bytes(b'x')
    (directory / 'Samples' / 'noise.wav').write_bytes(b'x')
    probes = tmp_path / 'probes'
    sampler.write_probes(probes)
    results = sampler.run(render_callable=_fake_renderer(), sfz=path, probes=probes,
                          output=tmp_path / 'renders')
    assert results['schema'] == 'sampler-probe-results-1'
    assert set(results['probes']) >= {'strike_loud', 'release_pedal_up', 'pedal_lift'}
    assert results['deterministic'] is True
    assert results['features']['velocity layers']['supported'] is True
    assert results['features']['repeated same-pitch strikes']['supported'] is True
    assert results['features']['sustain pedal behaviour']['supported'] is True
    assert results['features']['pedal lift']['supported'] is True
    assert results['features']['pitch and attack']['supported'] is True
    assert results['features']['dense polyphony']['supported'] is True
    assert results['features']['key release control']['supported'] is True
    assert results['features']['release samples']['supported'] is None

    selection = sampler.selection_artifact(sampler.inventory(path), engine='fake',
                                           samples='fake', measurements=results)
    assert selection['decision'] == 'pending-probes'
    assert selection['unsupported_mandatory'] == []
    assert 'velocity layers' in selection['mandatory_features']
    assert 'pedal lift' in selection['mandatory_features']  # Engine-level CC64 still matters.
    assert selection['untested_mandatory'] == ['release samples']


def test_probe_runner_fails_when_a_mandatory_feature_is_unsupported(tmp_path):
    path = build_mapping(tmp_path / 'instrument')
    directory = tmp_path / 'instrument'
    (directory / 'Samples' / 'av2.flac').write_bytes(b'x')
    (directory / 'Samples' / 'noise.wav').write_bytes(b'x')
    probes = tmp_path / 'probes'
    sampler.write_probes(probes)
    results = sampler.run(render_callable=_fake_renderer(flat_velocity=True), sfz=path,
                          probes=probes, output=tmp_path / 'renders')
    assert results['features']['velocity layers']['supported'] is False
    selection = sampler.selection_artifact(sampler.inventory(path), engine='fake',
                                           samples='fake', measurements=results)
    assert selection['decision'] == 'failed'
    assert selection['unsupported_mandatory'] == ['velocity layers']


def test_required_features_follow_the_mapping_not_a_blanket_list():
    required = sampler.required_features({'lovel': 3, 'trigger': 2, 'off_time': 1})
    assert required['velocity layers'] is True
    assert required['release samples'] is True
    assert required['pedal lift'] is True
    assert required['repeated same-pitch strikes'] is True
    assert required['sustain pedal behaviour'] is True


def test_rendering_is_refused_without_an_engine():
    with pytest.raises(sampler.EngineUnavailable, match='no sampler engine'):
        sampler.run()


def test_cli_writes_inventory_and_selection(tmp_path, capsys):
    path = build_mapping(tmp_path / 'instrument')
    output = tmp_path / 'out'
    code = sampler.main(['--sfz', str(path), '--output', str(output),
                         '--probes', str(tmp_path / 'probes'), '--summary'])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload['decision'] == 'blocked'
    assert (output / 'opcode-inventory.json').is_file()
    assert (output / 'renderer-selection.json').is_file()
    assert (tmp_path / 'probes' / 'strike_loud.mid').is_file()
