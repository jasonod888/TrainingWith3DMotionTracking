import json, pathlib, sys
sys.path.insert(0, '.')
from scripts import render_piano_comparison as previews
base = pathlib.Path('model-pilot-output/clip')
for variant in ('basic-pitch-native', 'basic-pitch-current-app', 'kong-piano'):
    manifest = previews.render_run(base / variant / 'document.json', base / variant / 'preview')
    print(variant, manifest['previews']['as_transcribed']['rendered_notes'],
          manifest['previews']['as_transcribed']['seconds'],
          manifest['previews']['as_transcribed']['clipping'])
