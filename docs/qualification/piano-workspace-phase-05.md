# Piano correction workspace — Phase 5 progress

**Status: NOT SUBMITTED FOR ACCEPTANCE.** Two verified checkpoints exist; the workspace
save/recovery flow is implemented but its component-level evidence is missing. Phase 6 has
not started.

Commits: `6d68abd` (server persistence), `9bd4540` (workspace save/reopen/recovery).

## Verified

| Requirement | State | Evidence |
| --- | --- | --- |
| Validated, versioned persistence of performance, authored notation and alignment | Done | `apps/api/music_alignment.py`; `POST /music-draft/review` and `POST /music-revision` accept `notation`, `alignment`, `offset_seconds` and store the normalised payload in the private reference |
| Exact onset/length, authored rhythm/spelling survive save/reopen | Done (payload) | Reopen tests: a respelled `B#3` and a 240-tick written duration round-trip through JSON and `parseNotationDocument`; a mismatched notation duration is refused |
| Saved anchors and offset have ownership and dirty/save state | Done (code) | `serializeAlignment` stores anchors + offset; harness Save/Reopen and dirty tracking are wired |
| Submitted performance and notation disagreements reject clearly | Done | 422 for pitch mismatch, gap, reversed ticks, off-clip anchor, out-of-range offset |
| Legacy references without notation/alignment open correctly | Done | API test (legacy body stores neither) and web restore test (performance fallback labelled) |
| Ownership, source identity, idempotent finalisation | Done | Existing review/edit tests still pass; identical retry returns the same revision |
| Versioned local recovery with account/draft/source identity | Done (code + unit) | `recovery.ts`; rejects account, lesson, draft and source mismatches; never marked server-saved |
| Save failure retains edits and keeps a checkpoint | **Implemented, not automated** | Harness keeps the document and writes the checkpoint; no component test |
| Stale-preview labelling | Done (code) | `performanceChanged` ignores spelling and detects pitch/time edits; harness disables Piano and labels the preview stale |
| API/integration evidence pack | Partial | API tests + 7 web persistence tests; no authenticated browser save/reopen capture |

## Tests

- Web: **440 passed** (`npm test`), including 7 new persistence tests.
- API: `test_music_alignment.py` + `test_music_review.py` + `test_music_edit.py` — **12 passed** (4 new).
- `tsc --noEmit` clean.

## Missing before Phase 5 can be submitted

1. A component test that renders the harness, performs a Phase 2 edit, confirms, saves, and
   asserts saved status; then a failing save that keeps the edit and the local checkpoint with
   an honest “not saved” label. The attempted test was removed because the fixture’s first
   occurrence was rejected by the correction layer (“occurrence missing from every logical
   note”), so it never reached the save path — this is a test-harness integration problem that
   must be understood, not papered over.
2. An authenticated save → reopen demonstration (payload, reload, restored spelling/anchors/offset).
3. A conflict/retry demonstration (409 then retry).

## Scope statement

No publication, no page replacement, no gesture work. The draft review path is used exactly as
it already exists; the workspace stays isolated.
