# Live camera auto-framing and full-panel preview

Date: 2 November 2026
Status: developer implementation handoff. This document specifies the feature; no implementation is included.

## 1. Objective

Make the live front-camera preview use the full left camera panel in the desktop side-by-side practice screen, instead of appearing as a short landscape rectangle in its centre. Automatically position and, when safe, enlarge the displayed image to keep the practising person centred with their head, hands, and feet visible.

The priority order is:

1. Preserve all visible body parts and room for movement.
2. Keep the person comfortably centred with a stable view.
3. Fill the panel with live video whenever the first two requirements allow it.

Full-panel video is conditional: a narrow panel cannot always show the full width of a person extending both arms from a landscape camera image. If filling the panel would cut off the person, show more of the original image and allow unused space. Do not sacrifice body visibility to satisfy edge-to-edge filling.

Success is a larger, useful, smoothly framed practice preview, not a wider camera capture or a close-up of the person's face.

## 2. Scope and boundaries

Implement browser-side display auto-framing using the MediaPipe pose results already produced by the app. No additional detector, segmentation model, server processing, or camera upload is required.

Initial scope: live front camera in the `separate` camera/instructor layout, in both practice and compete. Use the same framing behavior in both modes; it has no scoring effect. Enable it by default in this supported layout, with a user control to turn it off.

Do not automatically enable this first version in `combined` layout, instructor-only/picture-in-picture layout, recorded-test mode, rear-camera mode, or the paired remote display. These continue to use their existing view. Treat future support for those layouts as separate work, especially because combined mode aligns a 3D instructor with the camera image.

Do not change camera capture constraints, physical lens/zoom settings, calibration measurements, pose inference inputs, scoring, saved recordings, recording export, or transmitted camera tracks. This feature transforms the local display only. Raw camera video remains the source for those existing functions.

Do not stretch the person, invent missing pixels, remove the background, or infer body parts outside the camera frame.

## 3. Current implementation and integration points

| Area | Current implementation | Required work |
| --- | --- | --- |
| Camera and pose handling | `apps/web/src/MimicInterface.tsx` | Add framing state/controller, apply display transform, and reset it with camera lifecycle |
| Pose worker | `apps/web/public/pose-worker.js` | Reuse existing landmarks and visibility; include the input frame timestamp in the main-thread message type and reject stale/out-of-order framing input |
| Panel layout and overlays | `apps/web/src/practice.css` | Let the video presentation surface span the full camera pane; clip image overflow and overlay UI |
| Workspace controls | `apps/web/src/PracticeWorkspace.tsx` and existing Camera setup panel | Add the Auto-frame control without adding a new top-level screen |
| Framing/reference rendering | `apps/web/src/practice-types.ts`, `apps/web/src/MotionStage.tsx` | Keep camera display state separate from physical calibration; check instructor apparent-scale behavior in separate layout |
| Current overlay helpers | `web/dist/pose.js` (`videoFit`), `web/dist/hand-labels.js` (`liveHandPositions`) | Existing helpers assume contained video; route this new preview through a shared crop-aware mapping without breaking other callers |

Prefer a small pure TypeScript module, such as `apps/web/src/camera-framing.ts`, for geometry, validation, and controller logic. Keep React responsible for lifecycle and controls. Avoid duplicating crop calculations in video, skeleton, and labels.

## 4. Required user experience

### Camera area

- The camera presentation surface occupies the complete left pane, from top to bottom and edge to edge, within the current workspace layout.
- Keep the existing title/back controls, YOU label, and guidance/status messages readable as overlays. Use restrained gradients or translucent backgrounds where necessary.
- Layout must not reserve large top or bottom rows that shrink the video back into the present rectangle. Keep the instructor pane and right-side controls at their existing sizes.
- Position guidance where it is least obstructive and account for its occupied area when framing the person. The goal is not merely to hide feet behind a large calibration card.
- If live video cannot cover the surface safely, retain the app's neutral background in uncovered areas. Do not add a second magnified video background or stretch the image.

### Control

Add **Auto-frame me** to the existing Camera setup controls, with helper text: “Keeps you centred while leaving room to move.”

- On: use the framing policy below when the current camera/layout is supported.
- Off: show the complete image using the existing contained fit, centred in the full pane. Keep the expanded pane layout.
- Preserve the preference during the current practice visit. Persistent cross-device settings are not required.
- In unsupported layouts/modes, explain that auto-framing applies to the front camera in side-by-side view, or hide the control there. Preserve the preference so returning to a supported view can restore it.

## 5. Framing policy

### Source coordinates and subject bounds

Use the original, unmirrored video dimensions and normalized pose landmarks as the canonical coordinate space. Never infer the crop from the already transformed DOM element.

