# Reusable Mimic Interface

The user named the camera-and-movement experience **Mimic Interface** on 30 October 2026. Its implementation is `apps/web/src/MimicInterface.tsx`; `LessonWorkspace` hosts it for learning and keeps section editing outside it.

Inputs: a versioned `LessonManifest`, an externally supplied `Playback` instance, the `onCommand` callback, and a reference-rendering adapter. The interface owns each participant's camera/tracker/calibration/voice resources and releases them on exit. Buttons/keyboard and voice share the supplied playback controller. Pose functions and source-resource lifecycle are shared tested modules.

Ownership, invitations, publishing and future group membership belong to the API/container around this interface. The Mimic Interface does not decide who owns a lesson or implement instructor/student roles. Authorized owned/shared lessons use the same manifest contract and renderer. Progress persistence remains in its host, not a camera stream.

Future group experiences should mount this same component with a per-participant playback adapter. Room membership, instructor controls, shared clock synchronisation, reconnect policy and optional group summaries are separate services/adapters. They are not implemented merely by reusing the component. Each learner's calibration and camera permission remain local and independent; do not broadcast camera frames or calibration state by default.

Keep UI/tracking refinements in this single implementation. Do not fork camera, voice, calibration or pose scoring for sharing/group pages.

## Practice upgrade — 30 October 2026

`PracticeWorkspace` now supplies the viewport shell, persistent transport, bounded dialogs, setup choices, local recording/replay and optional attempt summaries. `PracticeSession` wraps the existing `Playback` for countdowns, temporary ranges, repeats/rest and attempt transitions. Camera and voice still belong to the single `MimicInterface`; section editing stays in `LessonWorkspace`.

`MimicReceiver` is a second display for one learner, not a multi-learner room. The camera device remains authoritative. Both devices sign into the same account, claim a temporary code, and obtain capture-device approval. Database-backed polling carries state and ordered, acknowledged controls; a separate optional WebRTC connection carries video only after explicit activation. Lesson authorization/revision is checked on every pairing request. No public lesson link is created by pairing.

Migrations `0007` and `0008` add scoped display sessions and opt-in personal summaries. Camera frames and recordings are not stored by these APIs. See `mimic-upgrade-verification.md` for implementation status, limits and outstanding device gates. See `mimic-implementation-plan.md` for the broader phased scope; its physical-device and coaching-quality gates remain open.
