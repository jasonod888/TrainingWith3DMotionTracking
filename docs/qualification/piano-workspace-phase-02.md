# Piano correction workspace — Phase 2 submission

Unified document, occurrence selection, safe commands and one history.

| | |
| --- | --- |
| Prepared | 13 November 2026 |
| Phase | **2 — Unified document, selection, commands and history** |
| Branch | `phase2/correction-foundation` |
| Revision | **Correction submission after CHANGES REQUIRED** (review note and reproducer committed alongside) |
| Product routes changed | **None.** Review page, note forms, reviewed-lesson editor and API are untouched |
| Harness | `/workspace-harness.html?id=<lesson id>` — isolated Vite entry, never linked from the app |
| Phase 3 | **Not started** |

This revision fixes the six defects the Phase 2 review reproduced. The foundation shape is unchanged: one document, one occurrence selection, one patched history, an isolated harness, and the legacy reviewed editor left untouched.

---

## 0. Corrections in this revision

| Review item | Fix | Evidence |
| --- | --- | --- |
| **R1** Single-note written-duration split always returned `unchanged` | No-op detection moved **before** the split and compared with the original event duration; the split event is created with the requested duration and committed atomically | Test: a chord member moves to a free voice at 960→1,440 ticks while G4 keeps its value; a same-duration request with both voices occupied returns `unchanged`, not a voice rejection |
| **R2** Accidentals could edit the wrong occurrence | `apply-accidental` and `respell` now take an **occurrence id**; the logical-wide target was removed. Splitting is occurrence-exact and selection stays on the intended occurrence | Test: sharpening `e-repeat` (second linked occurrence) changes only `e-repeat`; the first occurrence keeps pitch and spelling |
| **R3** No-ops could apply or throw | Complete semantic equality (pitch **and** spelling) is checked before cloning; a multi-mapped note set to its own pitch is `unchanged`, never split; a spelling-only change on a multi-mapped note splits to a free voice or rejects atomically | Tests: explicit `E4` on E4 → `unchanged`; multi-mapped same pitch → `unchanged`; `Fb4` respell on a shared note → applied via split or rejected, never thrown |
| **R4** Invalid inputs escaped the result contract | `startTicks`/`durationTicks`/`snapSeconds`/staff/voice are validated with typed rejections; non-finite or non-positive snap is rejected; measure-limit growth is checked before commit; every applied document passes a structural `documentProblem` check and a thrown refresh becomes `document-invalid` | Tests: off-grid insert, five bad snap values, insertion at the 512-measure limit, and “every applied command leaves a valid document” |
| **R5** History retained full document snapshots | History stores **per-command patches** (only changed occurrences and events in both directions) under a 4 MB serialised budget; derived segments/ties are rebuilt on undo. Measured on the real score: 50 edits retain **48.7 KB**, i.e. **3.1 %** of the 1.58 MB document | §5.2 benchmark on the real 1,338-note draft |
| **R6** Selection and dirty state drifted | Commands no longer return `selection: null` on unrelated edits (they return `undefined` = keep); the reducer revalidates. Undo to the loaded document restores that exact object and clears `dirty`; partial undo keeps it | Tests: deleting an unrelated note preserves selection; deleting the selected note clears it; undo restores `document === origin` and “No changes”; redo marks dirty again |

The reviewer's reproducer is committed at [`piano-workspace-phase-02-review-repro.ts`](piano-workspace-phase-02-review-repro.ts) and now reports **8/8 PASS** (`logs/reviewer-repro.txt`).

---

## 1. What the phase delivers

| Deliverable | Where |
| --- | --- |
| One working document (performance + notation + stable links) | `NotationDocument`, owned by the workspace state |
| One shared occurrence selection | `CorrectionSelection` + `selectionForOccurrence`; reducer revalidates on every change |
| One history | Patch entries, bounded by count and bytes; exact restore of the loaded document |
| Surfaces usable with external selection/playback | Optional occurrence props on `PianoRoll`, `SheetMusic`, `KeyboardEditor`; the harness owns the only video |
| Occurrence pitch/onset/recorded-length/velocity/insert/delete | `applyCommand` (11 command types) |
| Written rhythm and spelling with explicit scope | `set-written-duration` (`scope: note | event`), `apply-accidental`, `respell` |
| Free time vs beat-snapped time | Exact seconds by default; snapping only when a valid interval is supplied |
| Split or reject multi-mapping/chord changes | Split-on-divergence, split-to-voice, or typed rejection |
| Isolated harness | `workspace-harness.html` + `PianoWorkspaceHarness.tsx` |

---

## 2. The command layer

[`packages/music-notation/correction.ts`](../../packages/music-notation/correction.ts) is additive; the legacy helpers in `edit.ts` are untouched and used only by the old editor.

Every command returns `applied` (with an optional selection override), `unchanged`, or `rejected`. Applied results are refreshed **and validated**: `documentProblem` checks ids, ownership, grid, voice overlap, chord pitch uniqueness, occurrence completeness and `performance_map` agreement; a refresh error becomes `document-invalid` instead of an exception.

