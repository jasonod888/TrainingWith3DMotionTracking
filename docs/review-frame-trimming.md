# Review and trim movement frames

The check screen opens on the segmented instructor video when available, with a toggle to review the same paused frame in 3D. The toggle never changes the selected range. A single thumbnail filmstrip uses that same instructor video and has draggable start/end handles and a separate playhead. The screen explicitly says **Trim both views**: there is one trim for the 3D animation, segmented video and its limb markers. Original-video and 3D-only fallbacks remain available when processed footage is missing.

The check screen is a single viewport on desktop and mobile. Dragging and keyboard adjustment snap to reconstructed frames; arrow keys move one frame and Shift+arrow moves ten. Selection playback and the two main actions are always visible. On phones the global navigation yields its space to the preview; the back button remains visible. Review notes use a native modal dialog so they do not push the actions below the screen.

Looks good saves a changed range and accepts the new revision in one database transaction. Choosing another video opens the upload flow; adjusting an existing move opens the check screen.

Trimming preserves the stored files. The new manifest has a shorter duration, clipped/rebased teaching sections, an accumulated animation_start offset, and the original animation_duration for validating avatar clips. source_start and an explicit focused_video_start advance by the identical selected frame count. A missing focused_video_start retains the older source_start behavior. This allows an instructor clip starting at zero to stay aligned with a wide source whose movement starts later. Repeated trims accumulate all offsets together.

`lesson-clock.ts` maps lesson time to one reconstructed frame at the manifest frame_rate. Animation sampling, paused-video seeks, filmstrip thumbnails and trim handles use that frame grid. With both demonstrations visible, 3D samples the actual instructor video's clock and holds its pose while that video seeks. Marker positions already follow the decoded video clock. Motion comparison crops and rebases the original landmark timestamps.

The older Taegeuk demo is prepared by selecting the exact original decoded frame indices stored by reconstruction. Those selected images and the existing 3D pose samples are placed on the same 15 fps clock; pose values are preserved. Its segmented video starts at zero while its wide source retains its original source_start. The previous independent full-video resampling is no longer used.

Verification:

- tests/api/test_trim.py checks ranges, repeated trims, acceptance, stale revisions and ownership.
- scripts/verify_move_check.py checks the built local app with isolated API fixtures at desktop, phone and landscape sizes, including saving and native dialog behavior. Run it with a Python installation containing Playwright while the app is on port 8001.

## Stable review camera

The 3D check screen preserves the complete model trajectory, including horizontal travel. Only the camera is fixed; no model translation is cancelled or filtered.

The camera fits all exported frames of the motion once, with a small body margin. Its eye and target stay fixed during playback and seeking. A viewport resize or explicit camera-angle change can refit the view. Manual orbit and zoom remain available with no inertial coasting on this screen.

`tests/engine/fixed-camera.test.ts` checks projection bounds, stationary camera controls. `scripts/verify_fixed_camera.py` checks the actual clip from `.local/camera-review` in Chrome by observing the static floor's camera matrix through seeking, playback, and manual orbit.
