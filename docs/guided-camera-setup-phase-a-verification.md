# Guided camera setup — Phase A implementation and verification

Date: 2 November 2026
Specification: [guided-camera-setup-implementation-plan.md](guided-camera-setup-implementation-plan.md)

Phase A delivers the contracts, the measurement adapter and the tests. It deliberately changes no
user-facing flow: the new modules are reachable only from tests, and `PracticeSession`,
`PracticeWorkspace`, `MimicInterface` and `web/dist/app.js` are untouched. The feature must stay
unreachable until the controller and measurement gates are verified in Phases B–D.

## What changed

- `web/dist/pose.js` — `assessStanding` hardened for malformed input and extended with a
  structured result (`reason`, `detail`, `scale`, `edge`). The successful return contract
  (`ok`, `height`, `floor`, `center`, `message`) is unchanged, and the check order is preserved so
  existing callers see the same decisions. `HeightCalibration` is unchanged.
- `apps/web/src/legacy.d.ts` — typed boundaries for the new assessment surface.
- `apps/web/src/camera-setup-estimator.ts` — `StableHeightCalibration`, the continuity adapter.
  Owns pause/credit/reset/expiry for the new flow only.
- `apps/web/src/camera-setup-controller.ts` — `CameraSetupController`, the pure state machine.
  Owns stage, intent, complete source identity, observation admission, positioning dwell, readiness
  recheck and the single-use handoff token.
- `apps/web/tests/camera-setup-estimator.test.mjs`, `apps/web/tests/camera-setup-controller.test.mjs`,
  `apps/web/tests/setup-pose-fixture.mjs` — deterministic synthetic coverage.
- `web/tests/pose.test.mjs` — malformed-input and structural-reason regression tests added to the
  existing suite.

No camera capture, inference cadence, scoring, recording or paired-display behaviour changed.

## Contracts as implemented

### Stage, intent, source identity

`SetupStage` is `prepare | starting | positioning | measuring | ready | handoff | help | error | cancelled`.
`SetupIntent` is `start_practice | start_compete | setup_only`. Stage and intent are explicit fields;
nothing is inferred from message strings or `cameraState === live`.

`SetupSourceIdentity` is `{generation, deviceId, width, height}` and is compared by value.
`generation` is the existing `SourceSession` epoch; dimensions are the real `videoWidth`/`videoHeight`
the calibration numbers are expressed in. A camera dimension change therefore invalidates even when
the epoch has not advanced. Pane-only resizes never reach this type.

`requirements` is `{facing, pairedDisplay, controlsConfirmed}`. It carries no dependency on live
voice-recognition state. Any source change clears `controlsConfirmed`.

### Observation admission

An observation is admitted only when the source identity matches, `capturedAt` and `receivedAt` are
finite, `capturedAt` is strictly greater than the previous admitted one, and
`receivedAt - capturedAt <= evidenceFreshnessMs`. Rejections are reported as
`non_finite | duplicate | out_of_order | stale | source_mismatch | wrong_stage`. A repeated result
can never add evidence.

Budgets in `SETUP_DEFAULTS`:

| Constant | Value | Purpose |
| --- | --- | --- |
| `visibilityThreshold` | 0.65 | setup positioning/measurement eligibility (auto-framing keeps 0.60) |
| `evidenceFreshnessMs` | 500 | reject results older than the frame they describe |
| `trackingLossMs` | 900 | no fresh valid observation at all |
| `eligibilityHoldMs` | 500 | continuous eligibility before measuring |
| `dwellIntervalCapMs` | 250 | largest dwell credit from one interval |
| `readyMinimumMs` | 1000 | minimum success display |
| `readyAnnouncementTimeoutMs` | 1500 | bound on waiting for the success announcement |
| `centreTolerance` / `centreExitTolerance` | 0.15 / 0.20 | horizontal centring with hysteresis |
| `helpAfterMs` / `stuckAfterMs` | 20000 / 45000 | help offered, then stuck |