1. Require a complete, finite pose result and sufficient visibility to establish reliable framing. Start with a landmark visibility threshold of 0.6, configurable in one place.
2. Build bounds using the visible body landmarks, including head/face landmarks, shoulders, elbows, wrists, hand/finger landmarks, hips, knees, ankles, heels, and foot tips. Do not frame only the torso or wrists.
3. Expand the bounds to include the head beyond face landmarks, clothing, and movement allowance. Initial tuning: add 15% of body-box width on each horizontal side and 10% of body-box height above and below, with a minimum allowance of 3% of the source dimension on each side. These are evaluation defaults, not claims of accurate person segmentation.
4. Reliable framing requires evidence of upper and lower body visibility, including feet. Low-visibility extremities, a partial body, bounds extending beyond the source, or landmarks close to a source edge are reasons to widen or fall back, not reasons to tighten the crop.
5. Detect source-edge risk before clipping padded bounds to the camera image. Clamping must not turn an incomplete body into a falsely valid full-body observation.

MediaPipe landmarks approximate the body; they do not precisely trace hair or loose clothing. Include those cases in visual review and increase padding if needed.

### Fill versus full-body visibility

Compute the crop using the measured pane aspect ratio and the unobstructed subject area between persistent UI overlays.

- Prefer a source crop matching the pane aspect ratio that contains the entire padded body bounds and stays within the camera image.
- Start with the least magnification needed to cover the pane. Do not zoom further just to make the person dominate it.
- Position that crop so the body is centred horizontally and vertically where feasible, respecting source boundaries and overlay clearance.
- If no such crop is possible, use the full original camera image with a contained fit. This is an intentional safe fallback, even though the video will not cover every pixel of the panel.
- Do not continue increasing magnification when the person approaches or crosses a camera boundary. Prompt “Step back so your whole body is visible” when appropriate, using the existing guidance system to avoid duplicate messages.

For example: a standing person with arms down may fit a portrait crop that fills the pane. When they extend both arms, the preview should widen, potentially returning to the complete landscape image. When their feet are outside the original image, the app should show that complete image and request repositioning; it cannot recover the missing feet.

### Stability and loss of tracking

Use elapsed time rather than frame counts for smoothing. Keep the following defaults together as named, adjustable parameters:

| Situation | Initial behavior |
| --- | --- |
| Camera starting / height calibration | Full-frame contained view; no automatic crop |
| Reliable full-body pose acquired | Require 500 ms of continuous good evidence before entering auto-framing |
| Small position changes | Ignore movement within a centre dead zone of approximately 5% of pane width/height |
| Recentring | Smooth over approximately 300 ms; avoid following every landmark fluctuation |
| Tighter crop | Require approximately 1 second of stable evidence, then ease over approximately 600 ms |
| Wider crop needed | React immediately; ease only while the displayed crop still contains the current reliable padded bounds |
| Movement would be clipped by smoothing | Override smoothing and expand immediately; visibility has priority over smoothness |
| Brief missing/invalid pose | Hold the last view for at most 300 ms, without tightening |
| Tracking absent/stale for 900 ms | Return to the complete contained image; existing tracking guidance remains authoritative |
| Person reappears | Wait for the same stable-acquisition gate before cropping again |

Retain a short recent envelope of reliable extremity positions, initially 1 second, so alternating punches or kicks do not repeatedly tighten and widen the view. Do not allow old positions to prevent eventual recentering indefinitely.

With missing or partially visible landmarks, never reduce the body envelope or zoom in. Only retain, widen, or fall back. Do not guarantee perfect prevention of clipping between tracking updates; movement must be tested at the app's actual tracking cadence.

The existing worker returns one pose. If it switches to a nearby person, this feature cannot establish identity from that fact alone. Treat abrupt implausible changes in centre or body scale as loss of framing evidence and fall back to full frame. Multi-person identity tracking is outside this version's scope.

## 6. One display transform for video and overlays

Define a single read-only display transform containing source dimensions, source crop rectangle, destination rectangle within the pane, scale, preview mirroring, and a version/source generation.

Every visual element attached to the person must use that same transform:

- Video presentation.
- Pose skeleton and joint dots.
- Left/right hand labels and any calibration guides anchored to body coordinates.

Mapping order: convert normalized source coordinates to source pixels, subtract crop origin, map into the destination rectangle, then mirror once within that rectangle if selfie preview is enabled. Apply the corresponding operation to the video. Avoid separately mirroring landmark coordinates and a parent containing those landmarks.

Keep text upright and anatomical L/R labels correct. Clip source-anchored graphics at the pane boundary. Fixed UI labels, headers, controls, and guidance do not move with the camera crop.

Use explicit geometry rather than combining an independently calculated `object-fit: cover`, a CSS zoom, and unrelated overlay coordinates. If animating the transform, video and graphics must consume the same interpolated value on each rendered frame. Update canvas backing dimensions for device pixel ratio while using CSS-pixel coordinates for geometry.

## 7. Calibration, inference, and lifecycle safeguards

