# Phase 7 consolidated final review and finite completion list

Reviewed 15 November 2026 (Singapore).
Submission: `648f68feebd91b5f31b65843add8beace872102a`; product/performance parent `ca255eb`; branch `phase7/normal-route`.
Authority: `docs/piano-workspace-phase7-completion-contract.md`.

## Decision

**NO-GO for complete Phase 7 and Phase 8.** This submission is a legitimate decision-required checkpoint, not a completed qualification. The 5,000-occurrence proposal is a sensible direction to investigate and implement after owner approval, but its full claimed interaction boundary is not yet demonstrated. Approval of a proposed limit cannot substitute for implementing and testing it.

One remaining saved-point correctness failure was reproduced at the existing bounded-history boundary. Performance evidence only covers one edit path and the fixture is 482 measures, not the claimed 512. Hardware remains explicitly untested. This report lists the complete remaining work under the frozen contract; it does not request new editing features or architecture replacement.

## Independent verification and evidence limits

| Check | Result |
|---|---|
| Git identity and product diff | Confirmed submitted SHA; latest product changes extract historyPath and add saved-point tests |
| TypeScript | Clean, independently executed |
| Normal-route Save A -> edit B -> Undo A -> Redo B | Pass independently: saved clean, edit dirty, undo clean, redo dirty; pitch 70 -> 71 -> 70 -> 71 |
| Saved-point identity after existing history eviction | **Fail independently:** exact saved document restored but identity differs; reproducer below |
| Benchmark implementation and raw results | Inspected; production base 4173 recorded; timing evidence is roll pitch-drag only, not every command or rendered-paint latency |
| Actual stress-fixture notation headings | All inspected size variants report **482 measures** |
| Full 492-test suite/build and complete 16-script result | Submitted developer evidence; not fully independently reproduced in this review |

The independent regression runner was started and normal-route, async, A7 and contract logs were produced before continuation was blocked. Automatic approval review rejected continuation because the run triggered an HTTPS connection to an unverified Visual Studio telemetry host with an unestablished payload. No workaround or repeated blocked execution was attempted. The submitted all-green logs remain developer evidence; do not present them as a complete independent rerun. Further permission or an approved explanation of that outbound behaviour is needed before repeating the blocked action. This environment restriction is not a newly demonstrated product failure.

## R1 — saved-point identity must survive bounded-history eviction

This is the existing B1 saved-point contract together with the existing 500-entry/4 MB history policy, not a new feature.

