import json, pathlib, sys
sys.path.insert(0, '.')
from scripts import piano_quality_reference as ref
out = pathlib.Path('model-pilot-output/vienna')
out.mkdir(parents=True, exist_ok=True)
source = ref.source_from_audio('.local/commercial-piano-data/vienna-original-sample.wav')
value = ref.from_captured_midi(
    '.local/commercial-piano-data/vienna-midi-corrected/Chopin_op38_p01.mid',
    reference_id='vienna-chopin-op38-p01-full', source=source,
    performance={'performance_id': 'vienna-chopin-op38-p01', 'performer_id': 'p01',
                 'recording_id': 'vienna4x22-chopin-op38', 'work_id': 'chopin-op38'},
    rights={'license': 'CC-BY-4.0', 'status': 'approved',
            'receipt_id': 'vienna-4x22-cpjkv-1033ade'},
    scored_interval=[0.0, source['seconds']], split='development',
    provenance='captured performance MIDI, CPJKU corrected release')
(out / 'reference.json').write_text(json.dumps(value, indent=2, sort_keys=True), encoding='utf-8')
print('seconds', round(source['seconds'], 6), 'notes', len(value['attributes']['pitch_onset']['events']),
      'velocity', value['attributes']['velocity']['status'], 'pedal', value['attributes']['pedal']['status'])
