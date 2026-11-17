import pathlib, sys
sys.path.insert(0, '.')
from scripts import render_piano_comparison as previews
base = pathlib.Path('model-pilot-output/vienna')
for variant in ('basic-pitch-native', 'basic-pitch-current-app', 'kong-piano'):
    manifest = previews.render_run(base / variant / 'document.json', base / variant / 'preview')
    a = manifest['previews']['as_transcribed']
    print(variant, a['rendered_notes'], a['seconds'], a['peak_dbfs'], a['clipping'])