Measurement constants in `SETUP_MEASUREMENT_DEFAULTS`: `minSamples` 30, `minAcceptedMs` 2500,
`maxCandidateMs` 10000, `interruptionToleranceMs` 600, `intervalCreditCapMs` 250, spread tolerances
0.04 / 0.025 / 0.035 (height ratio, floor, centre — the legacy tolerances), `maxStoredSamples` 64.

### Handoff

`consumeHandoff()` returns `{intent, calibration, source, countdownSeconds, consumedAt}` at most once,
and only from `handoff` with a pending token. It records `consumed` before returning, so repeated
completion events, re-renders and duplicate `done` observations cannot mint a second token.
`countdownSeconds` is fixed at 5 (`GUIDED_HANDOFF_SECONDS`). `blocksSessionActions` is true for every
live stage and stays true during `handoff` until the token is consumed; it is false after
`cancelled` and after a consumed handoff. Cancellation is terminal for that intent/source.

## Estimator continuity as implemented

`StableHeightCalibration` keeps the estimator's meaning — the same standing checks and the same
height/floor/centre tolerances — and replaces only the continuity policy:

- completion requires 30 distinct accepted observations **and** 2500 ms of credited time;
- there is no 3000 ms sample window, so the legacy cliff is gone;
- credited time only accumulates across consecutive accepted observations, each interval capped at
  250 ms;
- invalid observations pause progress and add neither samples nor time;
- a pause is resumed only if the fresh observation is consistent with the candidate, and the first
  observation after a pause credits no time;
- a candidate older than 10 s, or one that cannot complete, expires into `phase:'expired'`,
  `reason:'slow'` and a recovery stage — it never stalls at a frozen fraction;
- storage is a bounded ring (64), while sample count and spread are tracked incrementally, so the
  candidate cost is constant for a 10 s window.

### Measured behaviour

Stable synthetic standing body, first observation at t=0. Reproduced with the committed defaults.

| Observation rate | Outcome | Completes/expires at | Samples | Credited ms |
| --- | --- | --- | --- | --- |
| 20 Hz | completes | 2500 ms | 51 | 2500 |
| 14 Hz | completes | 2571 ms | 37 | 2571 |
| 10 Hz | completes | 2900 ms | 30 | 2900 |
| 8 Hz | completes | 3625 ms | 30 | 3625 |
| 6 Hz | completes | 4833 ms | 30 | 4833 |
| 4 Hz | completes | 7250 ms | 30 | 7250 |
| 3 Hz | completes | 9667 ms | 30 | 7250 |
| 2.5 Hz | expires | 10400 ms | 27 | 6500 |
| 2 Hz | expires | 10500 ms | 22 | 5250 |
| 1 Hz | expires | 11000 ms | 12 | 2750 |

The supported floor is therefore about **3 Hz**, set by 30 samples at 333 ms spacing (9.67 s of a
10 s budget). For scale: the app posts at most one frame per 70 ms (14.3 Hz ceiling), so the floor
leaves wide margin for GPU-fallback devices while still guaranteeing that a genuinely unusable stream
ends in an explicit recovery state. 6, 8 and 9 Hz — which could never complete under the legacy
window — now complete.

Time credited by one interval, measured directly:

| Observed gap | Credited |
| --- | --- |
| 17 ms | 17 ms |
| 100 ms | 100 ms |
| 250 ms | 250 ms |
| 400 ms | 250 ms |
| 600 ms | 250 ms |

### One behaviour corrected during implementation

The first implementation applied the 600 ms interruption tolerance to *every* gap between accepted
observations. At 1 Hz that reset the candidate on every observation, so progress sat permanently at
zero — the exact failure the adapter exists to remove, reintroduced by the tolerance. The tolerance
now applies only to recovery from **known invalid observations** (`wasPaused`); a slow but continuous
stream accumulates capped credit and is caught by the candidate age bound instead. Both cases are
covered by tests (`a slow but continuous stream is not treated as an interruption`,
`an interruption beyond the tolerance discards the candidate`).

## `assessStanding` hardening

Before: short arrays threw `TypeError`, and non-finite coordinates or confidence became *eligible* —
a `NaN` ankle still produced `ok:true` and could lock a calibration.

Now:

