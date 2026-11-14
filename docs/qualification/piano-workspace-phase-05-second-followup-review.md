# Phase 5 second follow-up review

Reviewed: 14 November 2026.
Submission: `df09a8f`.
Decision: **CHANGES REQUIRED — Phase 6 remains stopped.**

## Independently verified

- The previous actual-harness lifecycle reproducer now passes **4/4**: saved-reference video, cursor movement after an anchor, saved-only checkpoint creation and protection from a late draft response.
- TypeScript passes.
- The deterministic load coordinator and map/history snapshots address the previously reproduced failures. Browser tests are an acceptable alternative to unreliable jsdom component tests; duplicate component coverage is not required merely to satisfy a preferred test format.
- Full web/API suites were not rerun in this turn. Prior automatic approval review blocked suite execution after an external Visual Studio telemetry request with an unverified payload; no bypass was attempted. The latest suite totals remain developer-reported.

Two smaller contract failures remain, both independently reproduced by the new diagnostic.

## F1 — Base revision is recorded but not checked during recovery

The harness now includes `baseRevisionId` in `recoveryIdentity`, but `readRecovery` still compares only `accountId`, `lessonId`, `draftId` and `sourceSha256`. Its declared `RecoveryIdentity` also lacks a base-revision field. For a saved-only lesson, draftId is empty and source-video hash is stable across revisions, so these comparisons cannot distinguish a checkpoint from an earlier revision.

Pure reproduction: store local edits with base `old-base`, then read using the same owner/lesson/source and base `new-base`. The reader returns **`restored`**, not a rejection or explicit stale-base result. Restoring it can move the save base back to the earlier revision without first explaining that the server has advanced. This does not establish the base-revision identity protection claimed in the handoff.

Required: make the base identity part of the versioned recovery contract and validate it. Either reject ordinary restoration on a mismatch while retaining the checkpoint, or present a separately typed stale-base conflict requiring explicit resolution. Do not discard local work silently. Cover saved-only edit → checkpoint → server revision advances → reload, as well as a matching-base restore followed by a revision save. Specify migration behaviour for earlier v1 checkpoints lacking base identity.

## F2 — Valid anchors authored out of chronological order cannot be saved

`applyAnchorPoint` correctly adds a point to the map in use but appends the point to the anchor list in click order. `serializeAlignment` preserves that order. The server requires anchor times/ticks to be strictly increasing in list order.

Pure reproduction using the submitted exports: author **6 s → tick 6000**, then **2 s → tick 2000**, on a 12-second, 120 BPM map. Both `addAnchor` calls succeed and produce a monotonic map. The serialized list is `[6 s, 2 s]`; the actual server validator rejects it with **"Alignment anchors must be ordered and distinct."** This is a valid earlier correction, not a reversing map.

Required: canonicalise anchors by source time at the editing/persistence boundary, consistently through history, removal, recovery and restore. Retain duplicate/nonmonotonic-point rejection and map/anchor validation; do not weaken the server. Test out-of-order authoring → save → reopen through the actual payload contract, plus undo/redo and removal on the reopened map.

## Evidence correction

The current `browser-persistence.py` still posts saves only in its draft delayed-save scenarios. After switching to a saved-only manifest it checks preview validity and reopening, but never posts a saved-only revision save, and has no anchor Undo/Redo/Remove/Reset assertions. The cross-language API test proves the payload helper and endpoint, not that the saved-only harness chooses and completes that path.

Therefore the claim that those particular workspace journeys are covered by the browser script is unsupported. Add them to the browser script (bounded requests, normal cleanup) or equivalent reliable workspace tests while closing F1/F2. No authenticated capture is required solely to duplicate controlled-route evidence.

## Diagnostic

```powershell
node --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-05-second-followup-repro.ts
```

Result: **0/2 passed**, exit 1. Uses in-memory storage, actual map/serializer functions and the actual Python alignment validator. No services, authenticated requests or product writes.

Continue the already authorised Phase 5 corrections and resubmit; do not start Phase 6. The four previously failing lifecycle cases remain closed on this revision.
