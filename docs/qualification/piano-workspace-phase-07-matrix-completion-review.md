# Phase 7 matrix-completion review

Reviewed 15 November 2026 (Singapore). Commit `9b0465b2ae9a56e854c6b53cd7b0e6fa5fcf9de0`, branch `phase7/normal-route`.

**Decision: Phase 7 remains CHANGES REQUIRED. Phase 8 remains stopped.** The five previously reproduced S2/S5/R4 defects are corrected. Remaining work is within the existing consolidated checklist: full R4 schema coverage, bounded async evidence, performance qualification and physical touch.

## Independent results

| Check | Result |
| --- | --- |
| Existing transaction contract audit | 5/5 pass; restored performance has zero field differences |
| Delete/merge unchanged structural round trips | Both pass, 20 -> 19 -> 20 |
| TypeScript | Clean, exit 0 |
| R4 state-shape coverage | 0/2 pass: invalid before discriminant accepted; malformed extra entry accepted and inverse throws |
| Full 488-test suite / other reported browser scripts | Developer-reported this review, not independently repeated |

The metadata restoration and stale-velocity-deletion fixes are verified. Do not reopen those specific findings unless subsequent changes regress them.

## 1. Finish R4 as one schema, not more field exceptions

Reproducer: `docs/qualification/piano-workspace-phase-07-review/check-baseline-shape.py`.
Results: `baseline-shape-results.json` alongside it. It invokes the actual module through local Vite/Chrome without changing a live lesson/server decision.

Two malformed cases remain inside the existing R4 requirement:

- Set a required `before.a.present` to false while leaving its other present-state fields populated. `validateBaseline` accepts it because the before-entry validator does not require the `present:true` discriminant. Inverse code subsequently treats it as absent, contrary to the validator's promise of a restorable before-state.
- Add `entries.extra = null` to an otherwise valid baseline. The validator checks required entries but accepts the malformed extra. `matchesBaseline` later iterates every entry; `invertFinding` throws instead of returning a typed refusal.

Use a complete shared discriminated schema for both maps: either reject unknown keys or validate every entry that a consumer can visit. Enforce present/absent tags, operation-specific coverage, identity and value semantics consistently. Invalid input must produce a safe result, not an uncaught exception or an incorrectly accepted baseline. Parameterise malformed **before and after shapes**, extra keys and both union branches in the existing R4 suite. This was already requested by the consolidated matrix and preceding review; it is not new feature scope.

Keep the restorative insert boundary validated too: a `restore` payload must obey the same canonical optional/string/fret/nullability rules as the captured occurrence. A generic optional object should not bypass the invariants the baseline parser establishes.

## 2. Complete the acknowledged async evidence

A2/A3's new pure tests prove revalidation after a pre-existing edit. They do not exercise a pending network response or the UI's live refs, history, token and alignment behaviour. Add the bounded deferred-response browser cases already specified. Ensure all held routes settle in teardown; no forced exit.

For A4/A7, identify exact assertions in current tests for verification conflict and edits during the manifest-refresh wait, or add the missing cases. A normal conflict test or successful revision round trip does not establish a race case.

The pre-staged candidate fast path also needs a base-state check in its contract: commit it only against the document/revision for which it was prepared, otherwise restage or refuse. The reducer currently accepts `action.candidate` without establishing that relationship. Prove that queued/intervening changes cannot be replaced by an older candidate. This is the existing atomic/live-state safety requirement, particularly relevant to the performance optimisation.

Do not mark these rows complete based on code inspection alone. Submit the remaining agreed rows together, rather than only a validator patch.

## 3. Performance is improved, still unqualified

The reported real-example median preview 14.0 ms is an improvement, but p95 177.9 ms still indicates visible stalls. Commit median 115.5 ms misses the original 100 ms target, with p95 217.7 ms; the 20k limit remains approximately 2.9 seconds per commit. Keep these marked unmet.

Continue targeted trace-driven optimisation while preserving correctness. Measure manual and verification paths separately: the candidate fast path is used by verification batches, whereas the benchmark drags manual notes. Do not attribute a manual timing improvement to a path that benchmark does not execute. Five samples' reported p95 is effectively a maximum; retain raw samples and label the statistic honestly or increase sampling.

Complete the fixed plan's interactive measures and named environment evidence. If a supported-cap proposal is chosen, make it concrete and measured, with explicit non-destructive UI/API handling; it is not approved by this review. The real 1,338-note workflow remains a required supported objective.

## 4. Hardware remains separate

Physical touch is BLOCKED until an actual device/OS/browser run. Emulation remains supplemental. Do not describe this as the only remaining gate while software evidence and performance remain open.

## Next submission

Continue the existing consolidated stabilisation pass: finish R4, bounded A2/A3 and matching A4/A7 assertions, and performance evidence/improvement. Preserve the now-passing S2/S5/structural checks. Supply a complete updated O/S/R/A table, not just a total test count, plus the physical-device result or explicitly isolated hardware block. No Phase 8, library migration or unrelated feature work is authorised.

No product code, Git branch, commit or release was changed during review.
