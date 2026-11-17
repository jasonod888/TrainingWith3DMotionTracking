"""Regenerate all pilot previews with native endings, amplitude mapping and headroom."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import render_piano_comparison as previews

BASES = [
    ROOT / '.local/repo-research/model-pilot/clip',
    ROOT / '.local/repo-research/model-pilot/vienna',
    ROOT / '.local/repo-research/model-pilot/vienna-api/comparisons',
    ROOT / 'model-pilot-output/live-comparisons',
]


def run_dirs():
    for base in BASES:
        if not base.exists():
            continue
        for document in base.rglob('document.json'):
            native = document.with_name('native.json')
            if native.is_file():
                yield document.parent


def main():
    rows = []
    for directory in sorted(set(run_dirs())):
        manifest = previews.render_run(directory / 'document.json',
                                       directory / 'preview',
                                       native_path=directory / 'native.json')
        entry = manifest['previews']['as_transcribed']
        rows.append({'run': str(directory.relative_to(ROOT)),
                     'notes': entry['note_count'],
                     'native_offsets': (entry['mapping']['native_offsets'] or {}).get('notes'),
                     'amplitude_notes': (entry['mapping']['amplitude_to_intensity'] or {}).get('notes'),
                     'clipping': entry['clipping'],
                     'peak_dbfs': entry['peak_dbfs'],
                     'headroom_db': entry['gain_policy']['headroom_db']})
    print(json.dumps(rows, indent=2))
    assert all(not row['clipping'] for row in rows), 'a preview still clips'


if __name__ == '__main__':
    main()
