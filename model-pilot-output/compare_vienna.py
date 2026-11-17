import json, pathlib, sys
sys.path.insert(0, '.')
from scripts import compare_piano_models as cmp
from scripts import piano_model_registry as reg
base = pathlib.Path('model-pilot-output/vienna')
runs = {v: {'receipt': str(base / v / 'receipt.json')} for v in
        ('basic-pitch-native', 'basic-pitch-current-app', 'kong-piano')}
result = cmp.evaluate(base / 'reference.json', runs, output=base / 'comparison',
                      registry=reg.build(), created_at='2026-11-13T00:00:00Z')
for v, m in result['models'].items():
    a = m['attributes']
    c, t, vel, ped = (a['note_correctness'], a['fine_timing'], a['velocity'], a['pedal'])
    print(v)
    print('  correctness', c['state'], {k: c['value'][k] for k in ('matched','missing','extra','precision','recall','f1')})
    print('  timing', t['state'], {k: t['value'][k] for k in ('mae_seconds','p95_seconds','bias_seconds','all_reference_within_tolerance')})
    print('  velocity', vel['state'], (vel['value'] or {}).get('mae'))
    print('  pedal', ped['state'], [ (r.get('pedal_type'), r.get('f1'), r.get('time_weighted_agreement')) for r in (ped['value'] or {}).get('types', []) ])
