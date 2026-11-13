# Piano correction workspace — Phase 2 review

Reviewed: 13 November 2026.
Submission: `35b27e26b6b5fd40bfc3a8368eb73f5cbdb5cb35`.
Decision: **CHANGES REQUIRED — do not start Phase 3 yet.**

The isolated foundation is the right approach. Legacy-editor isolation, deferred gestures, compressed roll and absence of persistence/alignment are acceptable at this phase. The following issues are command/state correctness defects, not requests to implement later phases early.

## Independent checks

- Read the handoff, command layer, reducer, harness, new tests and the shared-surface diff.
- Reran all 25 new correction/reducer tests: **25 passed, 0 failed**.
- Ran the app TypeScript check: **passed**.
- Added reviewer probes against the actual submitted exports. They reproduce the defects below. These demonstrate missing coverage despite the green new suite.
- Did not independently rerun the full 364-test suite, production build or live-browser harness in this review. Those results remain developer-reported evidence.
- Product code was not changed during review. Only this review and its regression reproducer were added.

## R1 — Single-note written-duration splitting always returns unchanged (high)

Location: `packages/music-notation/correction.ts:307–331`.

The split path creates a new event already holding `duration: ticks`. The later `if (edited.duration === ticks) return unchanged` is therefore always true for that path. The cloned split is discarded.

Reproduction: build an E4/G4 chord with a free second voice; change E4's written duration from 360 to 840 ticks using logical-note target and `scope: 'note'`. Actual result: `unchanged`. Expected: E4 moves to an available voice with the requested duration, G4 and all performance timing/lengths remain unchanged.

Move no-op detection before splitting, comparing against the original target. Commit a necessary split atomically. Also test requesting the original duration when both voices are occupied: a true no-op must not become a third-voice rejection.

The harness currently dispatches all duration buttons with `eventId` / `scope: 'event'`, so it neither demonstrates the advertised single-note path nor makes the whole-chord scope clear. Expose an explicit scope control or default the selected-note inspector to logical-note scope and label whole-event edits separately. A selected chord member must not silently edit every member's written value.

## R2 — Accidental commands can edit the wrong occurrence (high)

Location: `correction.ts:362–372`, command types at `:54–55`, harness accidental actions at `PianoWorkspaceHarness.tsx:272–274`.

`applyAccidental` receives only a logical note ID, then arbitrarily chooses `performance_ids[0]`. It cannot know which occurrence the user selected.

Reproduction: one logical E4 owns `e` at 1 s and `e-repeat` at 3 s; select `e-repeat`, press sharp. Actual: `e` becomes F4, `e-repeat` remains E4, and selection jumps to `e`. Expected: only `e-repeat` changes, with split-or-reject behaviour and selection remaining on the intended occurrence.

Carry the occurrence target into accidental/respelling commands when used from occurrence selection. Explicit logical-wide actions must be clearly scoped, not inferred from array order. Test the second occurrence, never only the first. Audit written-event outcomes that currently move focus to the first note, and preserve the originating occurrence when it remains valid.

`set-occurrence-onset` and recorded-duration edits also leave multi-occurrence mappings untouched. Clarify and test the agreed split-or-reject policy when an edit makes score positions/representation diverge; do not claim all occurrence edits split merely because one pitch test does.

## R3 — No-op handling is incomplete and can throw on valid input (high)

Location: `correction.ts:161–217`.

- Setting E4 to MIDI 64 with explicit spelling `E4` reports `applied`, clones the score, sets dirty and enters history despite no musical change. Reapplying an already-present accidental has the same issue.
- Setting a multi-mapped E4 occurrence to its current pitch attempts to split into a second E4 in the same event; `refreshNotation` throws **A chord repeats a pitch.**
- Requesting a different spelling but the same pitch on a multi-mapped note can encounter the same duplicate-chord problem. Split to a representable event/voice or reject atomically; never create an invalid intermediate result that escapes as an exception.

Perform complete semantic equality checks before cloning/splitting. Cover explicit spelling, same accidental, multi-mapping and unavailable-voice cases. Preserve original document, selection/history and dirty state on failure/no-op, aside from a truthful status report.

## R4 — Invalid command inputs escape the result contract or corrupt timing (high)

Location: `correction.ts:221–240`, insertion at `:397–454`, dispatcher at `:492`.

- `insert-note` with valid recorded timing but `startTicks: 130` throws **A notation start must be on the sixteenth-note grid.** instead of returning `rejected`.
- `set-occurrence-onset` with finite seconds and `snapSeconds: Infinity` reports `applied` with `performance.onset = NaN`. The comparison against clip bounds does not catch NaN.

Validate optional snap/grid values, finiteness, positive snap interval, integer tick bounds, scope/staff/voice at the appropriate runtime boundary, and supported measure/event/segment limits before committing. Derived-refresh limit errors must become typed rejection outcomes, not uncaught reducer exceptions. Do not solve this by silently clamping arbitrary invalid data.

Require successful outcomes to pass strict document validation, not only a complete `performance_map`. Add malformed-insertion, non-finite-snap, boundary and measure-limit tests. Failure must leave the original document unchanged, with no history or partial dirty transition.

## R5 — The history design repeats the memory problem identified in Phase 1 (medium, required foundation correction)

Location: `apps/web/src/music/workspace/workspace-state.ts:39,72,89,104`, and full-document `structuredClone`/`refreshNotation` in the command layer.

The Phase 1 audit specifically warned against retaining the old full-document snapshot design unchanged. Phase 2 now retains up to 100 full snapshots rather than 80, while each command clones the document and rebuilds all derived segments/rests/ties. A count bound is not a memory budget. The real example's approximately 1.5 MB serialised score implies approximately 150 MB of serialised-equivalent historical document data, not a measured heap figure.

Use inverse/core patches, shared immutable core with derived reconstruction, or bounded checkpoints with a defensible byte budget. Do not retain complete derived score geometry/segments in every history entry without measured justification. Demonstrate repeated edit/undo/redo on the real-size example and report retention/allocation and latency measurements. This is the Phase 2 shared-history concern already identified, not a demand to build Phase 3 virtualisation.

## R6 — Preserve valid selection and accurate dirty state (medium)

Location: `workspace-state.ts:73–74,85–116`, removal outcomes in `correction.ts:458–486`.

- Select `g`, delete unrelated `tail`: the command's unconditional `selection: null` clears `g` even though it remains valid. Preserve/revalidate current selection when the selected target survives; clear it only if removed or explicitly deselected.
- Edit a note, then undo back to the exact loaded document: `dirty` remains true. The harness reports no diff yet still says unsaved changes. Track a clean document/checkpoint identity and update dirty on undo/redo and history eviction. This does not require server persistence.
- For written edits that affect a chord/event, do not arbitrarily select the first performance ID if a different surviving member originated the action.

## Reproduction

From repository root in PowerShell:

```powershell
& 'C:/Program Files/nodejs/node.exe' --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-02-review-repro.ts
```

The reviewer script exercises the submitted exports directly, without live services, media or product writes. On `35b27e2`, its eight focused assertions fail, matching the receipts above. Keep equivalent meaningful regression tests in the normal test suites when fixing; update the accidental test invocation to the corrected occurrence-scoped API rather than leaving the old ambiguous target as the accepted interface.

## Required follow-up

Submit a Phase 2 correction commit, updated handoff and focused tests covering R1–R6. Retain the existing legacy-route isolation. No new page layout, alignment, persistence or gestures are requested here. Stop for review again before Phase 3.
