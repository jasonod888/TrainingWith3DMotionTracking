# Phase 7 W2 review — missing baseline fixed; incomplete baseline still accepted

Reviewed 14 November 2026. Commit `37b0a67972c0d4bb4a73b3cd647e8ff031740c43`, branch `phase7/normal-route`.

**Decision: CHANGES REQUIRED. Phase 8 remains stopped.** The missing-baseline path is fixed. The incomplete/malformed-baseline validation explicitly requested in W2 is not yet implemented.

## Independent results

| Check | Result |
| --- | --- |
| Legacy checkpoint with no acceptedBaselines | Pass: corrected half note retained |
| Current written-reversal case | Pass |
| Recovery cases | 2/2 pass |
| TypeScript | Clean, exit 0 |
| Incomplete baseline for accepted add-note finding | **Fail**, normal browser-run exit 1: restored half note deleted |
| Web 471 and other reported regression scripts | Developer-reported this review, not independently repeated |

## W2 validation remains incomplete (high)

The code change adds `if (!baseline) return false`. That handles an absent field, but not a present empty/partial value. For an add-note finding, a recovered map such as:

```json
{"acceptedBaselines":{"add-1":{}}}
```

passes the current reader and is truthy. The loop over its entries checks nothing and returns true, authorizing deletion of an added note whose written duration was manually changed to 960 ticks.

The controlled-browser reproduction is identical to the earlier legacy-checkpoint case except that it supplies an empty per-finding baseline rather than omitting the field. It retains the safety assertion: restored authored work must survive when reversal cannot be proven safe. This is a deliberately incomplete recovery fixture, not a claim that ordinary generated add-note checkpoints currently write this empty value.

Reproducer: `docs/qualification/piano-workspace-phase-07-review/check-empty-baseline.py`.
Evidence: `empty-baseline-results.json` alongside it. Run from repository root with `.venv-saas/Scripts/python.exe` and Vite at 127.0.0.1:5173. No live lesson or server decision is modified.

### Required completion

1. Derive the required affected live/deleted targets for the finding and validate baseline coverage. For add-note, the new vf-* occurrence must have a complete accepted-state entry. An arbitrary empty map cannot establish that it was unchanged.
2. Validate nested entries and field types/ranges when reading recovery and again at reversal. Reject or treat malformed/partial baseline data as unavailable; do not rely on TypeScript casts for persisted JSON.
3. Handle deleted-only operations deliberately: their accepted state may require proving an occurrence remains absent. Use an explicit absence condition/tombstone or equivalent, rather than treating every empty map as either universally safe or universally invalid.
4. Keep valid older work restorable and saveable, but refuse an unsafe reversal with a clear reconciliation notice. Do not create a trusted baseline from the current edited document.
5. Add missing, empty, partial, malformed and valid baseline cases across the inverse operations. Refusal must not mutate musical document, selection or history. Keep the passing missing-baseline and current-baseline assertions.

This completes the validation requirement already named in W2; no new product feature or architecture change is requested.

## Phase gate

After closing baseline validation, physical-touch qualification and interactive/upper-bound performance evidence (or a concrete reviewed supported limit) still remain. They are not waived. A Phase 7 GO, and therefore Phase 8, cannot be issued on this submission.

No product code, Git branch, commit or release was changed during review.