Reproducer, from repository root:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-07-review/check-savedpoint-eviction.py
```

Observed on the submitted code:

```json
{
  "savedDepth": 500,
  "afterUndoDepth": 499,
  "savedPath": "500:history-500",
  "afterUndoPath": "499:history-500",
  "evicted": true,
  "exactDocumentRestored": true,
  "passed": false
}
```

After saving at the 500-entry boundary, another edit evicts the oldest patch. Undo restores the exact saved document and the same top transaction, but the retained history depth is 499 instead of 500. `historyPath` includes retained depth, so the workspace treats the restored saved content as dirty.

**Required repair:** use a savepoint/state identity independent of the number of retained patches. Preserve distinct identities for branching, external document replacement and an evicted root. Do not remove history limits, restore unbounded snapshots, or merely remove depth while treating every empty evicted history as the original document.

**Pass evidence:** ordinary-suite tests for count-eviction and byte-budget-eviction, plus a workspace-level saved/undo check using the repaired identity. Cover returning to a saved point after eviction, redo dirty, branching dirty, empty retained history with an evicted root not falsely matching the original baseline, and document replacement. Retain the existing normal savepoint, delayed-save and A7 checks. Assert exact restored document and dirty identity, not one pitch alone.

## R2 — finish the performance evidence already required by the contract

The submitted measurements support a narrow claim: production-build roll pitch-drag DOM/frame-boundary timings meet the thresholds at 1,338 and 5,000 occurrences in the reported runs. They do not yet establish that the whole editor meets the proposed boundary.

Existing-contract gaps to close together:

1. **Actual boundary:** the raw heading for the proposed 5k fixture says `5000 notes ... 482 measures ... 120 BPM`. The hold compresses 1,024 source seconds into fewer score measures. Construct and validate a fixture with an actual 512-measure notation document and exactly 5,000 occurrences; assert those counts and ownership/alignment validity in the runner. If instead proposing a lower measure limit, say so explicitly rather than calling 482 a 512-measure measurement. Retain dense/repeated/shared/tied/held cases from the contract.
2. **Command coverage:** time the listed roll time move/resize, sheet pitch, Keyboard Replace, written duration/accidental/respell, add/delete, valid detach/structural paths and actual undo/redo. Current pitch-only timings cannot qualify the slower full-refresh paths. This matters here: recorded duration and velocity still call `finalise` in `correction.ts`, contrary to the broad fast-path claim in the handoff. Correct that claim; do not introduce another optimisation unless the measurements justify it.
3. **Canonical correctness:** track a fixed occurrence ID, verify expected exact values and one history transaction per completed edit, compare the full original/restored canonical document and unrelated occurrences, and check valid mappings. Current benchmark uses the first DOM note, compares only pitch and checks one redo. That is insufficient for the contract's full undo/restoration claim.
4. **Executable qualification:** the runner must distinguish measurement collection from PASS/FAIL and exit nonzero for failed correctness or failed qualification at the proposed supported boundary. Present code writes results and exits normally even when gates or boolean fields fail. Keep exploration at 10k/20k labelled unsupported/decision evidence so it does not accidentally override the qualification result.
5. **Measurement endpoints:** keep DOM/frame-boundary timing labelled honestly. `requestAnimationFrame` is before paint; it is not proof that a visible result was painted. The supplied ZIPs are Playwright action/screenshot traces, not Chrome CPU-performance profiles. Supply the browser performance attribution requested by the contract or explicitly identify the evidence type and its limits. Record cold first-edit values separately from navigation DOM/load timing; they are different measurements.

For each required timed edit journey at the real and proposed actual maximum fixture, use the contract's three runs of at least 20 valid applied samples after warm-up; report per-run median/p95/max and raw samples. Each supported-path p95 must meet the unchanged one-refresh-interval preview and 100 ms commit/undo/redo criteria, or become an explicitly named limitation/decision. Numeric preview criteria apply to preview-producing gestures, not buttons with no preview.

For pan/zoom/reveal, loaded-video cursor agreement, save-payload/recovery costs and memory/history growth, provide the already-requested measurements/observations; no new numeric target is introduced here. Keep network/media mocking clear.

**Stopping rule retained:** no more open-ended optimisation loops. Complete this measurement set. If any supported path still misses the gate, submit one consolidated decision proposal identifying that path, exact measured limit and tradeoff. A pitch-only pass cannot close all interaction performance.

## R3 — owner decision and exact limit enforcement

**Recommendation to the owner:** favour a measured 5,000-occurrence interactive limit over indefinite optimisation of 20k for this phase, provided R2 qualifies the actual supported interaction/measure boundary. This is a recommendation, not approval on the owner's behalf. It reduces existing advertised editing capability and therefore needs the owner's explicit decision.

After approval, implement one shared capability policy and test it end-to-end:

- Define the limit in **performance occurrences**, not logical notes, notation events or mounted rectangles. Specify the measure limit and reject growth from 5,000 to 5,001 during insertion/verification before mutation.
- Apply it on initial review, saved-only load, library revision, recovery and subsequent commands. Gate toolbar, keyboard shortcuts, roll/sheet gestures, keyboard Replace/Add, settings/alignment mutations, Undo/Redo where they would mutate a read-only document, save and server-mutating verification decisions. Do not leave an alternative mutation route active behind disabled buttons.
- Existing larger valid references remain intact and readable: source playback, both cursors, selection and navigation remain available. Do not change storage data or reduce source occurrence counts automatically.
- Implement the promised download/export of the authored reference/notation/alignment and any existing recovery checkpoint. Verify exported values and identity; a promise in the handoff is not implemented export functionality. A checkpoint created before a limit change must remain recoverable/exportable without silent deletion.
- Show an explicit read-only reason and count. Reject new over-limit editable review/revision payloads using the agreed server/API rule while preserving authorised reads of existing valid data. Resolve the current proposal's `rejected or imported read-only` ambiguity into one explicit behaviour for each entry point. Do not arbitrarily restrict unrelated lesson types.
- Test 4,999/5,000/5,001 occurrences, the approved measure boundary and one-over, existing 20k reads, attempted direct API write, recovery over the cap, and the last-valid -> first-invalid insertion/verification transition. Preserve authentication/access checks.

Once the owner approves the policy, R3 is an implementation-and-verification item, not another proposal-only submission. If the owner chooses continued 20k support instead, R2 must qualify that boundary and no 5k restriction should be introduced.

## R4 — physical-device sheet, owner responsibility

H1-H9 remain NOT RUN. The submitted hardware-block status is honest and acceptable as a status report; it is not a Phase 7 pass. The owner/developer/device tester must execute the already-written H1-H9 sheet on the final approved-limit build, record device/OS/browser/orientations/commit and actual playable media, and attach the required short recording and per-row outcomes.

Do not ask the developer to solve missing hardware through more software patches. R1/R2 and any approved R3 work can proceed independently. If hardware is still unavailable afterward, mark software and performance separately closed where proven and leave only HARDWARE BLOCKED; no repeated software submissions are requested.

## One final resubmission — exact deliverables

1. Final SHA; concise R1 repair explanation; no unrequested feature/library work.
2. R1 ordinary and workspace tests, plus established normal-route/save/recovery/O-S-R-A regression results on that code. Failed tests remain present; no forced test-process exit.
3. R2 per-path and actual-boundary performance table, raw samples, environment, profiles and correctness assertions, with a qualification exit status. Update misleading fast-path/fixture claims in the final handoff.
4. Owner's explicit R3 decision; if a reduced boundary was approved, actual enforced implementation and boundary/read-only/export/API tests. If further decision is required, state it once with the full path-specific measurement table.
5. H1-H9 physical report, or one isolated hardware-only block for the owner to resolve.

**Acceptance:** all software checks pass; all claimed supported interactions qualify under explicitly approved limits/targets; enforcement matches the chosen policy; hardware sheet passes. Then Phase 7 can receive GO and Phase 8 can be authorised. Until then, Phase 8 and release remain stopped. A new unrelated feature requirement will not be added to this completion list.
