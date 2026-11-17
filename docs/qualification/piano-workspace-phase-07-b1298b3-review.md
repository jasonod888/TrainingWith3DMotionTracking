# Phase 7 consolidated review — b1298b3

Reviewed 16 November 2026 (Singapore).
Commit: `b1298b37d85d6771dbd3ecb450cb63d38e62dda0`, branch `phase7/normal-route`.
Scope: the existing completion contract, R2 canonical evidence, R3 approval-gated integration and R4 hardware. No new feature, library, limit or latency requirement is introduced.

## Decision

**NO-GO for developer-controlled closure and Phase 8.** The latest timings and undo/redo evidence show substantial improvement, but the statement that only external gates remain is incorrect. Two approval-enabled integration defects and a canonical-verifier false positive were independently reproduced. Owner approval should not activate the current implementation until those defects are repaired.

The earlier history-eviction and exact fixture-count repairs remain closed. The original suppressed-resize flaw has been addressed; this review does not reopen it.

## Independent checks and evidence limits

| Check | Result |
|---|---|
| Submitted Git identity | Confirmed |
| TypeScript | Clean |
| Python policy/verifier tests | 6 passed |
| All 60 reported path-runs | Commit/Undo/Redo percentile arithmetic, sample counts and reported gates consistent with the submitted raw JSON |
| Approval-enabled read-only metadata probe | **Fail:** offset and assessment mutate a 5,001-note read-only lesson |
| Approval-enabled direct legacy review request | **Fail:** HTTP 200 persists 5,001 occurrences with notation omitted |
| Canonical verifier negative control | **Fail:** accepts an unintended onset change alongside a correct pitch edit |
| Full 497 web tests/build/16-script regression run and fresh 3-run latency execution | Developer evidence, not independently repeated in this review |

The three diagnostics use controlled browser routes or temporary test-app/database/storage fixtures. No real lesson was edited. Product code was not changed by this review. The previously blocked full-regression command was not repeated or bypassed; unaffected targeted checks succeeded.

## R3-A — read-only metadata is still editable

Reproduce from repository root:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-07-review/check-readonly-metadata-b1298b3.py
```

With approval enabled and 5,001 occurrences, the banner correctly says read-only. Nevertheless:

- Offset changes from 0 to 0.5 seconds.
- Assessment changes from `none` to `notes`.
- Dirty changes from false to true.
- Downloaded authored reference contains those changed values.

The reducer protects musical commands, but authored metadata setters bypass it. The JSX also leaves Add section and verification decision controls enabled, and the decision callback has no read-only preflight before the request. Alignment anchor controls are outside the disabled inspector. These all belong to the already-required mutation gate; do not repair only the two reproduced input controls.

**Required repair:** one shared current-policy check for every authored-state or server-mutating operation, with controls accurately disabled and callbacks refusing before side effects. Cover title/settings/sections/assessment, offset/alignment/anchor history, musical/history commands, save, verification decisions and over-limit candidate results. Keep permitted view navigation, source seeking, selection, playback, export and deliberate reference/recovery inspection available under the agreed policy. Do not confuse preview viewport state with persisted authored state: offset currently changes saved/exported alignment and dirty identity, so it is not merely a harmless viewport control.

**Pass evidence:** the review probe passes; a parameterised approval-enabled test covers the complete mutation families and asserts unchanged canonical document, authored metadata, history, dirty/checkpoint state and zero mutation requests. Include a verification report fixture and prove Accept/Reject sends no request while read-only. Retain exact-boundary editing, recovery/export and cancellation tests. Use authoritative state to guard gestures/callbacks as well as buttons.

## R3-B — server guard depends on optional notation

Reproduce with the temporary API app:

```powershell
& .venv-saas/Scripts/python.exe -m pytest docs/qualification/piano-workspace-phase-07-review/test_limit_legacy_write_b1298b3.py -q -s
```

Actual result:

```json
{
  "approved": true,
  "occurrences": 5001,
  "notation_omitted": true,
  "http_status": 200,
  "reference_written": true,
  "passed": false
}
```

The shared `write_error` is called only inside `validate_notation`. The review endpoint calls that validator only when the optional `body.notation` is present. A supported legacy request omitting notation therefore bypasses the approved restriction and writes an over-limit reference. Helper unit tests do not exercise this endpoint path.

**Required repair:** apply the piano write policy at the server operation boundary using authoritative current/proposed performance data, independent of optional notation or client assertions. Audit review, private revision, verification decision and other supported piano mutation endpoints under the same approved policy. Prevent changes to an already over-limit read-only lesson and reject candidate growth above the cap. Preserve valid reads/exports of existing larger references, permitted legacy inputs at/below the boundary, guitar behaviour and existing access/idempotency rules. Do not make optional notation mandatory as a substitute for enforcing the performance count.

**Pass evidence:** the direct route probe returns the agreed validation rejection before storage/revision/decision mutation; route tests exercise notation present and omitted, 5,000 accepted and 5,001 refused, existing over-limit mutation refused, candidate threshold crossing and approved/unapproved configurations. Assert no revision, asset or decision write on rejection and continued authorised reads. This was explicitly part of the existing direct-API/read-only integration requirement.

## R2 — canonical intent assertions remain incomplete

The switch to before/after snapshots, whole-document fingerprints and separately timed Undo/Redo is useful progress. The reported three-run numbers now have the requested shape and pass the stated numeric gates. But fingerprinting the actual after-state and replaying it does not establish that the action produced only the intended changes.

Reproduce:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-07-review/check-canonical-verifier-b1298b3.py
```

