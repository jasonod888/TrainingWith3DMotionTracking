# Phase 7 consolidated review — a37a3e5

Reviewed 15 November 2026 (Singapore).
Submission: `a37a3e5aaa12a30f5878ab283372b45c3a97ee41`, branch `phase7/normal-route`.
Scope remains the completion contract and prior final review. **No new feature or library work is requested.**

## Decision and closed work

**Phase 7 is not yet accepted; Phase 8 remains stopped.** The optimisation is credible progress, and the exact 5,000-occurrence/512-measure fixture and previous history-eviction repair are now present. However, the performance runner still accepts a deliberately suppressed edit as applied and restored. Its reported canonical-restoration claim is stronger than the assertions actually implemented. Therefore the per-path performance package cannot yet be certified as a complete PASS.

| Area | Decision |
|---|---|
| R1 saved-point eviction | **Closed:** independently reproduced exact document/identity restoration after count eviction |
| 512-measure fixture count | **Closed:** raw results now identify 5,000 occurrences, 500 written events, 512 measures |
| Optimisation implementation | Set-based performance mapping and grouped rest lookup remove demonstrated repeated work; no new product failure reproduced in the inspected optimisation |
| R2 performance evidence | **Not closed:** false-positive applied verifier, count/dirty-only restoration, omitted undo/redo timing and canonical assertions |
| R3 supported-limit activation | **Awaiting owner decision and route integration:** helpers exist; restriction is correctly inactive |
| R4 hardware H1-H9 | **HARDWARE BLOCKED:** not executed |

The developer correctly kept the restriction inactive without owner approval. That is not itself a defect or instruction violation. It does mean the unrestricted application is not yet qualified as a supported 5k-only editor.

## Independent results

- TypeScript: clean.
- Saved-point eviction diagnostic: pass, exact document restored and saved identity `entry:history-500` unchanged after eviction/undo.
- Python prepared-policy tests: 3 passed.
- Existing transaction-contract audit: 5/5 pass; normal-route save A/edit B/undo/redo probe: pass.
- Raw path JSON: 60 path-runs (10 paths x 2 fixtures x 3 runs); reported sample counts and nearest-rank commit p95 arithmetic consistent. This verifies arithmetic, not the semantic truth of the applied/restored counters or fresh timing.
- Benchmark negative control: **fail** as detailed below.
- Full 497-test suite, build, complete 16-script run and reported latency values remain developer evidence; the blocked full-run command from the prior review was not retried or bypassed.

## R2 — one complete evidence repair, not another optimisation loop

### Confirmed false positive

