# Piano correction workspace — Phase 5 submission

Validated persistence, reopen fidelity, conflict-safe saving and identity-scoped recovery.

| | |
| --- | --- |
| Phase | 5 — Persistence, verification and recovery |
| Branch | `phase5/persistence-recovery` |
| Commits | `6d68abd` server contract · `9bd4540` workspace save/recovery · this commit |
| Scope | Draft review/revision persistence only; no publication, no page replacement, no gestures |
| Phase 6 | Not started |

## 0. Occurrence-mapping rejection (reproduced and fixed)

The fixture's first edit failed with “An occurrence is missing from every logical note”. Reproduction
showed why: when two recorded attacks quantise to the same written pitch and position,
`groupPerformance` kept only the louder one, so the quieter performance id belonged to no logical
note. The validation was correctly rejecting a document that had genuinely lost an occurrence.

`build.ts` now merges those attacks into **one written note whose `performance_ids` lists every
occurrence** (the loudest supplies velocity/spelling). No validation was relaxed: all ids are still
present, unique, and bound to the same event. The fixture maps **20/20** occurrences, and an edit
targeting a doubled attack applies.

## 1. What is persisted

`POST /music-draft/review` (first save) and `POST /music-revision` (later saves) accept optional
`notation`, `alignment` and `offset_seconds`. Both reuse `validate_notation` and the new
`validate_alignment`, and store the normalised payload in the private reference:

- notation: events, authored spelling, written durations, voices/ties, performance binding;
- alignment: version, mode, basis, anchor list, score ticks, offset;
- everything else unchanged: events, spans, pedal, provenance, review identity, verification state.

Rejections (422): performance/notation mismatch, gap or overlap in passages, reversed ticks, held
jump, off-clip anchor, offset outside ±10 s, `estimated`/`anchored` inconsistency.
Legacy bodies without notation/alignment still save; identical retries return the same revision.

## 2. Workspace save, reopen and conflict handling

- **Save privately** posts through the existing commands, first as a review and then as revisions.
  It requires a fresh “Reviewed” confirmation; **any edit clears it**.
- **Failure** keeps the document, keeps the confirmation state, shows the server message, writes the
  local checkpoint, and never says Saved.
- **409** keeps the work and offers explicit resolution: *Save on latest revision* (rebases on the
  current revision id and saves the local work) or *Reload saved revision*. No silent discard.
- **Reopen saved** reads the lesson manifest reference and restores it with
  `restoreFromReference`, which uses the saved notation verbatim. A stored `B#3` spelling and a
  240-tick written duration survive; legacy references without notation are rebuilt and labelled
  “performance only (legacy reference)”.

## 3. Local recovery

`recovery.ts` writes one versioned checkpoint (`piano-workspace-recovery-v1`) with
`{accountId, lessonId, draftId, sourceSha256}`. Reading:
- matches all four identities → offered with “It is **not saved to the server**”; Restore applies
  notation, anchors and offset, and the status repeats that it is local;
- any mismatch → rejected with “belongs to a different account, draft or source” and never offered;
- unsupported version → rejected; corrupt JSON → rejected.
The UI never marks a checkpoint as server-saved.

## 4. Audio identity

`performanceChanged` compares ids, onsets, recorded durations, pitches, velocities and the
optional flag: spelling-only edits keep the preview valid; pitch/time edits mark it stale, disable
Piano and label the preview stale. Server-side invalidation already keys on the same performance
comparison.

## 5. Tests and evidence

| Check | Result |
| --- | --- |
| Web suite `npm test` | **447 passed**, 0 failed |
| Save/reopen/conflict/recovery component tests | **6 passed** |
| Persistence unit tests (reopen fidelity, legacy, recovery identity) | **8 passed** |
| API `test_music_alignment.py` + review/edit | **12 passed** |
| `tsc --noEmit` / `npm run build` | clean / succeeds |
| Round-trip sample | [`phase5-roundtrip.json`](piano-workspace-phase-05/phase5-roundtrip.json): saved `B#3` + 240 ticks + anchor (1 s → 960) + offset 0.25 → reopened identically, `source: notation` |

Component coverage (`apps/web/tests/workspace-save.test.tsx`): edit → confirm → save body carries
notation/alignment/offset; confirmation reset by a further edit; failed save keeps edits, writes
the checkpoint and never claims Saved; 409 shows both resolution actions and the retry posts a new
revision on the latest base (one review + one revision, no duplicate finalisation); reopen restores
the authored `B#3`, the 0.25 s offset and the anchored map; matching checkpoint offered and restored
as local work; foreign checkpoint rejected.

## 6. Limitations

- The conflict test drives a mocked 409; the server-side 409 semantics are covered by the existing
  review/edit API tests, not by an authenticated browser capture.
- The save flow is exercised in jsdom with the real parsers, hooks and command layer; there is no
  screenshot-based capture of a live save/reopen.
- Phase 5 stores the alignment as an authored map plus anchors; it does not yet offer anchor
  authoring on the normal review page (Phase 7).

## 7. Scope statement

No publication, shared-release update, page replacement or gesture work. The draft review and
revision endpoints are used exactly as they exist. Phase 6 has not started.