This performs a genuine pitch edit against the real recording, confirms the submitted verifier accepts it, then changes only the target's recorded onset by an unintended +10 ms in a copy of the after snapshot. The submitted `verify_edit('roll_pitch', ...)` still accepts the corrupted state:

```json
{
  "occurrence": "bp-1",
  "genuine_pitch_edit_accepted": true,
  "unintended_onset_shift_seconds": 0.01,
  "verifier_accepts_corrupted_after_state": true,
  "passed": false
}
```

This is a verifier failure, not evidence that the current pitch editor actually changes onset. It contradicts the claim that every sample verifies the exact scope and preserved fields.

### Complete the existing per-path contract once

Use explicit intended values and an allowed-change set for each path, checking both target preserved fields and unrelated canonical state. Do not fix just this new example.

| Path family | Required intent/preservation assertion already in scope |
|---|---|
| Pitch/sheet/Replace/accidental | Expected pitch/spelling and scope; target onset/duration/velocity and other performance metadata unchanged; unrelated written state unchanged except legitimate derived changes |
| Recorded time | Exact expected onset from gesture/snap/offset; target pitch/duration/metadata and authored timing unchanged |
| Resize | Exact expected recorded duration; target pitch/onset/metadata and written timing unchanged |
| Written duration | Expected tick value and explicit scope; all recorded fields unchanged; no unrelated authored change |
| Respell | Exact expected spelling; MIDI and recorded fields unchanged; no unrelated authored change |
| Add | Capture intended ghost pitch/onset/recorded/written durations before commit; verify the new identity, values and mapping plus complete original-occurrence preservation |
| Delete | Exactly the intended identity/scope removed; complete preservation of remaining performance/authored state except required derived geometry |

Current gaps include time/resize checking only that values changed, Add lacking an expected pitch/onset/duration, and written-duration/respell checking no unrelated authored-state changes. Retain full Undo/Redo checks and validate that the before/after mappings are structurally sound.

Add negative controls covering wrong target values, modification of a supposedly preserved target field, unrelated authored edits, incorrect insertion values, and post-Undo corruption. They must all fail while genuine valid actions pass. Do not count rejection/no-op as successful timing. Keep correctness captures outside timed action windows.

Rerun the corrected 3x20 matrix without changing the existing thresholds. Also make the qualification runner enforce Undo and Redo p95, not merely record them; this submitted dataset already reports values under 100 ms, so this is a runner enforcement fix rather than a demand for another performance optimisation. Keep the existing valid detach/shared-mapping/tied fixture coverage and do not weaken assertions to fit the simple boundary fixture.

## Final finite work package and external gates

The next delivery must complete **R3-A + R3-B + the R2 verifier repair together**, then provide the final tests/raw results and a truthful consolidated handoff. Existing passing checks remain regression evidence. No unrelated feature request is added here.

Owner approval of 5,000/512 and H1-H9 physical testing remain separate external actions. The reviewer recommends the proposed boundary in principle, but approval cannot cure the demonstrated integration failures. Keep the default inactive until the owner approves; all these repairs/tests can be completed in the approval-enabled controlled configuration first. Activation on a local qualification build does not require or authorise deployment.

After those software checks and corrected performance evidence pass, record software/performance closure separately if hardware is still unavailable. Full Phase 7 GO and Phase 8 authorisation require the agreed hardware/approval gates or an explicit owner decision changing them. Do not label this submission external-gates-only.
