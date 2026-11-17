import json, pathlib, sys
sys.path.insert(0, '.')
from scripts import compare_piano_models as cmp
from scripts import piano_model_registry as reg
base = pathlib.Path('model-pilot-output/clip')
runs = {v: {'receipt': str(base / v / 'receipt.json')} for v in
        ('basic-pitch-native', 'basic-pitch-current-app', 'kong-piano')}
result = cmp.evaluate(None, runs, interval=[0.0, 15.616009],
                      output=base / 'comparison', registry=reg.build(),
                      created_at='2026-11-13T00:00:00Z')
print('models', list(result['models']))
for v, m in result['models'].items():
    print(v, m['attributes']['detected_notes']['value'],
          m['attributes']['note_correctness']['state'],
          m['attributes']['velocity']['state'],
          m['attributes']['pedal']['state'])
print('blocked', [b['variant'] for b in result['blocked']])