| Command | Scope | Validates |
| --- | --- | --- |
| `set-occurrence-pitch` | occurrence | MIDI range, spelling↔pitch, chord pitch uniqueness, exact no-op equality |
| `set-occurrence-onset` | occurrence | finite ≥ 0, clip bounds, snap interval finite and > 0 |
| `set-occurrence-duration` | occurrence | > 0, clip bounds |
| `set-occurrence-velocity` | occurrence | 0–1 or null |
| `set-written-duration` | event / note | sixteenth grid, no same-voice overlap, no-op before split, free voice or `needs-third-voice` |
| `move-written-start` | event | grid, no overlap |
| `apply-accidental` | **occurrence** | letter/octave resolved, range, split-or-reject |
| `respell` | **occurrence** | enharmonic equivalent only, split-or-reject |
| `insert-note` | document | pitch/seconds/ticks/staff/voice, duplicate occurrence, collision, measure limit, chord join only when asked |
| `delete-occurrence` | occurrence | exists |
| `delete-logical-note` | logical note | exists |

Rejection codes: `invalid-pitch`, `invalid-velocity`, `invalid-onset`, `invalid-duration`, `invalid-ticks`, `invalid-scope`, `out-of-bounds`, `written-overlap`, `needs-third-voice`, `duplicate-chord-pitch`, `duplicate-occurrence`, `ambiguous-insert`, `unsupported-spelling`, `too-many-occurrences`, `document-invalid`.

### 2.1 Semantics

- **Occurrence-exact.** Pitch, onset, recorded length, velocity, accidentals and respelling all take an occurrence id. Nothing infers a target from array order.
- **Split, never replicate.** When a logical note owns several occurrences and an edit would make them diverge, the target occurrence is detached (same event when its pitch is free there, otherwise an available voice). If neither is representable the command rejects and leaves the document untouched.
- **No-op before side effects.** Equal pitch *and* spelling is `unchanged`; equal written value is `unchanged` even when a split would have no free voice.
- **No collateral deletion.** Written overlap rejects; no neighbour trimming exists in this layer.
- **Tie/merge remains unavailable** (`MergeOccurrences` deferred); untie is not offered.
- **Unknown values preserved.** `duration: null` can be moved and given a length, never treated as zero.
- **Snapping is opt-in and validated.**

---

## 3. One document, one selection, one history

[`workspace-state.ts`](../../apps/web/src/music/workspace/workspace-state.ts) is a pure reducer; [`document-patch.ts`](../../apps/web/src/music/workspace/document-patch.ts) computes and applies patches.

- **Select** resolves the occurrence, records nothing in history, never marks dirty.
- **Command** applies once, stores a patch, clears redo, sets dirty, keeps the current selection when it is still valid, and honours an explicit selection override (insert selects the new note).
- **Undo** applies the inverse patch. When the last entry is undone the loaded document object is restored verbatim and `dirty` becomes false; after eviction that shortcut is disabled and the indicator stays honest.
- **Redo** reapplies the forward patch and marks dirty.
- **History bounds:** 500 entries and a 4 MB serialised-byte budget; oldest entries are dropped first and `evicted` records that origin is no longer reachable.

---

## 4. Harness

```
http://127.0.0.1:5173/workspace-harness.html?id=0df28929d427406cb86d9bb5e2dcd35b
```

- Loads the draft through the same API and writes nothing; the status line says so.
- One `<video>`, one playhead, one selection across keyboard, roll and score.
- Inspector: pitch ± semitone, ♯/♭/♮ (occurrence-scoped), respell field, **written-value scope** (“This note” default, “Whole event” with the member count), written-value buttons, exact start with optional Snap, recorded length, velocity, audition, delete occurrence / logical note, insert at playhead / add to chord.
- Live `changed · added · removed · total` diff against the loaded document, and a history panel showing steps and retained patch size in KB.

Captured on the real draft: selecting `bp-1` (A4), changing the written value with “This note” keeps the recorded 0.882 s and reports `0 changed` (a written-only edit touches no occurrence); ♯ makes it A♯4 (MIDI 70); respelling to B♭4 keeps MIDI 70; full undo reports **“No changes · 0 changed · 1338 total”** with the selection still on `bp-1`.

![Harness after occurrence edits and respelling](piano-workspace-phase-02/captures/harness-desktop.png)

![Score strip with the same selection](piano-workspace-phase-02/captures/harness-score.png)

---

## 5. Test and measurement evidence

### 5.1 Suites

| Check | Command | Result |
| --- | --- | --- |
| Web (full) | `cd apps/web; npm test` | **378 passed, 0 failed** (6.1 s) — 339 pre-existing + 39 new |
| Type check | `cd apps/web; npx tsc --noEmit` | clean |
| Production build | `cd apps/web; npm run build` | succeeds incl. harness entry (previous revision) |
| Reviewer reproducer | `node --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-02-review-repro.ts` | **8/8 PASS** |
| API | unchanged; no backend file touched | not re-run |

