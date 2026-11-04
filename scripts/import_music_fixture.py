"""Import one internal music fixture lesson through the operator path.

Usage:
    python scripts/import_music_fixture.py --owner <account-id> --manifest path/to/manifest.json

The manifest directory must contain every asset the manifest names. Nothing is
accepted from HTTP, every checksum is verified before the database changes, and no
worker or model runs. The imported lesson is an internal fixture: it is not publicly
listable, and music publication stays guarded until a reviewed reference exists.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.api.config import Settings
from apps.api.database import make_engine
from apps.api.lessons import import_music_fixture


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner', required=True, help='Verified account ID that owns the fixture')
    parser.add_argument('--manifest', required=True, type=Path, help='Music manifest v2 JSON file')
    parser.add_argument('--assets', type=Path, default=None, help='Asset directory (defaults to the manifest folder)')
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    asset_dir = (args.assets or manifest_path.parent).resolve()
    settings = Settings()
    try:
        manifest = import_music_fixture(make_engine(settings.sqlalchemy_url), settings, args.owner,
                                        manifest_path, asset_dir)
    except (ValueError, FileNotFoundError) as exc:
        print(f'Import refused: {exc}', file=sys.stderr)
        return 1
    print(json.dumps({'lesson_id': manifest.lesson_id, 'revision_id': manifest.revision_id,
                      'subject': manifest.subject, 'instrument': manifest.instrument.instrument}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
