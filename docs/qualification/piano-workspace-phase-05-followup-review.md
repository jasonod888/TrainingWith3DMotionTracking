# Phase 5 follow-up review

Reviewed: 14 November 2026.
Submission: `4e30e8b` (`phase5/persistence-recovery`).
Decision: **CHANGES REQUIRED — Phase 6 remains blocked.**

## Progress verified

- Original cross-language reviewer reproducer: **7/7 passed**, independently rerun.
- TypeScript: **passed**, independently rerun.
- Reviewed the controlled-route Chromium script and committed no-failure report for delayed success/failure, reload recovery, spelling/pitch preview validity and invalidated-preview reopen. The live-signature ref fixes the previously identified stale-closure comparison.
- Did not independently rerun the browser script. Its results remain developer-supplied evidence; this review does not reject controlled-route browser evidence or require an authenticated screenshot merely for its own sake.
- The attempted API suite (including client-contract tests) was blocked by automatic approval review following an external Visual Studio telemetry request with an unverified payload. No bypass was attempted. No new independently confirmed full-suite/API result is claimed here.
- No product code or service data changed. Added a service-free lifecycle diagnostic and this review only.

The earlier payload/integrity failures have improved materially. However, loading and then continuing to edit a saved reference remains unsafe. These are Phase 5 persistence/reopen defects, not new gesture or normal-route scope.

## R1 — Initial saved-reference loading races the draft and can overwrite edits (high)

`PianoWorkspaceHarness.tsx` launches the draft request and saved-reference request from independent effects. The successful non-null draft handler never checks `referenceLoadedRef`. It unconditionally replaces the document, spans, title, offset and preview metadata when it eventually returns.

Actual harness reproduction: hold the draft response; let the saved reference open with a 0.25 s offset; change the offset to 0.5 s; then return a valid old draft. The offset becomes **0**, discarding the edit and replacing restored authored work with regenerated draft content. The saved revision id and stored map can remain attached to that different document.

The current null-draft path's fixed 800 ms wait does not establish request ordering. A failed or slow reference load is also swallowed, potentially presenting a regenerated fallback without clearly reporting that an existing saved reference could not be restored.

Required: one deterministic load coordinator, with an explicit saved-reference-versus-current-proposal policy and cancellation/generation checks. Fallback to draft only when appropriate; a late response must never overwrite the chosen workspace or user edits. Test both response orders, slow reference loading, draft 404, saved-reference failure and current-proposal coexistence. Avoid wall-clock delays as correctness guards.

## R2 — Saved-only load omits source media and recovery identity (high)

`applyRestoredReference` restores score content and a subset of manifest metadata, but never sets `videoUrl`, `previewIdentity`, `draftId` or `sourceSha256`. Those are populated only by the draft success handler.

Actual harness reproduction with the draft held: the manifest includes a source video, and the saved reference opens successfully, but **no video element is rendered**. After editing and waiting beyond the checkpoint debounce, **no recovery checkpoint is written**, because recovery is gated on the missing identity fields. A saved lesson with draft 404 will stay in this state indefinitely. The new browser preview scenario uses `source_video: None`, and does not test recovery of an edit to a saved-only lesson, so it misses both failures.

Required: initialise the complete workspace from one coherent revision/source identity. Saved-only lessons must have their source video/clock and preview identity, plus a valid revision-based recovery identity even when no draft exists. Do not invent a draft id just to satisfy a guard. Derive stable source/account/lesson/base information explicitly, retain base revision in the checkpoint and validate it on recovery. Test saved reference + real source video + draft 404 → edit → reload → restore → revision save.

## R3 — Stored alignment shadows new anchor edits after reopen (high)

The effective map is selected with `storedAlignment ?? anchored?.alignment ?? baseAlignment`. `commitAnchors` updates `anchors` and its history, but leaves `storedAlignment` intact. Thus the first operand continues winning: a newly applied anchor can be shown as authored/dirty while the cursor and serialized passages still use the old stored map. Reset/removal have the same underlying inconsistency.

Actual harness reproduction: open a stored map, position the effective clock at 1 s, apply tick **580** at that position. The mapped cursor remains at tick **480**. The action does not change the map in use. Saving the new anchor list with old passages can then be refused by the strengthened server anchor/map consistency validation.

Required: use one authoritative editable map/anchor state across load, apply, remove/reset, undo/redo, recovery and save. Opening a stored map must preserve its authored interpretation while allowing subsequent changes to take effect; do not fix this by silently regenerating the stored score/map. Add a reopen → new anchor → cursor/inverse seek → real API save → reopen test, plus removal/reset and undo/redo on reopened maps.

## Independent reproducer

From the repository root:

```powershell
node --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-05-followup-repro.ts
```

Result on this submission: **0/4 passed**, exit 1. It renders the actual harness, holds/releases a controlled draft response, supplies a saved reference and source-video manifest, checks checkpoint storage and applies an anchor. It uses no services, authenticated requests or product writes; the checkpoint lives in jsdom's temporary storage. The held response is resolved and the view is cleaned up.

Continue the already authorised Phase 5 corrections and resubmit. Keep the successful delayed-save and preview tests as regressions. Phase 6 remains stopped; no additional permission is needed to finish this scope.
