# Expression report contract (schema version 2)

Status: diagnostic report contract. No expression category is enabled.

The [12 November implementation and measured-results report](qualification/piano-expression-implementation-2026-11-12.md)
supersedes the historical smoke limitations below. Attribution and conditional calibrated
velocity application are implemented; useful natural-error recovery remains unproven.

The latest [implementation review and original-clip test](qualification/piano-expression-review-2026-11-12.md)
records the subsequent fixes and expanded benchmark. The earlier smoke result below
is historical evidence and does not establish improvement on natural decoder output.

## Purpose

Expression evidence is generated after Phase 3 from the exact working events. Candidate
generation and permission to apply are separate. A report may contain diagnostic
candidates even when every automatic category is disabled; the API rejects anything that
is not explicitly qualified and scoped.

## Targets

| Attribute | Target kind | Units | Explicitly not |
|---|---|---|---|
| `audible_duration` | `audible_end_seconds` | seconds | MIDI key release, written duration, pedal state |
| `relative_dynamics` | `relative_attack_level_db` | dB | calibrated MIDI velocity, linear rendering gain |
| calibrated `relative_dynamics` | `reference_velocity` | normalized 0–1 MIDI velocity | physical key pressure |

`notation_duration` remains the independent written value. Relative attack level is
diagnostic only until an applicable velocity calibration exists. The application path
can change `velocity` only with separately qualified calibrated evidence.
Attack evidence uses bounded note attribution, retaining harmonic SNR as fallback
diagnostics. Uncalibrated measurements have no proposed velocity. `baseline_velocity` is separate from
the dB measurement; `summary.measurement_count` does not count musical edits.

## Report fields

- `schema_version: 2`, `schema: piano-expression-report-2`
- `mode`: `diagnostic` or `qualified`
- `status`: `complete`, `partial`, `unsupported`
- `working_sha256`: hash of the exact Phase 3 events
- `source`: recording/audio identity, model, decoder, weights where available
- `settings_sha256`, `implementation` via the policy
- `analysis_switches`: independent duration/dynamics analysis switches
- `targets`: units and unsupported semantics
- `limits`: event count, analysis batch, truncation
- `candidates`: per-attribute baseline/no-change/change candidates with interval,
  decision, evidence and abstention reason
- `abstentions`: per-note reason codes
- `coverage`: denominator, analysed/suggested/no-change counts and truncation
- `policy`: full policy plus digest when supplied
- `proposals`: only qualified duration or calibrated velocity changes for compatibility with the API. The
  authoritative v2 field is `candidates`.

## Candidate fields

Each candidate retains the event ID, attribute, target kind/units, baseline value,
proposed value, candidate interval, decision, status, reason, evidence, `scope`
(`isolated` or `polyphonic`) and application scope. Duration candidates always include
the no-change hypothesis. Overlap, clipping, missing release, independent-view
disagreement, quiet/unsupported material, materiality and resource limits produce
abstentions rather than edits. Polyphonic candidates are diagnostic only until a
separate polyphonic scope is qualified.

## Application rules

- Only `audible_duration` and calibrated `relative_dynamics` can be applied automatically.
- The candidate must be `decision: change`, `status: qualified`,
  `proposal_status: suggested`, `correction_status: qualified`, non-ambiguous and bound
  to the current working hash and exact baseline value.
- The policy must be qualified, the category enabled and runtime-implemented, its
  `scopes` list must include the candidate scope, and the implementation fingerprint
  must match.
- Relative dynamics is never applied without a validated velocity calibration.
- Calibrated dynamics additionally binds the calibration artifact digest, recording
  domain, captured-MIDI reference kind, supported pitch and observed velocity range.
  The normalized candidate and uncertainty interval must be valid and bounded.
  Calibration measurement identity includes the full expression dependency bundle,
  verifier/templates code and effective settings. Stale or mismatched calibration is rejected.
- Velocity application preserves duration and `notation_duration`. Duration application
  preserves velocity and written notation. Independent category and scope gates apply.
- A Phase 4 failure leaves the Phase 3 working result intact.

## Benchmark and qualification

`scripts/benchmark_piano_expression_v2.py` emits reference-based `expression_trials`.
Correctness and damage are derived from `reference_value`, `before`, `proposed` and
`tolerance`, not from manually supplied success flags. Qualification requires distinct
held-out human performances, individual suggestions, precision and zero damage.
Controlled rendering-gain and MIDI key-release diagnostics cannot qualify velocity or
audible-ending targets.

The old audit remains at
[`qualification/piano-expression-audit-2026-11-11.md`](qualification/piano-expression-audit-2026-11-11.md).
Public held-out captured-MIDI velocity evaluation has now been completed, with zero
safe velocity suggestions. No independently annotated human audible-ending benchmark
has been completed. The reference
format, audible-ending intervals and calibration rules are in
[expression-reference-data.md](expression-reference-data.md).

## Current smoke result

The v2 rendered smoke run (one seed, 24 controlled variants) produced 14 duration
suggestions against deliberately corrupted controls, all within the 80 ms reference
tolerance, with zero measured damage and zero suggestions on the clean-reference and
natural-decoder inputs. It covered only eight scenario identities and is rendered
evidence, so it does not qualify any category. The natural decoder had no recovered
duration errors in this smoke run; that remains an explicit coverage gap.

The historical estimator abstained whenever another event overlapped the note interval.
The current estimator attempts bounded note attribution, including overlapping notes,
but abstains for inseparable partials, conflicting views or poor evidence. Polyphonic
application still requires its own qualified policy scope.
