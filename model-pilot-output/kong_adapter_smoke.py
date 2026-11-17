"""Smoke-test the Kong adapter on the owner's clip without the worker transport."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import music_kong_adapter as kong
from scripts import piano_model_adapters as adapters

OUT = ROOT / 'model-pilot-output/kong-adapter-smoke'
SOURCE = ROOT / '.local/piano-correction-trial-20261112/source.wav'
PACKAGE = ROOT / '.local/piano-diagnosis/reference-packages/extracted/piano_transcription_inference'
CHECKPOINT = ROOT / '.local/piano-diagnosis/reference-packages/piano.pth'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    prepared = adapters.prepare_audio(SOURCE, OUT / 'input.wav',
                                      interval=[0.0, 15.616009], sample_rate=16000)
    profile = {'sample_rate': 16000, 'package_path': str(PACKAGE),
               'model_version': '0.0.6', 'profile_sha256': '0' * 64,
               'device': 'cpu'}
    result, audio = kong.transcribe(prepared['path'], profile, CHECKPOINT, 'cpu')
    draft, native = kong.build(15.616009, result, profile, prepared['sha256'], 'x' * 64)
    (OUT / 'reference.json').write_text(json.dumps(draft, indent=2), encoding='utf-8')
    entry = kong.render_preview(draft, native, prepared['path'], OUT / 'preview.wav')
    print(json.dumps({'notes': len(draft['events']), 'preview_seconds': entry['seconds'],
                      'clipping': entry['clipping'],
                      'native_offsets': entry['mapping']['native_offsets']['notes'],
                      'peaks': entry['peak_dbfs']}, indent=2))


if __name__ == '__main__':
    main()