New coverage: [`tests/music-engine/correction-commands.test.ts`](../../tests/music-engine/correction-commands.test.ts) (26 tests, including the six R1–R4 defects and a validity assertion on every applied command) and [`apps/web/tests/workspace-state.test.tsx`](../../apps/web/tests/workspace-state.test.tsx) (13 tests, including patch-only history, selection preservation and dirty-on-undo).

### 5.2 History benchmark — real 1,338-note draft

`docs/qualification/piano-workspace-phase-02/scripts/history-benchmark.ts` (result in `history-benchmark.json`):

| Measurement | Value |
| --- | --- |
| Document | 1,577,192 bytes serialised, 1,338 occurrences |
| 50 pitch edits | 1,811 ms (36.2 ms each) |
| Patch bytes retained for 50 edits | **48,691 bytes** (974 B each) = **3.1 %** of one document |
| 50 undos | 1,529 ms (30.6 ms each); document identity restored; `dirty=false` |
| 50 redos | 1,531 ms (30.6 ms each) |

The rejected design (up to 100 full snapshots) would have been roughly 158 MB of serialised-equivalent document data for the same clip. Figures are serialised-size estimates, not measured heap; the retained budget is 4 MB and the entry cap 500.

### 5.3 Browser evidence

`harness-result.json`: `scope_note_pressed: "true"`, `recorded_unchanged: true`, `facts_after_sharp` = A♯4/MIDI 70, `facts_after_respell` = B♭4/MIDI 70, `status_after_full_undo` = “No changes … 0 changed … 1338 total”, history panel `0 step(s) undoable · 3 redoable · 0 KB`, review route still `50` forms, `console_errors: []`.

---

## 6. Deviations and limitations

| Item | Status |
| --- | --- |
| No logical-wide accidental/respell action | Deliberate: the Phase 1 review rejected inferring a target from array order. If a future phase needs “apply to every occurrence”, it must be a separate, explicitly scoped command. |
| `NotationEditor` still owns its `<video>` and its legacy commands | Isolated by design (as accepted in the Phase 1 GO); migration belongs with the Phase 3 layout. |
| Roll and score still compress the whole clip | Phase 3; the dense measure labels in the captures are inherited, not introduced. |
| No gestures, persistence, recovery or alignment | Phases 4–6; the harness states that nothing is saved. |
| Undo/redo cost ≈ 31 ms per step at this size | Accepted for Phase 2; Phase 3/6 can revisit if the workspace needs faster stepping. |
| Measure-limit and byte-budget behaviour | Covered by unit tests; eviction disables the “back to origin” shortcut rather than claiming a clean state it cannot prove. |

---

## 7. Review record

| Item | Value |
| --- | --- |
| Phase | 2 — Unified document, selection, commands and history |
| First submission | `35b27e2` — CHANGES REQUIRED ([review](piano-workspace-phase-02-review.md), [reproducer](piano-workspace-phase-02-review-repro.ts)) |
| This revision | Correction submission: R1–R6 fixed, harness scope/accidental/respell controls added, reviewer reproducer committed and passing |
| Evidence | `logs/web-tests.txt`, `logs/reviewer-repro.txt`, `harness-result.json`, `history-benchmark.json`, captures |
| Deviations / limitations | §6 |
| Review decision | **NOT REVIEWED** |
| Next phase authorised | **None** — Phase 3 requires an explicit GO |

### Reproducing

```powershell
cd apps/web
npm test            # 378 pass
npx tsc --noEmit    # clean

cd ..\..
& 'C:/Program Files/nodejs/node.exe' --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-02-review-repro.ts
npx --prefix apps/web tsx docs/qualification/piano-workspace-phase-02/scripts/history-benchmark.ts

# Harness (dev servers running):
#   http://127.0.0.1:5173/workspace-harness.html?id=0df28929d427406cb86d9bb5e2dcd35b
#   Select a note → “This note” written value → ♯ → respell B♭4 → undo to “No changes”.
```

---

## 8. Reviewer clarifications retained for later phases

- Alignment passage joins must be continuous in score ticks; a held tick also exists at the adjacent timed endpoints, so the hold-start inverse policy needs one owner.
- With a non-zero global offset, video time outside the mapped domain needs an explicit hold/clamp policy; never apply the offset twice.
- Fixture save/reload, API compatibility and live cursor tests belong to the persistence and playback gates.
- `docs/qualification/piano-workspace-phase-01/scripts/validate-notation.py` prints ACCEPTED/REFUSED without failing its process; it must assert before it is used as an automated check.

---

## 9. Scope statement

No layout work, linked scrolling, alignment authoring, draft persistence, gesture UX or change to the review page/note forms is included. Phase 3 has not started and awaits an explicit GO.
