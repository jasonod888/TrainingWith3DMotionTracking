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

---

## 8. Review corrections (this commit)

| Review item | Resolution |
| --- | --- |
| R1 client/server contract | `buildSaveBody` names the draft for a first review and the base for a revision, plus the verification token; the complete passage map is serialized and parsed strictly. A cross-language test posts the generated payload to the real endpoints, retries idempotently, saves a revision, and checks legacy retention and refusal. |
| R2 dirty/confirmation | Signature covers document, alignment, anchors, offset, spans and title; offset-only edits are saveable; an unchanged draft is finalisable; restored checkpoints are dirty and saveable. |
| R3 integrity | Server rejects reversing anchor ticks, anchors disagreeing with the map, written-pitch disagreement and unowned occurrences; restore rejects reference/notation disagreements. |
| R4 legacy retention | Omitted notation/alignment is retained when valid and refused clearly when incompatible. |
| R5 reopen/load | Initial load opens a saved lesson from its stored reference (manifest → asset → restore) and keeps sections/assessment/preview metadata; the preview baseline is the performance the audio was rendered from; stored passages are used as the map; anchor history resets. |
| R6 conflict/retry | Conflict causes are classified (verification vs stale base vs other); verification conflicts never offer a blind rebase; recovery stores the base revision and verification token; acknowledgements are snapshot-bound. |

**Tests:** 451 web tests, 14 API tests (client contract, alignment, review, edit), `tsc` clean, reviewer probe **7/7** after supplying the draft identity it now requires.

**Remaining gaps (not claimed):**

### Browser evidence for the two former gaps

`scripts/browser-persistence.py` drives the isolated harness in Chromium with controlled
route responses (no services) and a real local WAV preview. It runs all scenarios in one
context, fulfils every held request, and closes normally.

| Scenario | Result |
| --- | --- |
| Delayed success: A in flight, offset edit B, A resolves 200 | “Saved an earlier version”; B dirty; checkpoint holds B (`offsetSeconds = 0.5`) with the draft identity; B re-confirmed and saveable |
| Delayed failure: A resolves 500 after B | Failure message; checkpoint holds B (`-0.5`); B stays saveable; after reload the banner says the checkpoint is **not saved to the server**, restoring it keeps B and remains saveable |
| Preview, spelling edit | Verified Piano stays enabled and active |
| Preview, pitch edit | Piano disabled, `data-preview-state="stale"`, Original restored |
| Reopen an invalidated preview | Piano stays disabled, audio element removed, Original active |

The harness also had a real defect behind the earlier failure: the save callback compared the
submitted snapshot against a **stale closure** signature, so a delayed save could claim
“Saved” for newer work and clear its checkpoint. It now compares against the live signature.
A saved lesson with no proposal left (draft 404) opens from its reference instead of showing
an error.

Evidence: [`phase5-browser.json`](piano-workspace-phase-05/phase5-browser.json),
`logs/browser-persistence.txt`.

Remaining known gap: no authenticated capture against the real backend; the cross-language
API test and this browser run cover the contract and workspace behaviour without a live
session.

---

## 9. Follow-up lifecycle corrections (this commit)

| Review item | Resolution |
| --- | --- |
| R1 load race | One coordinator owns loading: both requests start together, a saved reference wins, the draft is consulted only as a fallback, and a generation check makes a late response incapable of touching the workspace. A saved reference that cannot be read now falls back to the proposal with an explicit message instead of an error screen. |
| R2 saved-only identity | A saved-only lesson now restores its source video, preview identity, revision id, spans, sections and assessment. Recovery works without inventing a draft id: the checkpoint identity is account + lesson + source hash + **base revision**, and a saved-only edit writes and restores it. |
| R3 stored-map shadowing | The map in use is one editable state (`mapState`); an anchor applied after reopening is added to that map, so the cursor and the serialized passages change with it. Undo/redo restore map+anchor snapshots; Remove/Reset rebuild from the clip with the remaining anchors; anchor history resets when a different reference opens. |

Verified with the reviewer's own lifecycle diagnostic: **4/4 passed** (`docs/qualification/piano-workspace-phase-05-followup-repro.ts`), covering source video on saved-only load, an anchor applied after reopen moving the cursor, an identity-scoped checkpoint for a saved-only edit, and a late draft response leaving a newer offset edit intact.

The controlled-route Chromium script still passes all checks (delayed success/failure, reload recovery, preview validity, invalidated reopen).

**Known gaps after this commit**

- Removal/reset/undo/redo on a reopened stored map is implemented and exercised only through the map-state code path; the two component tests I wrote for it and for the saved-only revision save hung under jsdom and were removed, so they are not automated.
- The saved-only revision-save round trip (edit → save as revision) is covered by the cross-language API test and the browser script, not by a component test.

---

## 10. Second follow-up corrections (this commit)

### F1 — base revision is part of recovery identity

`RecoveryIdentity` now carries `baseRevisionId`, and `readRecovery` compares it with the
checkpoint. A checkpoint written against an older saved revision of the same clip is
**rejected** with a stale-base reason and is **retained** in storage; the harness shows a
separate “older revision” panel with *Restore older checkpoint* (keeps the current save base
and creates a new revision) or *Discard*. Earlier v1 checkpoints without base identity are
treated the same way and reported as predating base tracking — they are never silently
restored and never deleted by the reader.

### F2 — anchors are canonicalised at the editing boundary

Anchor changes are sorted by source time before they enter state, history, recovery or the
save payload (`canonicalAnchors`). Authoring 6 s then 2 s now serializes as 2 s, 6 s and is
accepted by the real validator. Duplicate seconds collapse; non-integer or negative ticks are
dropped at the boundary; the server remains strict (ordered, distinct, agreeing with the map).

### Evidence

| Check | Result |
| --- | --- |
| Reviewer lifecycle diagnostic | **4/4** |
| Reviewer recovery/map diagnostic | **2/2** |
| Web suite | **454 passed**, `tsc` clean |
| Browser script | all checks pass, now including saved-only revision save (base `rev-preview-1`, offset 0.05) and reopened-map anchor apply/undo/redo/remove (`base 240 → 340 → 240 → 340 → 240`) |

The browser script also still covers delayed success/failure, reload recovery, signed preview
validity and invalidated-preview reopen.