| Input | Before | After |
| --- | --- | --- |
| short / missing array | threw | `reason:'invalid'`, `detail:'malformed_landmarks'` |
| empty arrays / `null` | `no_person` message | `reason:'no_person'` |
| `NaN` coordinate, depth or visibility | treated as eligible | `reason:'invalid'` |
| `Infinity` coordinate | rejected incidentally | `reason:'invalid'` |
| core landmark below 0.65 visibility | `occluded` | `reason:'occluded'` |
| outside the source margins | `out_of_frame` | `reason:'out_of_frame'` + which `edge` |
| bent legs / not facing the camera | `not_standing` | `reason:'not_standing'` + `detail` |
| crown clipped at the top of frame | "step a little closer" | `reason:'out_of_frame'`, `edge.top`, "step back" |
| body shorter than 32% or taller than 94% | one message, "closer" for both | `too_small` / `too_large`, direction per reason |

Correction direction now follows the structured reason: `too_small` is the only reason that says
"move closer", and a cropped head or oversized body says "step back". `web/tests/pose.test.mjs`
asserts this, and that a `NaN` pose neither locks the legacy estimator nor throws.

## Test inventory

`apps/web` (90 tests, all passing; was 50):

- estimator (17): completion at 4/6/8/10/14 Hz, the 3 Hz floor, expiry at 1/2/2.5 Hz, duplicate and
  out-of-order rejection, non-finite timestamps, pause without evidence or credit, resume without
  crediting the gap, interruption reset, posture-change reset, completion never on an invalid
  observation, monotonic progress, bounded storage, controller-driven expiry, reset with preserved
  timestamp ordering, malformed landmarks, low confidence, wrist occlusion not resetting measurement,
  and a side-by-side check that the legacy class still resets where it always did.
- controller (23): full run with single-use handoff and five-second countdown, prepare→handoff action
  gating, 500 ms dwell, dwell reset on an ineligible frame, structured issues, stale/duplicate/
  out-of-order/foreign/non-finite rejection, loss at 99% progress then reacquisition, terminal
  cancellation, minimum ready display, announcement timeout, repeated completion events,
  StrictMode-style duplicate lifecycle events, source change invalidating calibration, requirements
  and the pending handoff, same-source re-report being a no-op, rear-camera preflight and
  confirmation, paired-display alternative, requirements recheck before handoff, invalid frames
  during ready, setup-only handoff, sub-threshold rate recovery, camera failure/retry, help
  escalation, and handoff integrity.

`web` (33 tests, all passing): the existing pose suite plus four new malformed-input and
structural-reason tests.

`apps/web` type-check (`tsc --noEmit`) and production build (`vite build`) both pass.

## How to run

```
cd apps/web && npm test          # 90 tests
cd apps/web && npm run build     # tsc --noEmit && vite build
cd web && npm test               # 33 tests
```

## Not done in Phase A

- No UI, no overlay, no audio, no session integration. `PracticeSession.start()` still has no
  `secondsOverride` parameter and no duplicate-start guard; both are Phase D and are specified in the
  plan.
- `scripts/verify_camera_framing.py` already provides the mocked camera, pose worker and API routing
  that Phase B browser coverage will extend. Playwright is **not** currently installed in `.venv`
  (`ModuleNotFoundError: playwright`), so the harness needs `pip install playwright` plus
  `playwright install chromium` before it can run. This is a documented dependency, not yet
  exercised in this phase.
- Physical-device behaviour is unverified. No iPhone or Android device was available; those checks
  are outstanding.

## Outstanding risks carried into Phase B

- The 70% guide will often disagree with an accepted body (acceptance range is 32–94% of source
  height). The plan's one-time freeze at accepted proportions is what keeps that coherent; it needs
  the portrait-phone/landscape-camera layout spike before animation polish.
- `readyMinimumMs` (1 s) plus `readyAnnouncementTimeoutMs` (1.5 s) bounds the success stage, but the
  audible success prompt is untested — Phase C must prove that a rejected or missing announcement
  cannot hold the user past 1.5 s.
- The 3 Hz floor is arithmetic, not measured on a real CPU-fallback device.
