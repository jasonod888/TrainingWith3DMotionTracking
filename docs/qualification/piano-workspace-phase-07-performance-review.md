# Phase 7 performance review — 1598dfe

Reviewed 15 November 2026 (Singapore), commit `1598dfe43af610ca55af387f244f3756eb520159`.

**Phase 7 is not accepted; Phase 8 remains stopped.** The submitted timings show substantial median improvement, but the acknowledged tail and supported-maximum requirements remain unmet. One concrete correctness regression was independently reproduced in the new dirty signature.

## P1 — revision counter is not saved-content identity

`PianoWorkspaceHarness.tsx` now forms `workspaceSignature` from `state.revision` plus metadata. The reducer increments revision on commands and undo/redo. Therefore returning to the exact loaded/saved document does not return to its saved signature.

Independent normal-route reproducer:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-07-review/check-performance-dirty-regression.py
```

Result on this commit: exit 1. Original pitch 69; edit then Undo restores 69; clicking Form home still asks `Leave without saving your changes or take?`. The document is back at its original state but the workspace remains dirty. This regresses the existing clean-after-full-undo contract; it is not a new feature requirement.

Restore content/savepoint-aware dirty identity without bringing back unnecessary full-document serialization per edit. Keep asynchronous save-generation/race protection distinct from saved-content equality: a monotonic transaction counter is useful for races but is not a content fingerprint. Do not simply use history depth, since branching after undo can produce different content at the same depth.

Add durable assertions for:

- Load → edit → full undo: document and metadata equal baseline, clean, navigation has no unsaved prompt.
- Save A → edit B → undo to A: clean; redo B: dirty.
- Undo then a different edit at the same history depth stays dirty.
- Existing delayed-save A/intervening-edit B and A7 protections continue to pass.

The reviewer script and `performance-dirty-regression-results.json` record the independently reproduced failure. Product code was not changed by this review.

## Performance qualification remains open

The developer reports 20-sample real-recording preview median/p95 6.95/174.7 ms and commit median/p95 57.3/159.3 ms; 20k commit median/p95 408.7/3889.9 ms. These are submitted measurements, not an independently repeated benchmark in this review. Median gains do not qualify the tail or supported maximum, and no supported-limit cap is implemented.

The benchmark currently labels the maximum of 20 samples as p95 (`values[-1]`), checks only aggregate pitch change and an enabled Undo button, and does not actually perform Undo within `measure`. Correct the percentile label/calculation and verify successful changes and undo restoration explicitly so no-op/rejected gestures cannot be reported as fast successful edits. State pointer-to-frame versus pointer-to-painted-frame measurement precisely. These are evidence corrections to the existing performance gate, not additional product scope.

The implementation report also overstates the fast paths: in this commit, recorded duration and velocity still call `finalise` and refresh notation. Only the non-detaching pitch path and onset path gained refresh bypasses. Correct the handoff or implement and validate any further optimisation separately.

## Remaining work, kept bounded

1. Fix P1 and retain the established save/recovery/async contracts.
2. Meet the existing performance requirements or submit a concrete reviewed, enforced supported-limit proposal; include honest percentile and successful-edit/undo evidence.
3. Complete physical-touch qualification on actual hardware. Emulation does not close this gate.

Previously closed A7, script portability, transaction schema and pending-decision cases remain closed unless the optimisation regresses them. No library migration, new feature work or Phase 8 work is requested.

## Independent checks

TypeScript passed; the transaction-contract audit passed 5/5 and the baseline-shape audit passed 2/2. The new clean-after-undo normal-route diagnostic failed as described above. The full 490-test suite and submitted performance results remain developer-reported for this review.
