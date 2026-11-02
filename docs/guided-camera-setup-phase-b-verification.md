# Guided camera setup — Phase B implementation and verification

Date: 2 November 2026
Specification: [guided-camera-setup-implementation-plan.md](guided-camera-setup-implementation-plan.md)
Phase A: [guided-camera-setup-phase-a-verification.md](guided-camera-setup-phase-a-verification.md)

Phase B is the silent visual flow with the setup surface reachable from the normal entry points.
There is no audio yet (Phase C) and no separate countdown (Phase D reuses `PracticeSession`).

## What changed

- `apps/web/src/camera-setup-guide.ts` — source-space guide geometry: instructional box, mirror-aware
  rect mapping through the shared `DisplayTransform`, region anchors, frozen-outline conversion and
  margin measurement.
- `apps/web/src/CameraSetup.tsx` — the setup surface: prepare, starting, positioning, measuring,
  ready, and help/error. Geometry and the progress fill are positioned in an animation loop from
  `MimicInterface`'s live transform; React only re-renders on coarse state changes.
- `apps/web/src/practice.css` — `.is-setting-up` shell state (hides header, context, dock, gradients
  and canvas), promotes the existing camera pane to a full-viewport layer, and styles the surface,
  portrait-phone layout and reduced-motion path.
- `apps/web/src/MimicInterface.tsx` — delivers setup observations, resolves the source identity,
  reports camera/source failures, keeps auto-framing and legacy calibration off during setup,
  stops drawing the skeleton and hand labels, adds `applyCalibration`, `confirmControls`, `transform`,
  `sourceIdentity` and `facing` to the handle, and removes the transient `voiceState` term from the
  rear-camera readiness rule (D5).
- `apps/web/src/camera-setup-controller.ts` — coarse change subscription, `source_resolved` (so
  dimensions settling is not treated as a configuration change), and the accepted body bounds
  captured once for the frozen outline.
- `apps/web/src/PracticeWorkspace.tsx` — entry intents, overlay rendering, `inert` workspace,
  exactly-once handoff, and the setup-active gate over keyboard, transport, remote actions and panels.
- `packages/learning-engine/practice-session.ts` — `start(secondsOverride?)` and a duplicate-start
  guard.
- `apps/web/tests/camera-setup-guide.test.mjs` — 8 geometry tests.

## How the flow runs now

| Entry | Behaviour |
| --- | --- |
| **Start practice** (camera off) | Opens the prepare card with intent `start_practice`. The camera is not started and no attempt exists. |
| **Start scored run** / **Prepare to compete** (camera off) | Opens the card with intent `start_compete`. `CompetitionSession.start()` is not called during setup. |
| **Camera setup** (compete) and **Match height again** (practice panel) | Intent `setup_only`; pauses first, returns to a paused workspace with "Camera ready. Choose Play when you are ready." |

The primary action records the intent, then starts the camera (or reuses a live one). Positioning
shows the fixed 70% outline, the single highest-priority correction, and a head/hands/feet checklist.
Acceptance freezes the outline to the accepted body bounds and starts measurement with a progress
fill driven by credited observations. Success shows the checkmark and **Camera ready**, then handoff:

- `start_practice` → `session.start(5)`, i.e. a five-second countdown even when the user's count-in
  preference is zero, without modifying that preference;
- `start_compete` → `competition.start()` (which already configures five seconds);
- `setup_only` → paused workspace, no playback.

The handoff is a consumed token: `consumeHandoff()` returns a payload once, and the workspace
re-checks `handoff.pending` before applying it, so duplicate completion events and re-renders cannot
start a second countdown.

## Layout decisions

The camera pane is **moved**, not remounted: it is promoted to `position:fixed; inset:0` while the
rest of the workspace is hidden and `inert`. That keeps one `<video>`, one pose worker and one warm
instructor, which is what D8 is protecting, without a second decode pipeline or a second transform.

The guide is mapped through the same `DisplayTransform` used for the video, so it cannot cross into
the letterbox. For a landscape source on a portrait phone the contained image leaves large top and
bottom bands; the instruction sits in the top band and the checklist in the bottom band rather than
cropping the image. No orientation is forced.

## Verification

- `apps/web` type-check (`tsc --noEmit`) passes; production build (`vite build`) passes.
- `apps/web` tests: **100 passing** (was 90; +8 guide geometry, +2 session override/guard).
- Guide geometry is tested for landscape-in-portrait, five source aspect ratios at three horizontal
  centres, mirroring, region containment, frozen-outline conversion and degenerate transforms.
- Session tests cover the one-start override (including `start(0)`), preservation of the configured
  preference, and duplicate starts not restarting a countdown or minting an attempt.

### Entry and startup time

Two follow-ups from device testing (D14, D15):

- The preparation card is gone. **Start practice**, **Start scored run** and **Match height again** record the
  intent and go straight to `starting`, then positioning. The five-second disclosure moved to the
  **Camera ready** screen ("Practice starts in five seconds."), and the rear-camera confirmation is
  the inline card shown when requirements block measurement. The controller still defines the
  `prepare` stage; nothing enters it in this flow.
