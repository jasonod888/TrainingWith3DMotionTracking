from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
insert = """## Verification

- Full suite: **911 passed, 14 skipped, 0 failed** (8 min 56 s) after regenerating the
  lesson schema artifacts for the new draft/manifest fields.
- Web: **326 tests pass**; TypeScript check and production build pass.
- Seeded Chromium acceptance (`.local/repo-research/kong-review-browser/`): review and
  lesson Original/Piano switching, +120 ms/−200 ms offsets, source-zero mapping, mid-note
  switch, loop, 1.5x speed, leading silence, disabled Piano with a reason when no preview,
  and a dense 1 200-note lesson roll.

"""
marker='## Not implemented yet'
t=t.replace(marker, insert+marker)
p.write_text(t, encoding='utf-8')
print('ok')
