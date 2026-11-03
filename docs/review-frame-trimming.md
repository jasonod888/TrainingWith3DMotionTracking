# Review and trim movement frames

The check screen is a single viewport on desktop and mobile. A single thumbnail filmstrip has draggable start/end handles and a separate playhead. Dragging and keyboard adjustment snap to reconstructed frames; arrow keys move one frame and Shift+arrow moves ten. Selection playback and the two main actions are always visible. On phones the global navigation yields its space to the preview; the back button remains visible. Review notes use a native modal dialog so they do not push the actions below the screen.

Looks good saves a changed range and accepts the new revision in one database transaction. Choosing another video opens the upload flow; adjusting an existing move opens the check screen.

Trimming preserves the original files. The new manifest has a shorter duration, clipped/rebased teaching sections, an accumulated animation_start offset, and the original animation_duration for validating avatar clips. source_start advances by the same amount. MotionStage samples the original animation at animation_start plus lesson time. Instructor video and preview use source_start. Motion comparison crops and rebases the original landmark timestamps. Frame boundaries use the manifest frame_rate (15 fps for existing conversions).

Verification:

- tests/api/test_trim.py checks ranges, repeated trims, acceptance, stale revisions and ownership.
- scripts/verify_move_check.py checks the built local app with isolated API fixtures at desktop, phone and landscape sizes, including saving and native dialog behavior. Run it with a Python installation containing Playwright while the app is on port 8001.

## Stable review camera

The 3D check screen preserves the complete model trajectory, including horizontal travel. Only the camera is fixed; no model translation is cancelled or filtered.

The camera fits all exported frames of the motion once, with a small body margin. Its eye and target stay fixed during playback and seeking. A viewport resize or explicit camera-angle change can refit the view. Manual orbit and zoom remain available with no inertial coasting on this screen.

`tests/engine/fixed-camera.test.ts` checks projection bounds, stationary camera controls. `scripts/verify_fixed_camera.py` checks the actual clip from `.local/camera-review` in Chrome by observing the static floor's camera matrix through seeking, playback, and manual orbit.