- The first camera start used to pay for the pose model and WASM: `pose_landmarker_lite.task` is
  5.51 MB, `vision_wasm_internal.wasm` is 9.13 MB, and the total under `public/tracking` is
  24.2 MB (the SIMD and non-SIMD variants both ship, but only one is fetched). The worker is now
  created and initialised 700 ms after the practice screen opens, kept alive, adopted by the first
  camera start, and re-warmed after `stop()` so later starts in the same visit do not re-initialise.
  Adoption sets readiness synchronously, because the warmed worker's `ready` message was already
  consumed by the warm-up handler — waiting for a second one would hang the first session.

### Operator switch (temporary)

`CAMERA_CALIBRATION_ENABLED=false` on the API (default `true`) advertises
`camera_calibration: false` from `/api/capabilities`. The client reads it once at boot in
`camera-setup-policy.ts` and defaults to **enabled** for a missing field, an older server, a failed
request or a malformed payload, so the bypass cannot appear by accident.

With it off:

- **Start practice**, **Start scored run** and **Match height again** start the camera and skip both the
  preparation and positioning surfaces.
- `MimicInterface` applies `DEFAULT_CALIBRATION` (`height .7, floor .9, centre .5`) instead of running
  `beginCalibration()`, so the instructor, readiness and pose comparison behave as if setup succeeded.
- `configuration()` appends `calibration=default`, so an attempt recorded in this mode is
  distinguishable from a real one.
- The camera panel hides **Match height again** and states that height matching is off.
- Nothing claims a height match: the status line reads "Default alignment · height matching off".

Because pose comparison never consumed the calibration, turning this switch off changes only the
instructor's scale and floor, never a score. It is a testing aid: remove it rather than keeping two
paths once setup is verified on the target devices.

### Landscape

The surface was portrait-shaped in two concrete ways, both fixed:

- The overlay and the promoted camera pane used `inset:0`, which is the *layout* viewport. On a phone
  the URL bar changes the visible area, so the bottom of the surface sat behind browser chrome —
  worst in landscape, where the bar takes a large share of a short viewport. Both now use
  `top:var(--practice-top)` / `height:var(--practice-height)`, the same visual-viewport box the rest
  of the app already tracks. The pane and the overlay must stay on that identical box or the guide
  would not align with the video.
- The chrome was sized for a tall screen. In landscape a landscape source fills the full height, so
  there are no letterbox bands and the top and bottom bars covered the guide's head and feet. A
  `max-height:520px` layout now keeps a single-line instruction in the strip above the figure and a
  compact checklist/progress/cancel row in the strip below it, with a stricter `max-height:380px`
  variant. `camera-setup-guide.test.mjs` pins the assumption: at 320/360/390/430 px viewport heights
  the head anchor stays below 48 px and the feet anchor above `height − 52 px`.

**The silhouette does not rotate, and must not.** A standing person is taller than wide in a
correctly oriented frame, so the figure is always portrait-shaped relative to the video, whichever way
the phone is held. If the *camera image* appears rotated when the device turns — the person lying on
their side while the figure stands upright — that is a source-orientation bug in the stream, not a
layout one, and it cannot be fixed in CSS: the frame's coordinate space has to be rotated before
mapping, which affects the guide, the pose overlay and the auto-framing crop together. Not attempted
yet; it needs the device and browser confirmed first.



- **No browser run of this flow yet.** The surface, overlay CSS, `inert` behaviour and the
  observation wiring are build-verified and unit-tested but have not been executed in a browser in
  this session. Playwright is still not installed in `.venv`, so
  `scripts/verify_camera_framing.py` and any new browser assertions were not run.
- **Landscape was not observed on a device.** The layout is derived from the measured geometry, and
  the chrome-strip clearance is now pinned by a test, but nobody has held a phone sideways in front
  of this build. Rotation of the source itself is unresolved (see above).
- **No physical-device check.** The portrait-phone layout was designed from the measured geometry
  (a 16:9 source in a 390×844 pane leaves ~300 px of usable bands), not observed on a device.
- Auto-framing reacquisition immediately after handoff is covered by the existing auto-framing
  scripts, which were not re-run.
- The five-second countdown, compete result and recording paths are inherited unchanged but were not
  re-exercised end to end.

## Known gaps carried into Phases C–D

- Spoken guidance, the tone fallback and the success-announcement callback do not exist yet; the
  workspace reports the announcement complete at the 1 s minimum so the silent flow cannot stall.
  Phase C must replace that with real playback and must prove a failed announcement still hands off.
- `requiresConfirmation` is passed to the surface but unused; the checkbox state comes from
  `snapshot.requirements`. Remove or use it when the rear-camera copy is finalised.
- The prepare card always renders for the practice entry, so a user who only wants to watch still sees
  one extra confirm step compared with the old single press. That is the intended trade in D10, but
  it should be reviewed against the watch-only path.
