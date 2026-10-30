# Mimic Interface: competitor review and recommended direction

Reviewed 30 October 2026. This is an assessment and proposed roadmap, not an implementation change.

## Evidence and limits

Reviewed the public pages of [CyberDance](https://app.cyberdance.org.il/), [HitReg](https://hitreg.live/), and [DanceBuddy](https://www.dancebuddy.ai/). Opened CyberDance's working sample lesson and practice-entry dialog. HitReg's Get Started leads to a magic-link/Google sign-in screen; DanceBuddy's journey leads to email/password/Google sign-in. Their authenticated practice flows were not tested. Public descriptions establish advertised scope, not tracking accuracy, mobile usability, or working feature quality. This is the observable feature inventory, not a claim to know every private feature.

For our app, inspected the current SaaS source, shared pose/voice modules, and verification records. The older prototype is separate and is not counted as shipping functionality in the current interface. No local app server was listening on the usual 5173/8001/8010 ports during review. This is a source-based assessment of our app, not a new live-device test. Existing verification records explicitly leave physical Android/iPhone acceptance open.

## What to learn from each competitor

- **CyberDance:** its sample visibly offers named short steps, video with skeleton, direct speed buttons, and a guided invitation to try a short step. Practice entry separates free mirror practice, a local trial recording, and an analyzed take. Public descriptions also cover link/file ingestion, counts, voice cues, segment/range practice, multiple feedback dimensions, shareable takes, courses, and studio distribution. Its TV guidance describes screen mirroring; that does not establish a native casting or paired-device implementation. Most useful lesson: make the next practice action obvious and short. [Source](https://app.cyberdance.org.il/)
- **HitReg:** advertises original-video/rotatable-3D practice, live webcam tracking, DTW scoring, per-beat joint review, an accuracy-colored ghost, skeleton comparison, and slow playback. The public site calls itself barebones. Most useful idea: connect feedback to the exact moment and body part that needs work. Implementation quality remains unverified behind sign-in. [Source](https://hitreg.live/)
- **DanceBuddy:** advertises file/social-link input, eight-count segmentation, looping, mirroring, slow motion, AI technique/timing feedback, and progress tracking. Most useful idea: structure a dance around repeatable musical phrases. No public evidence inspected establishes a 3D instructor or the quality of its feedback. [Source](https://www.dancebuddy.ai/)

## What our current app actually has

| Capability | Current SaaS state | Recommended action |
| --- | --- | --- |
| Video to animated 3D lesson | File upload, trim, resumable upload, processing status and conversion pipeline | Keep; improve first successful lesson experience |
| Import a social/video URL | Not exposed in current creation flow | Later, after practice improvements; review platform access and processing costs |
| Original video / 3D reference | Both available; original disabled in combined camera/avatar mode | Keep a clear reference selector |
| Rotate / zoom instructor | Available when camera is off; orbit controls disabled during camera practice | Add explicit view presets and reset; define orientation semantics first |
| Live camera and pose tracking | Present; front/back camera selection | Keep camera optional and activation explicit |
| Height matching | Standing calibration, then locked scale | Retain; make readiness and recovery easier to understand |
| Compare views | Desktop side by side; combined camera/avatar option, mobile default | Keep; redesign mobile separate-view layout to avoid two tall stacked panels |
| Mirror and L/R guidance | Mirrored selfie, reference mirror option, anatomical hand labels | Add a simple explanation of mirror versus same-side following |
| Skeleton / ghost feedback | Live skeleton with some joint-error coloring; reference opacity and position | Existing combined view is not a validated anatomically aligned error ghost |
| Playback | Section holds, replay, previous/next, scrubber, full sequence | Strong basis; add countdown and repeat loop with rest |
| Speed | 0.5×, 0.75×, 1×; selector in settings | Expose as one obvious control; consider 0.25× and frame stepping |
| Choose a section in practice | Sequential navigation; full section list is in editor | Add a read-only section picker without requiring editing |
| Hands-free commands | Exact English next/back/again/pause; browser-dependent | Add start/resume and loop controls; keep buttons complete |
| Feedback | Smoothed approximate pose percentage and joint colors | Add coverage/confidence, one actionable cue, and attempt review |
| Timing / rhythm scoring | No independent timing score | Build and validate separately from pose matching |
| Practice history | Saves position, speed, mode; teacher activity summaries | Add optional attempt history and useful improvement trends |
| Learner recording | No learner attempt recording/replay flow | Add optional local replay before cloud video storage |
| Audio / counts | Original reference is rendered muted; no music/count system in inspected flow | Optional count-in first; rhythm tools depend on lesson type |
| Fullscreen / keep awake | No practice-specific implementation found in inspected source | Add focus view, fullscreen where supported, active-session wake lock with fallback |
| Lesson editing and sharing | Split/merge/name sections, private lessons, published revisions and learner access | Retain; competitors are not a reason to rebuild this |
| Courses, marketplace, synchronized rooms | Not implemented | Defer until practice quality and actual demand justify them |

Primary implementation evidence: `apps/web/src/MimicInterface.tsx`, `LessonWorkspace.tsx`, `MotionStage.tsx`, `style.css`, `CreateLesson.tsx`; `packages/learning-engine/playback.ts`; `web/dist/pose.js` and `voice.js`; `docs/phase-2-phone-checks.md` and `phase-4-verification.md`.

## Recommended practice experience

The product target should be: **choose a move, get into position, follow it, repeat it, and understand one useful correction without managing a dashboard.**

Use three lightweight stages: Watch, Practise, Review. These can be states of one screen rather than separate destinations. Watch needs no camera. Practise optionally adds the camera and readiness checks. Review appears after a deliberate attempt, with Repeat and Next as the obvious actions. Free practice should remain possible without recording or scoring.

On a phone, give most of the available screen to one shared practice stage. Start with our existing instructor-beside-user combined view as the candidate default, then validate visibility on actual phones. Offer an enlarged instructor-only view and a small self-preview alternative. Avoid forcing two full-body panels to stack above the controls. Keep previous, play/pause, repeat and next reachable in a bottom control strip. Speed is a simple chip; view and camera adjustments live in one sheet. Respect safe areas and preserve orientation changes without losing the lesson position.

On desktop, use matched-height learner/reference panels with a shared control strip. A collapsible section picker supports jumping directly to a difficult move. Keep the same names and interaction rules across devices. A focus mode removes app navigation during practice. Do not require device rotation or fullscreen support to make controls usable.

The essential controls are Play/Pause, Repeat, Next/Back, Speed and View. Camera can be an obvious entry action. Skeleton, opacity, camera choice, detailed score and voice configuration belong in the secondary sheet. Consolidate the current separate playback and camera settings entry points. Remove the developer-oriented Recorded test action from ordinary learner settings; retain it in a diagnostic surface.

## Priority 1: make practice effortless

1. **Ready check and countdown.** Show whole-body visibility and tracking readiness, then a configurable short count-in. Let the learner step away from the phone before motion begins. Keep immediate pause available; do not auto-start merely because a person enters the frame. Offer an optional opening-pose guide.
2. **Repeat this move.** Loop the current section or a temporary selected range, with an optional rest/countdown between repetitions. Never require editing the saved lesson to rehearse a smaller range. Keep the existing step-and-hold behavior as a choice. Apply loops consistently to buttons and voice.
3. **One-screen mobile practice.** Large stage, persistent controls, no hidden Next button below two panels. Add focus/fullscreen and active-session keep-awake where supported. Release resources and wake lock when practice stops or the page hides.
4. **View presets with clear following direction.** Front, back, left, right and reset are more discoverable than drag alone. Separate rotating the viewing camera from reflecting or rotating the target motion. Our score partly uses camera-coordinate limb directions, so rotating visuals alone can contradict feedback. Preserve or transform the scoring frame deliberately, and state when a view is for observation only.
5. **Reliable hands-free use.** Extend the existing voice vocabulary with start/resume and loop actions, show recognized commands briefly, and handle unsupported speech cleanly. Music and speech must be tested together. Voice is an enhancement, not a mobile prerequisite.

These are the first implementation package. They improve each practice session without expanding the product into a course platform.

## Priority 2: make feedback trustworthy and useful

The current score blends visible-joint angles and limb directions and picks the best nearby reference pose, tolerating roughly one second of learner delay during playback. It is an approximate similarity signal, not a percentage of technique correctness or a separate timing measurement. Some landmarks in the lesson contract have unmeasured reference confidence. A confident camera estimate does not prove that the reconstructed teacher motion is accurate.

Show tracking quality before interpreting performance. Low coverage or uncertain geometry should produce “Cannot assess clearly” rather than a bad-looking score. Avoid relying on color alone.

During movement, show at most one stable cue or highlight. Derive directions such as “raise your left forearm” only when the observed geometry supports them; otherwise use a more limited comparison cue. Suppress rapid cue changes, and place detailed explanations after the attempt. Keep the live percentage optional or secondary.

After an attempt, offer one strength, one correction, and a button to repeat the relevant section. An optional local recording can synchronize learner/reference replay. Separate pose similarity from timing only after timing alignment and camera latency are accounted for. DTW can align sequences for comparison, but alignment can also hide lateness; do not infer a valid rhythm score merely from using it.

An accuracy-colored ghost is worth an experiment after orientation, scale and alignment are dependable. The current combined view positions an avatar beside the learner; it does not establish body registration suitable for a precision overlay. A confusing overlay is worse than clear side-by-side viewing.

## Other features worth considering

- **Optional count-in, metronome and eight-count phrases:** valuable for dance; use manual phrase markers when beat detection is uncertain. Keep generic sections for martial arts and other movement lessons. Do not force every activity onto musical counts.
- **Personal practice history:** section attempted, repetitions and a comparable improvement trend. Start with small summaries; raw learner video storage is a separate product decision. Compare like-for-like lesson revisions and scoring versions.
- **Phone camera plus desktop/TV display:** potentially high value because a full-body learner stands far from a phone. Begin with clear screen-mirroring guidance; a true paired-device session needs synchronization, connection recovery and deliberate camera ownership. Do not present guidance as implemented casting.
- **Automatic suggested sections:** reduce lesson preparation effort, but keep teacher review. Eight-count detection and movement boundaries solve different problems.
- **Curated starter lessons and onboarding:** help new users experience success before uploading their own content. Improve the existing demo rather than requiring a marketplace.
- **Video-link import:** useful convenience after the mimic flow is strong; do not make the core player depend on a particular social platform.

Defer leaderboards, social feeds, avatar cosmetics, broad gamification, paid course marketplaces and synchronized classes. They do not resolve the core practice difficulties identified here.

## Acceptance before claiming best-in-class usability

These are proposed gates, not achieved results:

- First-time learners can start camera-free watching and a camera practice attempt without explanation; observe task completion and confusion with several representative learners.
- Portrait at 320/360/390 CSS pixels and short landscape layouts retain the full-body view and essential controls without page scrolling during an active attempt.
- Test actual iPhone Safari and Android Chrome, plus desktop browsers. Complete the existing physical-device checklist, including ten-minute sessions, camera switching, tracking loss, heat, permission denial, backgrounding and rotation.
- Countdown/loop cancellation, pause and section changes behave consistently through touch, keyboard and supported voice. No queued action starts unexpectedly after an interruption.
- Validate correct and intentionally incorrect motions across body proportions, front/side/back views, turns, occlusion and movement speed. Track false praise and false corrections, not just average scores.
- Check mirrored and same-side following against known asymmetric moves. Viewing-angle changes must not silently invalidate scoring.
- Measure camera-to-feedback latency and stability on representative phones; adapt tracking/render quality when necessary. A responsive layout alone does not establish real-time performance.
- Confirm camera-free and tracking-unavailable fallbacks remain fully usable. Learner capture is explicitly optional, with clear local-versus-upload behavior.

## Recommended order

**First:** focused responsive stage, readiness/countdown, repeat loops, direct section selection, clear view/mirror controls, and real-device validation.

**Second:** confidence-aware cues, optional local attempt replay, useful post-attempt feedback, and validated timing assessment.

**Third:** rhythm tools, progress trends, large-screen pairing and simpler content import according to learner demand.

Preserve the single reusable MimicInterface and shared playback controller described in `docs/mimic-interface.md`. Extend them rather than building separate camera/scoring implementations for different lesson or sharing pages.
