# Phase 2 — Reusable practice integration checkpoint

Date: 30 October 2026. Status: **desktop implementation verified; physical-device and representative pose-quality acceptance remain open**.

The user confirmed both phones are available, then selected **“Leave phone testing for later.”** No certificate installation, firewall change, public tunnel or cloud resource was created. Deferral is not a passed device test. Phase 3 has not started.

## Implemented

- React practice imports the accepted MVP's unchanged calibration/pose, composite, hand-label and voice modules. Their regression suite still runs.
- One full skinned rig uses saved logical sections. Buttons, keyboard and voice share the deterministic playback controller; no mesh chopping or separate movement GLBs.
- Explicit camera activation, front/back selection, locked standing-height calibration, anatomical hand labels, skeleton overlay, approximate pose matching and stale/missing-feedback clearing.
- Responsive comparison/composite views, reference mirroring, opacity/position and inspection when the camera is off. Small screens default to composite when a source starts.
- Explicit voice activation with browser-speech disclosure; capability detection and button fallback. The MVP's tested four-command parser and lifecycle are reused.
- Background/exit cleanup stops camera, worker and voice. Late camera results are released after source changes.
- Private, revision-bound PostgreSQL resume position/speed/mode. Restore is paused; permissions and calibration do not restart. Section revision changes invalidate old resume state.
- Pinned MediaPipe 0.10.21 runtime and SHA-256-checked pose model prepared as local static files, including Docker builds. Personal media and GPU weights stay outside the CPU image.
- Clearly labelled recorded test runs the real worker without a camera. It freezes the instructor's standing frame for deterministic calibration, then plays the recording. This does not prove live-camera accuracy or a person holding still.
- Optional phone launcher accepts a device-trusted HTTPS certificate; see `phase-2-phone-checks.md`.

## Passed checks

| Check | Result |
| --- | --- |
| API/contracts/accounts/progress | 28 tests passed |
| Playback/source cleanup/synthetic GLB | 13 tests passed |
| Original MVP calibration, geometry, pose, voice, rig | 29 tests passed |
| Real PostgreSQL/S3 integration | 5 tests passed |
| Migration | 0003 applied locally |
| Source cleanup | Late camera resources released; repeated cleanup releases once; a failing cleanup does not skip other resources |
| Standing scale regression | Real synthetic skinned rig retains identical height/floor despite provisional anchor transforms during loading |
| Progress | Owner-only, bounded, revision-specific; persists across connections |
| Build/type check | Passed; deferred Three.js size warning remains |
| CPU image | Builds worker, pinned SDK, model and WASM without personal media |
| Packaged files | Worker/model 200; model checksum matched; WASM range returned expected bytes |
| Restart | Position, accounts, sessions, revisions and media survived service/application restart and fresh-client reopening |
| Real browser tracking | Recorded video completed calibration, displayed L/R labels and produced approximate feedback |
| Consecutive holds | Exactly 10.6 seconds, then exactly 12.5 seconds |
| Replay/pause/resume/back | Replay paused inside second section; resumed to its end; Back played first section forwards |
| View switch | Composite retained calibration; source-video mode disabled while compositing |
| Responsive browser | Composite and comparison fit at 320/360/390/768/1024/1440 CSS pixels with no unnamed icon buttons |
| Final completion/resume | Final Next held exactly at duration without wrapping; reopening restored paused position with camera off |
| Comparison shutdown | Recorded source paused and cleared; both reference L/R labels changed from visible to hidden |

75 automated tests passed. Ignored evidence lives under `.local/qa/phase-2-*`. Visual review caught and corrected an initial anchor-transform error in standing-height measurement; the real synthetic rig regression covers it. Similarity remains approximate pose comparison, not certified technique assessment.

## Open acceptance gate

Physical Android/iPhone camera and microphone permissions, rotation/backgrounding, real speech recognition, ten-minute sessions, and representative correct/incorrect human-pose comparisons remain unverified. Desktop viewport checks and fake-recognition tests do not satisfy these items. The user deferred phone tests; see `phase-2-phone-checks.md` for both devices.

Keep Phase 2 acceptance open under the original phase-by-phase testing rule. Resume the deferred checks before advancing, or record an explicit change to the gate. Hosting and pricing remain deferred independently.

References: [MediaPipe web pose](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [camera secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [browser speech](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
