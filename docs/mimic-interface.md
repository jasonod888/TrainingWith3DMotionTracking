# Reusable Mimic Interface

The user named the camera-and-movement experience **Mimic Interface** on 30 October 2026. Its implementation is `apps/web/src/MimicInterface.tsx`; `LessonWorkspace` hosts it for learning and keeps section editing outside it.

Inputs: a versioned `LessonManifest`, an externally supplied `Playback` instance, the `onCommand` callback, and a reference-rendering adapter. The interface owns each participant's camera/tracker/calibration/voice resources and releases them on exit. Buttons/keyboard and voice share the supplied playback controller. Pose functions and source-resource lifecycle are shared tested modules.

Ownership, invitations, publishing and future group membership belong to the API/container around this interface. The Mimic Interface does not decide who owns a lesson or implement instructor/student roles. Authorized owned/shared lessons use the same manifest contract and renderer. Progress persistence remains in its host, not a camera stream.

Future group experiences should mount this same component with a per-participant playback adapter. Room membership, instructor controls, shared clock synchronisation, reconnect policy and optional group summaries are separate services/adapters. They are not implemented merely by reusing the component. Each learner's calibration and camera permission remain local and independent; do not broadcast camera frames or calibration state by default.

Keep UI/tracking refinements in this single implementation. Do not fork camera, voice, calibration or pose scoring for sharing/group pages.
