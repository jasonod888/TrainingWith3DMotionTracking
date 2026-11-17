# Phase 7 stabilisation submission review

Reviewed 14 November 2026. Commit `5bc16eb49c158ce86013937976a7340c7e9c130f`, branch `phase7/normal-route`.

**Decision: CHANGES REQUIRED for software; performance targets unmet; hardware blocked. Phase 8 remains stopped.** The shared module is a substantive improvement. This review uses the existing consolidated matrix in `docs/piano-workspace-phase7-stabilisation-handoff.md`; it adds no feature scope or new phase requirements.

## 1. Independently verified progress

| Check | Result |
| --- | --- |
| Unchanged delete Accept -> Reject | Pass: 20 -> 19 -> 20 |
| Unchanged merge Accept -> Reject | Pass: 20 -> 19 -> 20 |
| Written-duration reversal protection | Pass |
| TypeScript | Clean, exit 0 |
| Shared-module audit against S2/S5/R4 | **Five assertions fail**, normal browser-run exit 1 |
| Full 483-test suite and other browser scripts | Developer-reported this review, not independently repeated |

The operation-aware present/absent representation resolves the earlier structural guard defect. The browser round trips are real improvements, not just updated labels or note counts reported by the developer.

Audit script: `docs/qualification/piano-workspace-phase-07-review/check-transaction-contract.py`.
Output: `transaction-contract-results.json` alongside it. Run from repository root with `.venv-saas/Scripts/python.exe` and Vite at 127.0.0.1:5173. It imports the actual pure transaction/core modules through local Vite in Chrome, uses synthetic local documents, intercepts APIs and changes no real lesson or server decision. It does not replace the developer's ordinary-suite tests.

## 2. Remaining software findings, mapped to the fixed matrix

### S5 / O4 — inverse restoration changes valid original data (high)

Prepare/delete/invert a valid note with unknown recorded duration/velocity and retained performance metadata. The local audit produces:

| Field | Before acceptance | After Reject/inverse |
| --- | --- | --- |
| duration | null (unknown) | 0.25 |
| velocity | null (unknown) | 0.7 |
| notation_duration | 0.3 | null |
| confidence | 0.8 | null |
| optional | true | false |

The baseline stores only a projection of the original occurrence, and restoration goes through generic insertion defaults. An unknown value is not a default authored value. The same issue needs checking for split/merge restoration and zero velocities; merge still uses `velocity || 0.7`, so a valid zero can become 0.7.

Complete S5 with actual round-trip equality of canonical performance and affected authored state, not just successful baseline serialization or a validator accepting null. Preserve the full original occurrence fields and notation needed by the inverse, preferably via the existing guarded patch machinery or a narrowly validated restorative command. Keep display-only placeholder lengths out of persisted truth. Do not broaden ordinary user insertion to accept arbitrary unvalidated data.

### S2 / O4 — stale delete ignores a later velocity edit (high)

The finding's before-snapshot has velocity null. Change the live velocity to 0.9, then prepare that deletion: **prepareFinding returns applied**, allowing the locally edited note to be deleted.

`matchesBefore` checks only pitch, onset and some duration cases. It ignores other relevant before-fields, including velocity. This is precisely the existing S2 related-edit family, not a new case outside the checklist.

Compare the relevant complete before-preconditions for each operation using the shared representation. A destructive edit needs to detect changes to data it would discard. Match snapshots by stable ID rather than relying on array position when multiple sources are involved. Retain the existing unrelated-edit policy and add these field variations to the parameterised suite.

### R4 — semantic baseline validation is incomplete (required)

The actual `validateBaseline` accepts all of these malformed present states:

- `spelling: "not-a-note"`.
- `eventStart: 1, eventDuration: 1`, off the existing 120-tick written grid.
- `duration: Infinity` (runtime input; persisted JSON cases should also be covered separately).

Checking string length or `number > 0` is insufficient for the claimed schema. Use finite/integer/grid rules, real spelling parsing with pitch agreement, supported staff/voice enums, strict present/absent discriminants for both before and after states, valid coverage and document bounds. Test all malformed nested fields, not only empty spelling and pitch=999. Recovery and runtime should share this same validator; invalid reversal metadata must not authorise a mutation or discard otherwise valid recovered work.