- Always send the full original camera image to `createImageBitmap` / the pose worker. Do not crop or mirror inference input as part of this feature.
- Keep height matching based on original source coordinates. Automatic display zoom must not trigger repeated calibration, alter stored body height, or change scores.
- Check whether separate-layout instructor scale depends on the camera's displayed scale. If adaptation is needed, derive it from the shared display transform without mutating physical calibration or the instructor pose. Combined-mode alignment remains unchanged.
- Manual calibration restart temporarily returns to full frame. Reacquire auto-framing after successful calibration.
- Reset controller history on camera restart/change, input dimension change, unsupported mode/layout entry, and source epoch change. Ignore delayed pose results from a previous source epoch.
- On pane resize, orientation change, fullscreen, or browser viewport changes, recompute valid geometry from source-space bounds. Never reuse pixel offsets calculated for an old pane size.
- If a resize changes only presentation size, do not request camera access again or recalibrate physical body height. Retain the current behavior when the actual camera image dimensions change.
- Stop animation/observers on unmount and camera shutdown. Follow existing background-tab camera suspension behavior.
- Do not change scoring validity because of auto-framing alone. Existing tracking/scoring rules remain authoritative.

## 8. Performance and implementation sequence

Reuse the existing pose worker cadence. Geometry is inexpensive and requires no additional AI inference. Use refs or a small controller to interpolate visual state; avoid causing the full practice workspace to rerender on every animation frame. Prefer the existing video element with a clipped presentation wrapper and a shared transform; do not add a second video decode pipeline or a full-frame canvas copy unless measurement demonstrates it is necessary.

Implementation order:

1. Add pure geometry/controller helpers and meaningful tests for aspect ratios, padded bounds, mirroring, fallback, timing, and reset behavior.
2. Expand the camera presentation surface and move existing fixed UI into overlays. Verify the full-frame view before adding auto-framing.
3. Integrate the controller with existing full-image pose results, source epochs, and calibration state.
4. Replace the contained-fit assumptions for this preview's skeleton and hand-label positioning with the shared transform.
5. Add the Camera setup toggle and lifecycle/resizing behavior.
6. Verify the supported desktop/landscape flow and all fallback layouts. Tune padding and timings against realistic movement, then document any limits.

Do not combine this feature with the separate uploaded-video silhouette project.

## 9. Acceptance criteria

| Test | Required result |
| --- | --- |
| Screenshot's desktop side-by-side layout | The camera surface occupies the whole left pane; header and guidance are overlaid instead of reserving large empty rows |
| Fully visible standing person, compatible crop | Video covers the pane and the padded body remains visible |
| Person moves left/right or steps toward/away | View recentres smoothly without chasing normal landmark jitter |
| Both arms extended / wide stance / kick | View widens promptly; if a fill crop cannot contain the body, the full original image is shown |
| Person initially seated close to the camera | No face/torso zoom-in; full-frame view and appropriate full-body guidance |
| Feet or hands leave original camera frame | No invented recovery or further zoom-in; full-frame fallback and existing visibility guidance |
| Brief occlusion or noisy landmarks | No rapid zoom pumping or extreme crop jump |
| Sustained tracking loss | Full-frame fallback by the configured 900 ms threshold; no stale close-up indefinitely |
| Selfie preview on/off | Video, skeleton, and hand labels agree spatially and mirror exactly once |
| Static overlay alignment | Synthetic geometry tests map all points exactly; at least five paused manual checkpoints show no systematic offset, with a target below 5 CSS pixels |
| Calibration | Full-frame during height matching; display zoom does not change calibration values or scoring inputs |
| Window resize, phone rotation, fullscreen | Correct new crop and aligned overlays with no stretching, overflow, or camera permission restart |
| Auto-frame off | Complete source image remains visible inside the expanded pane |
| Combined / instructor-only / recorded-test / rear-camera views | Existing framing and alignment continue to work; auto-framing remains inactive |
| Recording and paired display | Continue receiving the original camera stream; local cropping does not change their output |
| Privacy and performance | No new camera-network traffic or inference model; no new overlapping tracking requests; responsive controls |

Run the frontend build and relevant geometry/controller tests. Use a deterministic recorded pose sequence to test motion and loss/reacquisition, plus actual camera testing for a standing pose, punches, kicks, turns, and floor-level movement. Include a desktop webcam, Android Chrome, and iPhone Safari where available; record any unavailable physical-device checks explicitly rather than claiming them passed.

## 10. Developer deliverable

Deliver the working local display feature, tests, and brief verification notes. Include before/after screenshots of the same desktop layout, an example where safe filling succeeds, and an example where full-body fallback intentionally leaves space. List the final tuning values and any remaining device limitations.

Completion means the preview makes effective use of the left pane and follows the person without letting panel filling override body visibility. It does not require a wider camera lens, a silhouette, or changes to motion assessment.
