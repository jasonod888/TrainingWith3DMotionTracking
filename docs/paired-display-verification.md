# Paired practice display and wide camera — verification report

Date: 2 November 2026
Plan: [paired-display-and-wide-camera-implementation-plan.md](paired-display-and-wide-camera-implementation-plan.md)
Status: **implemented, automated checks passing, real-device evidence outstanding.**

This report is deliberately split into what has been *proved by automation* and
what has *not been tested*. No real phone, receiver or television was available
in the environment where this was built, so every device row below is marked
`untested`. Do not read the automated results as evidence of camera behaviour.

## 1. What was implemented

| Package | Result |
| --- | --- |
| A. Contracts | Presentation fields added to the snapshot and a negotiation generation added to signalling. Pydantic validation and the TypeScript types were changed together. No database migration: `snapshot` and `signals` are JSON columns. |
| B. Receiver layout | The inset preview was replaced by a measured comparison surface. 60/40 in landscape, stacked in portrait, camera pane takes the main area during positioning, contains the complete image, fullscreen action. |
| C. Camera policy | Acquisition and lens-selection policy extracted into `camera-policy.ts` and `camera-acquisition.ts`. One lifecycle owner remains in `MimicInterface`. |
| D. Switching and setup | Camera change is a source-generation switch: pause, release, reacquire, new calibration. Front/rear and wide preference live in the guided-setup preparation stage. |
| E. Receiver synchronisation | Media state is separate from pairing state. Setup feedback, guide geometry, track replacement and stop-sharing are handled. |
| F. Connectivity | Both peers build their connection from one `rtc-config.ts`; LAN-only milestone with explicit, actionable failure copy and structured room for TURN. |
| G. Verification | 129 frontend unit assertions across 12 files, 4 new API tests, full API suite green, typecheck clean. Device matrix below is untested. |

A second, smaller path was added after the first review: **presentation mode** for
screen mirroring, where the phone screen is the only display. It reuses the same
layout policy (`receiver-layout.ts`) and the same motion-envelope instructor fit,
but renders inside the phone document, so no second device, pairing, code or
network reliability question is involved. It is toggled from the practice tools or
from Connect display, and is covered by the layout/geometry unit tests only — the
mirrored picture itself has not been seen on a television.

New modules:

- `apps/web/src/camera-policy.ts` — requested vs actual camera state, label and
  wide-lens evidence, bounded acquisition plans, honest wording, preference
  persistence.
- `apps/web/src/camera-acquisition.ts` — the only place that calls
  `getUserMedia`, behind an injectable `CameraIO`.
- `apps/web/src/receiver-layout.ts` — viewport matrix, pane shares, setup
  takeover and receiver setup copy.
- `apps/web/src/receiver-media.ts` — `off | starting | live | interrupted |
  failed` reducer with the rule that only a decoded frame is live.
- `apps/web/src/rtc-config.ts` — one ICE configuration for both peers, retry
  backoff, and honest direct-only failure copy.

## 2. Automated results

| Check | Command | Result |
| --- | --- | --- |
| Frontend type check | `apps/web: npx tsc --noEmit -p tsconfig.json` | pass, no errors |
| Frontend unit tests | `node --experimental-strip-types tests/<file>.test.mjs` per file | 129 pass, 0 fail (12 files) |
| New camera policy tests | `tests/camera-policy.test.mjs` | 17 pass |
| New acquisition tests | `tests/camera-acquisition.test.mjs` | 9 pass |
| New receiver layout tests | `tests/receiver-layout.test.mjs` | 10 pass |
| New receiver media tests | `tests/receiver-media.test.mjs` | 9 pass |
| New receiver geometry tests | `tests/receiver-geometry.test.mjs` | 7 pass |
| New transport config tests | `tests/rtc-config.test.mjs` | 4 pass |
| API pairing tests | `tests/api/test_mimic_pairing.py` | 8 pass (4 existing + 4 new) |
| Full API suite | `pytest tests/api -q` | 127 pass |

### Environment note

This machine's file sandbox blocks a Node program from spawning a child process
with piped stdio, so `tsx` (which starts an esbuild service child) and the
Node test runner's per-file child both fail with `spawn EPERM`. That is a
sandbox limitation, not a project failure. The tests were therefore executed
with Node's built-in type stripping, one file at a time, in-process.

