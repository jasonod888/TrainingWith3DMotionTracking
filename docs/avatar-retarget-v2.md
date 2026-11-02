# MHR to Mixamo retargeting, version 2

The canonical MHR animation and scoring landmarks remain the source. New worker
conversions produce version 2 avatar derivatives. Existing derivatives must be
rebuilt; a new web bundle alone cannot repair an already baked animation.

## Changes

- Hands measure motion relative to the mapped forearm, including `wrist_twist`.
- Captured finger motion is the default. Three phalanges are animated, intermediate
  thumb/pinky metacarpals are included, and fingertip endpoints keep their rest
  transforms. Explicit `relaxed` and `none` diagnostic modes remain available.
- World rotations are recomposed after every local rotation, including relative
  hands and toes. Diagonal travel uses the same Euclidean norm on both rigs.
- Two-bone leg placement follows source ankle displacement, preserves target bone
  lengths and foot orientation, and reports unreachable positions. Its source
  neutral baseline uses the captured subject's translation/scale tracks, rather
  than MHR's generic bind-body lengths. It does not infer a world floor or certify
  sole contact from camera-relative motion.
- Source rotation jumps include frame/time information, including the first
  transition. They remain visible rather than silently modifying captured action.
- Camera following translates the camera and orbit target together.

## Comparison lab

The lab uses the same regenerated avatar assets as the lesson viewer. It shows
conversion version, captured/static hand mode, ankle-placement residuals, source
warnings, and per-frame elbow/knee angle differences. `Next source jump` seeks to
reported jumps. Pinning uses the pelvis on both rigs. Scrubbing reads the requested
time before updating controls; frame stepping follows actual source timestamps;
seeking back from the clip end re-enables the clamped actions.
Both bodies use continuous interpolation during presentation. Native MHR files
export STEP samplers while converted files use LINEAR; displaying those unchanged
caused subframe disagreement even when source keyframes matched. Shared sampling
keeps the stored samples/timestamps untouched and makes playback consistent in
the comparison lab and lesson viewer.

To refresh the local demo without repeating video inference:

```powershell
.venv-saas/Scripts/python.exe scripts/refresh_demo_avatars.py
npm.cmd --prefix apps/web run build
```

The refresh script validates both clips first and retains the previous derivatives
under `.local/avatar-refresh/`. The API serves the demo report at
`/api/demo/assets/avatar-report.json`; restart the API after updating that route.

The original source and landmarks are untouched. Older saved projects continue to
use their existing derivatives until regenerated; the lab identifies old reports
instead of presenting them as version 2.

## Verification

- Self-contained regression fixtures cover wrist twist propagation into the hand
  and fingers, independent finger movement, diagonal travel, the initial rotation
  transition, subject proportions, and analytic leg reach with fixed lengths.
- The existing avatar tests cover timing, neutral mapping, deterministic bytes,
  export/reload, and source/report failures.
- `python scripts/verify_avatar_lab.py` checks both demo avatars, scrubbing,
  source frame stepping, seeking back from the end, side views, source-jump
  navigation, unpinned playback, and compact layout against the served app.

Source jitter, camera trajectory drift, missing/incorrect inferred finger poses,
and unreachable poses cannot be certified away by retargeting. They are explicitly
reported so the lab can distinguish them from conversion errors.