## 3. Matrix coverage is not yet complete

The ordinary-suite tests are useful, but several table entries overstate what their assertions establish:

| Matrix item | Current gap | Required completion |
| --- | --- | --- |
| O7 | One invalid pitch command is labelled compound failure | Stage a valid first edit followed by a rejecting later edit; assert no mutation/history/selection drift |
| O8 | Does not assert the advertised second inverse/refusal or history behaviour | Exercise repeated accept/reject/no-op policy and exact history/IDs |
| S2/S3 | Combined test only changes pitch | Parameterise relevant performance and authored fields; preserve existing external written-duration probes |
| S5 | Nullable round-trip equality is not asserted and fails the audit | Add null/zero/duration/metadata round trips for structural operations |
| R3 | The stated partial example contains the only required entry, so it is complete | Use a multi-target transaction and remove one genuinely required present/absent/before entry |
| R4 | Only pitch=999 and empty spelling are tested | Cover schema and semantic malformed values, including the failures above |
| R5 | Wrong finding ID alone is not complete identity qualification | Map the report/source/account/base protections to actual tests at the appropriate module/recovery boundary |
| A2/A3 | Explicitly not separately exercised | Add bounded browser cases for related/unrelated edits during a pending decision; include the current alignment when placement depends on it |
| A4/A7 | References old conflict/revision scripts rather than demonstrated current race cases | Identify exact matching assertions or add the missing conflict/refresh-pending scenarios |

Do not relabel a row complete solely because code rechecks live state. Evidence must exercise that branch. Pure tests are suitable for most O/S/R variations; keep async UI scenarios in a reliable browser harness when jsdom cannot execute them cleanly. Preserve assertions and normal teardown; no forced exits.

Submit one corrected matrix with exact test references, applicable parameters and results. This is completion of the consolidated handoff, not another invitation to patch only the five latest audit assertions. Retain all existing reviewer scripts, including the now-passing structural round trips.

## 4. Performance workstream — still not qualified

The developer correctly reports unmet targets: real-example commit median 133.5 ms exceeds the proposed 100 ms target; the 20k fixture's approximately 2.9-second commit time is not an acceptable interactive result. Do not describe Phase 7 software as fully qualified while supported interaction limits fail.

Next action: profile one actual successful command from dispatch through candidate generation, validation, history/diff, signature/recovery preparation and React/SVG commit. Remove repeated full-document work only where traces establish the cost, preserving the transaction/identity safety contract. The workspace currently preflights and then dispatches work again; measure that duplication rather than assuming it is the only bottleneck.

Improve the benchmark evidence itself:

- Assert each timed gesture actually applied the intended command and changed one history step. Separate applied, rejected and no-op samples.
- Warm-up, name hardware/browser/build mode, record sample count and raw timings. With five samples, the reported p95 is effectively the maximum; label it honestly or use enough samples for a meaningful percentile.
- Measure the specified pan/zoom, selection, playback/cursor continuity, undo/redo, save-payload and recovery paths, not only pointer dispatch plus one rAF.
- Compare before/after on the real clip and valid 20k/512-measure fixtures. Retain deliberate dense/repeated/tied/held cases.

A lower supported interactive limit is an acceptable proposal only if concrete, measured and clearly enforced without silent note loss, and then explicitly reviewed. A blanket cap below the real 1,338-note example would not meet the original objective. Do not use a cap or renderer change to conceal unresolved correctness defects. No optimisation or cap is approved merely by this report.

## 5. Hardware workstream

Physical touch remains **BLOCKED**. The original device matrix in the consolidated handoff is unchanged. It may be arranged in parallel once the tested software build is stable, but emulation does not satisfy it. No hardware access is requested by this review.

## 6. Next submission

Continue the same single stabilisation pass: finish the remaining agreed matrix rows, correct the reproduced S2/S5/R4 defects, provide a measured performance improvement or supported-limit proposal, and isolate any remaining hardware-only block. Keep Phase 8 stopped. Preserve the existing architecture; no library pivot or unrelated product feature is requested.

No product code, Git branch, commit or release was changed during this review.