Two consequences to know about:

- `npm test` in `apps/web` and `npm run build` (Vite) should be re-run once in a
  normal terminal to confirm the project's own scripts; they could not be run
  here.
- Four import specifiers carry explicit `.ts` extensions
  (`camera-acquisition.ts`, `camera-setup-controller.ts` ×2,
  `camera-setup-guide.ts`). `tsconfig.json` already enables
  `allowImportingTsExtensions`; the change is what lets the suite run without
  tsx. No other import style changed.

### What the automated tests actually cover

- **Label evidence**: localised labels, labels naming both directions, absent
  labels, and device-id text that *pretends* to be a lens are all handled; a
  device whose id is `ultrawide-0.5x` is not treated as evidence.
- **Ranking**: identical order for forward and reversed enumeration; no
  resolution or array-order input to the decision.
- **Bounded acquisition**: one discovery probe, one preferred device, one facing
  fallback; permission denial and a busy camera stop after a single attempt;
  peak simultaneously open streams is 1; a failed wide lens falls back and says
  so.
- **Same-dimension source change**: covered at the protocol level
  (`source_generation` is a separate counter) and in the local source identity
  (`SourceSession.generation`), not by a hardware test.
- **Geometry**: contain-fit for 16:9, 4:3, 21:9, square, portrait and zero-sized
  panes; corners stay inside the rendered rectangle; mirroring is a single flip
  about the rendered centre; the reconstructed guide stays inside the image for
  every pane shape.
- **Receiver state**: an incoming track, metadata or a `connected` transport
  never produce "live"; a stall immediately leaves live; track end and reset
  clear everything; an approved pairing with no media never reads as live.
- **Protocol**: new fields round-trip, older snapshots without them still work,
  and out-of-range or unknown values are rejected (`422`), including `NaN`
  progress, oversized hints and out-of-range guide geometry. Stale answers and
  superseded offers are rejected with `409`.

## 3. Real-device matrix — all untested

Fill this in per device. Separate results for rear access, actual wide-lens
access, switching, and receiver media are required because they fail
independently.

| Dimension | Row | Rear access | Wide lens reached | Switching | Receiver media | Render | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone Safari, iOS __ | | untested | untested | untested | untested | untested | |
| Android Chrome, __ | | untested | untested | untested | untested | untested | |
| Phone with physical ultrawide | | untested | untested | untested | n/a | n/a | |
| Phone/browser exposing one rear camera | | untested | untested | untested | n/a | n/a | |
| Single-camera / desktop fallback | | untested | n/a | untested | untested | untested | |
| Desktop Chrome/Edge receiver | n/a | n/a | n/a | untested | untested | untested | |
| Same receiver over HDMI to TV | n/a | n/a | n/a | untested | untested | untested | |
| Smart-TV browser, model __ | n/a | n/a | n/a | untested | untested | untested | conditional support |
| Same Wi-Fi, direct path | | | | | untested | | |
| Restricted path / forced relay | | | | | not in this milestone | | LAN-only |
| Interrupted and recovered connection | | | | | untested | | |

Display shapes to record on the receiver: 16:9, 16:10, 4:3, 21:9, portrait, and
a window resize plus a fullscreen round trip.

## 4. Acceptance criteria

| ID | Automated evidence | Still requires a device |
| --- | --- | --- |
| AC1 Independent presentation | — | yes: moving video and moving model at once |
| AC2 Aspect ratios | fit geometry for all five shapes; no overflow or stretch in the unit tests | yes: corner/edge markers in a real frame |
| AC3 Resize/fullscreen | layout recomputed from measured size; projection updated by `ResizeObserver` | yes: progress preserved, no recalibration |
| AC4 Front/rear | actual-vs-requested reporting; front never described as wide | yes: which lens actually opens |
| AC5 Wide supported | plan prefers a labelled wide device; explicit choice is the only "confirmed" claim | yes: visibly more room than the standard lens |
| AC6 Wide unavailable | "unavailable" only when labels exist; otherwise "not identified" | yes: wording matches the hardware |
| AC7 Full rear view | contain-fit; no digital crop in rear mode | yes: sideways movement stays visible |
| AC8 Switch | generation bump, calibration reset, pause, track replacement | yes: end-to-end on the phone |
| AC9 Same-dimension change | generation is the identity, not dimensions | yes: lens/zoom change at identical resolution |
| AC10 Rear setup from distance | receiver renders setup phase, hint, progress and outline | yes: complete it once without touching the phone |
| AC11 Sharing permission | sharing is an explicit state; a camera switch never enables it | yes: no track before approval |
| AC12 Interruptions | media states, denied/busy errors, stale display handling | yes: each listed failure |
| AC13 Existing session rules | switch pauses; competition interrupt path is the existing one | yes: recording finalised, run not merged |
| AC14 Synchronisation | generation-tagged signals; stale answers rejected | yes: control latency and convergence |
| AC15 Access and cleanup | existing API tests for roles, revocation, expiry, revision pinning | partly: workers, observers and timers |
| AC16 Sustained use | — | yes: 15 minutes with fps/latency/thermal notes |

