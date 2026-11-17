# Phase 7 W1 review — current guard passes; legacy fallback still unsafe

Reviewed 14 November 2026. Commit `9bc2a2d2fc0bb0e437e0a8f83932695e3dfd6f46`, branch `phase7/normal-route`.

**Decision: CHANGES REQUIRED. Phase 7 remains unaccepted and Phase 8 stopped.** The new accepted-state snapshot fixes the tested current-checkpoint W1 path. Its absence on an older checkpoint still permits the destructive reversal the handoff says will be refused.

## Independent evidence

| Check | Result |
| --- | --- |
| Current written-reversal case | 1/1 pass: authored half note retained |
| Earlier recovery cases | 2/2 pass: recorded-length edit retained; B#3 restored |
| Loaded-clock checks | 4/4 pass: transport, both cursors, exact seek and natural end |
| TypeScript | Clean, exit 0 |
| Legacy checkpoint without acceptedBaselines | **FAIL**, normal exit 1: corrected half note deleted |
| Full web 471 / other verification, transition, settings and full normal-route runs | Developer-reported this review, not independently repeated |

## W2 — missing baseline still enables unsafe fallback (high)

Independent controlled-browser reproduction:

1. Accept the add-note suggestion creating `vf-add-1-a`.
2. Change its written duration to Half / **960 ticks** without changing recorded length.
3. Restore the older checkpoint shape written before W1: it contains authored notation and spelling recovery, but no optional `acceptedBaselines` field.
4. Reload, Restore local checkpoint, then Reject that finding.

Actual: the restored 960-tick note is deleted. Expected: keep it and explain that the authored accepted-state baseline is unavailable, so a safe destructive reversal cannot be proven.

This is the explicitly supported legacy-checkpoint path, not a new correction feature. The browser diagnostic removes only the new optional field to reproduce the previous checkpoint format; all identity, notation and settings checks remain intact.

Reproducer: `docs/qualification/piano-workspace-phase-07-review/check-legacy-reversal.py`.
Evidence: `legacy-reversal-results.json` alongside it. Run from repository root with `.venv-saas/Scripts/python.exe`, Vite at 127.0.0.1:5173. The diagnostic uses controlled API responses and no actual lesson/server mutations.

### Cause and required fix

In `findingMatches(..., invert=true)`, a present accepted baseline triggers the new authored-state comparison. If it is absent, the function falls back to proposal-derived performance-only checks. Those fields cannot detect the restored written-duration change. The later `needsSpelling` check does not include `add_note`, so it also permits deletion without a safe authored baseline.

- Fail closed for a destructive inverse whenever a complete, validated accepted authored-state baseline is unavailable. Preserve the live document and report the reconciliation requirement.
- Apply this consistently to add/merge/split/delete inverses; do not patch only the currently failing operation. Do not fabricate an accepted baseline from the current recovered document: it may already contain later manual corrections.
- Deeply validate persisted baseline entries. `readRecovery` currently checks only that the outer `acceptedBaselines` value is an object. Reject malformed/missing/incomplete affected entries or treat them as unavailable; empty or partial maps must not prove that a reversal is safe.
- Keep the ability to restore older work; lack of reversibility is not a reason to discard a valid checkpoint. Make the limitation explicit when the user requests reversal.
- Retain the current 1+2 passing assertions and add this old-format case plus partial/invalid-baseline coverage. Verify no document/selection/history change on a refused inverse.

## Remaining qualification

The earlier library journey and controlled loaded-media checks remain useful accepted evidence at their stated scope. Physical-touch qualification remains BLOCKED until an actual device run. Interactive/upper-bound profiling or a concrete reviewed supported limit also remains outstanding under the Phase 7 plan. None of those requirements is waived by this review.

After W2, submit the guard tests and the outstanding qualification evidence. If hardware is the only remaining blocker then, report it as such; this tree still has the software fallback defect above. No product code, Git branch, commit or release was changed during review.