From the repository root:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-07-review/check-path-verifier-negative-control.py
```

This loads the genuine production workspace and the submitted benchmark helper. The review substitutes a timing-only stub for `gesture`, deliberately dispatching **no resize edit**. The submitted path verifier nevertheless reports:

```json
{
  "gesture_was_suppressed": true,
  "dirty_before": "false",
  "dirty_after": "false",
  "benchmark_claims_applied": true,
  "benchmark_claims_restored": true,
  "passed": false
}
```

Cause: resize calls any positive existing recorded length a successful applied resize. The final restoration check merely compares total occurrence count and `dirty == false`. Neither proves a resize happened or that the exact document was restored.

Other assertions remain weaker than the handoff claims: written duration and respell use `dirty == true` instead of expected authored values; Add/Delete use counts; restored rows use count plus dirty. Undo is performed outside the timed action, and there is no undo/redo performance table. The latest handoff's claim of complete canonical assertions/restoration and all applicable timing paths is therefore not established by the submitted script.

### Required repair and exact pass conditions

Retain the existing benchmark and improve its verifiers once as a coherent change:

1. Capture a canonical before snapshot through the real document authority; identify the intended occurrence/logical note/event and scope. After each timed action, verify the exact intended changes and complete unrelated-state preservation. Do not substitute DOM text/dirty flags for canonical state.
2. For resize verify changed **expected** recorded duration and unchanged onset/written duration; for written duration verify the expected tick value and unchanged recorded duration; for respell verify the exact new spelling with unchanged MIDI/audio identity. Add/Delete must verify exact identities, values and mappings, not only counts. Apply equivalent explicit assertions to the remaining paths.
3. After Undo compare the complete canonical document with the before snapshot, including nullable metadata, performance ownership, spelling, written events/segments/ties and map. Check selection/dirty according to the existing contract. Redo must restore the expected after snapshot. Keep async/save/recovery metadata assertions where applicable; avoid comparing ephemeral timestamps as musical data.
4. Time Undo and Redo as required, rather than merely clicking them after the commit measurement. Include a valid representable detach/shared-mapping and tied-note case already required by the contract; it can be a named variant of an existing path rather than a new product feature.
5. Add verifier negative controls: suppressed resize, unchanged written duration/respell, wrong insertion target and corrupted post-undo canonical state must fail qualification. The review's suppressed-resize case must no longer be counted as applied. A verifier failure exits nonzero and cannot be excluded as a fast successful sample.
6. Rerun the corrected complete matrix at the real recording and exact approved/proposed boundary, preserving three runs of 20 valid samples and unchanged p95 criteria. Keep timing-only work separate from untimed canonical snapshot capture. Preserve raw before/expected/after evidence or compact hashes plus a diagnosable canonical diff.

No claim is made that the reported millisecond values are fabricated or that resize itself is broken. The blocker is that the runner cannot presently establish whether all those measured actions and restorations were correct. Fix that evidence gap before doing more optimisation. If the corrected runner passes the fixed criteria, close R2; do not introduce new timing targets.

The final handoff should have one authoritative current status, not contradictory active-looking PASS/FAIL sections. Mark earlier results historical and correct stale fast-path/history descriptions. This is reporting cleanup, not a new phase gate.

## R3 — proposed restriction and owner approval

**Recommendation:** approve the direction of a 5,000-occurrence/512-measure interactive boundary, subject to corrected qualification and the already-specified enforcement tests. It is a product restriction and cannot be approved by the reviewer on the owner's behalf. No arbitrary reduction to 2k is requested.

The prepared TS/Python modules are small policy/export helpers, not a completed integrated read-only implementation. Their unit tests show count-based policy and copying of supplied data; they do not prove UI/API protection or full workspace export. No live route imports either module, as the submission honestly states.

After explicit owner approval, complete the existing R3 integration checklist from `piano-workspace-phase-07-final-review.md`:

- Apply one policy on draft/saved-only/library/recovery entry and **candidate results** of Add/verification/import so 5,000 -> 5,001 is rejected atomically.
- Gate all mutation entry points, including shortcuts, gestures, settings/alignment, history, save and verification decisions. Check the approved measure boundary through the existing notation validation.
- Enforce writes server-side without blocking authorised reads of existing valid 20k data; specify which new/imported over-limit workflows reject versus open read-only. Keep guitar unchanged.
- Provide actual read-only UI plus reference/recovery download, retaining full notation **and** separately held alignment, offset, sections, assessment, identity and checkpoints. Copying only the notation argument is not a complete authored-reference export. Do not delete existing unsaved work or silently truncate it.
- Execute the already-requested 4,999/5,000/5,001, measure boundary/one-over, direct API write, existing-large-read, recovery and last-valid-to-first-invalid transition tests through real route code.

Do not claim this is active by changing the `approved` constant alone; the routes currently do not call these helpers. No deployment is authorised by approval to prepare/integrate the restriction locally.

## R4 and the final stopping rule

H1-H9 remains owner/device-tester work on the final integrated build. Complete the existing sheet or record one isolated HARDWARE BLOCKED status. More browser emulation does not close it; no more coding to solve missing hardware is requested.

The remaining finite package is **R2 evidence repair + an explicit R3 decision and integration + H1-H9**. R1 and exact fixture counts are closed. Previously passing verification/save/async checks remain regression checks, not new repair projects.

The next consolidated submission must contain final SHA, corrected performance runner and raw results, retained regression evidence, the owner's policy decision and integrated boundary tests, plus actual-device results or the isolated hardware block. Software/performance may be recorded closed independently of unavailable hardware once proven. Full Phase 7 GO and Phase 8 authorisation require the existing agreed gates or an explicit owner change to them. No release or new feature requirement is introduced here.
