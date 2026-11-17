"""Rescore both pilot comparisons after the preview fidelity fixes."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import compare_piano_models as cmp
from scripts import piano_model_registry as registry

CLIP = ROOT / '.local/repo-research/model-pilot/clip'
VIENNA = ROOT / '.local/repo-research/model-pilot/vienna'
OWNER_AUDIO = ROOT / '.local/piano-correction-trial-20261112/source.wav'
VIENNA_AUDIO = ROOT / '.local/commercial-piano-data/vienna-original-sample.wav'


def runs(base):
    return {variant: {'receipt': str(base / variant / 'receipt.json')}
            for variant in ('basic-pitch-native', 'basic-pitch-current-app', 'kong-piano')}


def main():
    clip = cmp.evaluate(None, runs(CLIP), interval=[0.0, 15.616009],
                        output=CLIP / 'comparison', registry=registry.build(),
                        source_audio=OWNER_AUDIO)
    vienna = cmp.evaluate(VIENNA / 'reference.json', runs(VIENNA),
                          interval=[0.0, 128.19927437641724],
                          output=VIENNA / 'comparison', registry=registry.build(),
                          source_audio=VIENNA_AUDIO)
    summary = {}
    for name, result in (('clip', clip), ('vienna', vienna)):
        summary[name] = {
            variant: {
                'audio_state': model['attributes']['audio']['state'],
                'objective': (model['attributes']['audio']['value'] or {}).get('objective'),
                'fixed_gain_objective': (model['attributes']['audio']['value'] or {}).get('fixed_gain_objective'),
                'clipping': (model['attributes']['audio']['value'] or {}).get('clipping'),
                'relative_dynamics': model['attributes']['relative_dynamics']['state'],
            } for variant, model in result['models'].items()}
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
