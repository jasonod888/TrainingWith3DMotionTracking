# Piano correction workspace — Phase 2 correction review

Reviewed: 13 November 2026.
Submission: `a42294cf60897f3d92e97a5e8cf9e1bd456894ee`.
Decision: **CHANGES REQUIRED — three targeted foundation corrections remain before Phase 3.**

## Verified improvements

- Independently reran the original reviewer reproducer: **8/8 PASS**.
- Independently reran the correction-command/reducer suites: **39 passed, 0 failed**.
- Independently ran TypeScript checking: **passed**.
- Inspected the actual command validation, occurrence-scoped accidentals/respelling, written-note split, patch generation/replay and history-budget implementation.
- The ordinary-page isolation and deliberate absence of later-phase layout/playback/persistence/gestures remain acceptable.
- Patch storage resolves the original full-snapshot concern substantially. The independent real-size synthetic test retained **19,484 serialised characters** for 20 edits, versus a **1,416,868-character** document; edit loop **712 ms** on this run. These are serialised-size/latency observations, not heap measurements.

The original bugs are materially improved. The checks below expose remaining cases in the same agreed scope; no new phase is requested.

## F1 — Note-only written scope can still change the whole chord

Location: `packages/music-notation/correction.ts`, `WrittenTarget` / `CorrectionCommand` types and `setWrittenDuration`.

The command type permits `{target: {eventId}, scope: 'note'}`. Runtime validation accepts it; `focus` is null, so `mustSplit` is false and the entire event is changed.

Reproduction: E4/G4 chord, existing written duration 360 ticks. Submit note scope, event target and 840 ticks. Actual: **applied**, both chord members receive 840 ticks. No individual note was identified.

Required: make valid scope/target combinations explicit in the command type and validate them at runtime. A note-scoped command must identify a logical note (or occurrence resolved to it); reject an event-only target with `invalid-scope` or another precise rejection. Preserve explicit event-wide commands. Add tests that assert the original document and every neighbour remain intact on the ambiguous combination.

## F2 — A same-pitch command can overwrite authored spelling

Location: `correction.ts`, `setPitch`.

The no-op calculation derives default spelling from the key even when the sounding pitch does not change. That makes a same-key piano interaction modify corrected notation.

Reproduction: respell MIDI 61 as `Db4`, then submit `set-occurrence-pitch` with pitch 61 and **no spelling**. Actual: **applied**, spelling becomes `C#4`. Expected: **unchanged**, preserving `Db4`, no new dirty/history entry. This follows the agreed rule that choosing the original piano key is a no-op and authored spelling is preserved through unrelated actions.

Required: when pitch is unchanged and spelling is omitted, retain the existing spelling and return unchanged. Explicit spelling changes must still use validated semantics; changed pitches can derive their new default spelling from the key. Test both single and multi-occurrence mappings, plus reducer history/dirty behaviour.

## F3 — Patch history dropped selection restoration

Location: `apps/web/src/music/workspace/workspace-state.ts`, `HistoryEntry` and undo/redo branches.

The new history stores musical patches but not pre/post selection. Undo revalidates the **current** selection. If deletion cleared it, the previous selected occurrence is not restored.

Reproduction: select E4, delete E4, undo. The document is restored and clean, but selection remains **null** instead of E4. Likewise an insertion can replace selection and undo cannot restore the pre-insertion selection. The original phase gate explicitly called for undo/redo restoring document **and selection**, and the old selected-deletion/undo test was removed instead of preserved through the patch conversion.

Required: retain compact before/after selection metadata alongside each patch, restoring and revalidating the correct selection on undo/redo. This does not require storing full score snapshots. Cover deletion, insertion, a split that changes logical IDs, and an explicit selection change between the edit and undo. Undo/redo should follow the agreed transaction-selection policy consistently.

## Additional non-blocking corrections

- `historyBytes` / `historySummary` count only `past`. After undoing a deletion, the harness reports 0 bytes while the redo queue still retains the 788-character patch. Distinguish undo-stack size from total retained undo+redo memory in labels and benchmarks. Count UTF-8 bytes if calling the budget bytes; `JSON.stringify(...).length` counts UTF-16 code units. Keep the combined retained history bounded, including the single-entry-larger-than-budget case.
- The original reviewer reproducer's accidental check still sends the removed `logicalNoteId` API. It passes because that command is rejected, without proving that the selected second occurrence changes. Update it to the new `occurrenceId` API and assert both second-occurrence change and first-occurrence preservation. The new normal command test does correctly cover the working case, so this is an evidence-maintenance correction rather than an unverified functionality claim.
- Performance-only onset/recorded-length edits retaining a many-to-one mapping are acceptable for this phase, provided no claim is made that the rendered score position has been realigned. The later alignment/layout integration must handle actual note activation versus written position explicitly.

## Follow-up instructions

Use the same Phase 2 branch; fix F1–F3 and add focused tests. Update the handoff and provide a new commit identity. Do not start Phase 3 yet. No need to rerun API suites or live service captures solely for these pure command/reducer fixes; rerun relevant web tests and TypeScript, and preserve the already supplied integration evidence unless the harness changes.

Reviewer reproducer, from repository root:

```powershell
& 'C:/Program Files/nodejs/node.exe' --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-02-followup-repro.ts
```

All three checks fail on `a42294c`. Only reviewer documentation and a diagnostic script were added; product implementation was not modified during review.