## 5. Performance

Not measured. Proposed targets remain measurement goals for this milestone
rather than pass/fail thresholds: at least 24 displayed camera fps, 30 model
fps, phone-command-to-receiver within 500 ms, typical glass-to-glass below
300 ms on healthy local Wi-Fi.

Record for each primary pair: camera fps, model fps, command latency, glass-to-
glass delay, and any thermal throttling or repeated freezes. Repeated freezes,
unusable delay or an unstable 15-minute session are defects or unsupported
combinations — not acceptable results.

Presentation-latency compensation remains deferred until measurements show a
consistent offset. Nothing in scoring timestamps was changed.

## 6. Known limitations of this milestone

- **LAN-only.** No relay is configured. Same-Wi-Fi can still fail on networks
  that block device-to-device traffic, and the failure copy says so instead of
  promising it will work. See
  [paired-display-connectivity.md](paired-display-connectivity.md).
- **Receiver reload requires a new code.** The receiver revokes its pair when it
  leaves and the claim code is single-use. Expiry and cleanup do not depend on
  an unload request reaching the server.
- **Lens identification is heuristic.** There is no standard ultrawide selector.
  "Rear wide camera" is only claimed when a person chose a device the browser
  labels as wide. Everything else says "wide requested, not verified",
  "unavailable in this browser", or "lens type not identified".
- **A phone that exposes one logical rear camera cannot be made to reach a
  hidden physical lens.** That is a documented result, not a bug.
- **No remote composite mode.** The paired receiver uses separate panes; the
  existing local composite mode is unchanged.
- **No native Cast picker.** Browser pairing only, named "Practice display".
- **Presentation mode is a mirrored phone screen, not a second layout.** While it
  is on, the phone cannot show something different from the TV, the mirrored
  image carries the browser's own chrome, and mirroring latency is added on top
  of camera delivery. It is also untested on hardware.
- **The Mirror button cannot start mirroring.** There is no web API for AirPlay or
  Cast screen mirroring, so the button prepares the phone layout and names the
  operating-system step; it cannot detect whether a mirror is active.

## 7. Manual test script

1. Same account on both devices. Phone: open a lesson, Connect display, create a
   code.
2. Receiver: Use as practice display, enter the code.
3. Phone: approve the display **without** sharing the camera. Confirm the
   receiver shows no picture and never claims one is live.
4. Share the camera. Confirm the receiver says "Camera connecting…" and only
   then "Camera live".
5. Phone: Start practice. In the preparation stage choose Rear camera, leave
   Prefer wide view on, Start camera. Compare the reported result with the
   hardware.
6. Walk into position using only the receiver: outline, hint, progress,
   "Camera ready", countdown. Confirm practice starts once.
7. During practice, change the camera in Camera settings. Confirm: practice
   pauses, a take in progress is finalised, the receiver clears back to
   connecting, a new picture arrives, and setup is required again.
8. Repeat on a rear lens change that keeps the same resolution.
9. Resize the receiver window, rotate it, enter and leave fullscreen. Confirm
   the lesson does not restart and the phone does not recalibrate.
10. Stop sharing. Confirm the receiver clears. Start the camera again and
    confirm sharing did **not** resume.
11. Reload the receiver. Confirm it must re-pair and shows no stale picture.
12. Deny camera permission once; then occupy the camera with another app and
    try again. Confirm both produce actionable, different messages.
