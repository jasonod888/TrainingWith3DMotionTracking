# Phase 7 R4 / async review — progress confirmed, gate still open

Reviewed 15 November 2026 (Singapore). Commit `146e932ea3474ddac44bec54a2bad16cc16e7651`, branch `phase7/normal-route`.

**Phase 7 remains incomplete; Phase 8 remains stopped.** The reported R4 defects and the three tested pending-decision/conflict scenarios now pass independently. No additional product-code failure was reproduced in these checks. The remaining agreed work is A7, performance qualification, physical touch and reproducible placement of the async evidence script.

## Independent results

| Check | Result |
| --- | --- |
| Baseline-shape audit | 2/2 pass: false before discriminant and malformed extra entry refused; inverse does not throw |
| Existing transaction contract audit | 5/5 pass: metadata preserved, stale velocity delete refused, semantic malformed fields refused |
| Pending-decision/conflict browser cases | 3/3 pass using the committed review-folder copy |
| TypeScript | Clean, exit 0 |
| Full 490-test suite / other reported scripts | Developer-reported this review, not independently repeated |

Confirmed async outcomes:

- A2: manual target pitch 61 survives the held acceptance response.
- A3: unrelated pitch 65 survives while accepted target becomes 62.
- A4: tested 409 branch retains target pitch 60 and reports the conflict.

These confirm the named scenarios, not every possible concurrency interleaving. Preserve their assertions in the consolidated matrix. Candidate source-document identity is now checked in the reducer; a mismatched base restages rather than replacing current state with the old candidate. The new reducer test covers an intervening unrelated edit.

## Remaining items — fixed scope

### 1. A7: pending manifest-refresh race

Still required: drive the real library revision path, hold the post-save manifest-refresh GET, edit the current document while it is pending, then release it. Assert the editor remains mounted, the newer work is dirty/checkpointed/saveable, no false current-Saved/navigation occurs, and retry/reopen preserves the correct base revision. Use bounded teardown and record actual request/response ordering.

The successful revision journey is already useful evidence; it is not this pending-refresh case. Do not mark A7 complete from the liveDirty implementation alone.

### 2. Make the submitted async script runnable from its documented location

Command attempted from repository root:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-07/scripts/check-async-races.py
```

It fails before running a case: the copied helper resolves ROOT at the wrong depth and tries to load `D:/3d_trainer/developement/docs/docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py`.

The committed `docs/qualification/piano-workspace-phase-07-review/check-async-races-async.py` copy runs normally and passes 3/3. Thus the scenario evidence is verified, but the submitted canonical script has a location-dependent path defect.

Keep one authoritative implementation or reuse an explicit repository-root resolver instead of copying depth-dependent helpers. Verify the documented command from a clean committed checkout, without scratch files. This is evidence reproducibility, not new UI/product scope.

### 3. Performance qualification

The submission explicitly retains unmet numbers: real commit median 115.5 ms / tail 217.7 ms versus the proposed 100 ms target; preview tail 177.9 ms; 20k fixture approximately 2.9 seconds per commit. No new measurements in this commit close those items.

Complete the existing trace-driven optimisation and interactive/upper-bound profile, or submit the previously described concrete supported-limit proposal. Keep correctness guards while optimising, distinguish manual versus verification fast paths, and preserve actual successful edit/history assertions. Do not describe a one-frame median as a one-frame responsiveness guarantee when tail latency is much larger.

### 4. Physical touch qualification

Remains **BLOCKED** pending a physical device/OS/browser run under the unchanged consolidated checklist. No hardware access is requested here, and no emulation waiver is given.

## Next submission

Do not reopen the now-passing R4/S2/S5/pending-decision examples unless a subsequent change regresses them. Submit A7, reproducible scripts and performance evidence together, with either the device report or a clearly isolated remaining hardware block. Continue using the existing O/S/R/A matrix and architecture. No Phase 8, library migration or release is authorised.

No product code, Git branch, commit or real server data was changed during review.
