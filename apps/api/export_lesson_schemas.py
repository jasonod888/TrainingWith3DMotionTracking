"""Generate the checked-in lesson schema artifacts from the API contracts.

Usage:
    python -m apps.api.export_lesson_schemas           # rewrite artifacts
    python -m apps.api.export_lesson_schemas --check   # exit non-zero on drift

Four artifacts, one job each:

* ``manifest.schema.json``        body v1, unchanged by music work
* ``music-manifest.schema.json``  music v2
* ``lesson-boundary.schema.json`` the mixed boundary union used by new readers
* ``act-descriptors.json`` the generated server Act descriptor facts consumed by web

The body artifact is regenerated from the same model on purpose: an unauthorised
body contract change must fail the drift check rather than slip through.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic import TypeAdapter

from .contracts import LessonDocument, LessonManifest, MusicLessonManifest
from . import acts

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / 'packages' / 'lesson-schema'


def boundary_schema() -> dict:
    return TypeAdapter(LessonDocument).json_schema()


ARTIFACTS = {
    'manifest.schema.json': lambda: LessonManifest.model_json_schema(),
    'music-manifest.schema.json': lambda: MusicLessonManifest.model_json_schema(),
    'lesson-boundary.schema.json': boundary_schema,
    'act-descriptors.json': lambda: {
        'descriptor_version': acts.ACT_DESCRIPTOR_VERSION,
        'acts': acts.catalogue(),
    },
}


def render(schema: dict) -> str:
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=False) + '\n'


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    unknown = [value for value in argv if value != '--check']
    if unknown:
        print(f'Unknown argument: {unknown[0]}', file=sys.stderr)
        return 2
    check = '--check' in argv
    drift = []
    for name, build in ARTIFACTS.items():
        path = SCHEMA_DIR / name
        expected = render(build())
        if check:
            actual = path.read_text(encoding='utf-8') if path.is_file() else None
            if actual != expected:
                drift.append(name)
            continue
        path.write_text(expected, encoding='utf-8', newline='\n')
        print(f'wrote {path.relative_to(ROOT)}')
    if drift:
        for name in drift:
            path = SCHEMA_DIR / name
            try:
                shown = path.relative_to(ROOT)
            except ValueError:
                shown = path
            print(f'drift: {shown}', file=sys.stderr)
        print('Run: python -m apps.api.export_lesson_schemas', file=sys.stderr)
        return 1
    if check:
        print(f'{len(ARTIFACTS)} schema artifacts are current')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
