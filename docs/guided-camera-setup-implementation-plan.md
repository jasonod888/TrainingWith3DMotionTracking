# Guided camera setup: silhouette, spoken guidance, and verified readiness

Date: 2 November 2026
Status: implementation specification and developer handoff. No implementation is included.

## 1. Objective

Replace the ambiguous height-calibration experience with a dedicated, approachable setup flow that helps a person position themselves, hold a suitable standing pose, and understand exactly when practice or a scored run begins.

The intended sequence is:

**Prepare nearby → fit into the guide → hold still → camera ready → audible countdown → practice.**

The person must be able to complete the positioning and measurement stages from across the room without reading small text or returning to the device to start. A large silhouette provides the visual goal; spoken guidance provides actionable feedback at a distance; measurement-driven animation communicates progress.

This borrows the interaction pattern of Face ID enrollment: a positioning target, a distinct capture stage, and a clear completion. It does not reproduce Face ID's biometric scan or claim equivalent hardware or accuracy.

## 2. Product requirements and boundaries

### Required outcomes

1. Users can distinguish setup from active practice at every point.
2. Users receive one clear next action instead of a generic progress bar.
3. The guide accepts different body proportions; exact silhouette overlap is never required.
4. Completion requires current, reliable body observations and stable height matching.
5. Success is communicated by text, shape/checkmark, and sound when enabled.
6. A user who explicitly chose setup-and-start proceeds without another distant button press.
7. Setup failure, cancellation, tracking loss, or audio failure cannot accidentally start a run.

### In scope

- A dedicated responsive setup surface before live practice/compete.
- A generic vector silhouette, head region, foot regions, and placement feedback.
- Spoken positioning instructions, brief confirmation sounds, and countdown coordination.
- Explicit setup state and stable-calibration progress handling.
- Correct integration with the existing pose worker, height matching, auto-framing, practice session, and competition session.
- Recovery, accessibility, and meaningful automated/manual verification.

### Out of scope

- Uploaded-video silhouettes or stored person segmentation.
- New pose/segmentation models, cloud inference, or body identity recognition.
- Estimating real physical height in centimetres/metres without an external reference.
- New scoring logic, recording behavior, camera capture constraints, or paired-display protocols.
- Requiring voice commands, microphone access, body rotation, or a movement assessment.

"Camera ready" means the supported standing setup and existing height alignment are usable. It does not certify technique, biometric identity, available floor space, or clearance for every kick/punch.

## 3. Current code and integration constraints

| Area | Existing code | Implementation responsibility |
| --- | --- | --- |
| Practice entry, controls, recording | `apps/web/src/PracticeWorkspace.tsx` | Own entry intent, visible surface, cancellation, and final handoff |
| Camera/worker lifecycle and calibration | `apps/web/src/MimicInterface.tsx` | Keep one camera stream and worker; deliver setup observations and validated calibration results |
| Standing assessment and estimator | `web/dist/pose.js`: `assessStanding`, `HeightCalibration` | Add structured assessment outcomes and explicit interruption rules without changing measurement meaning |
| Camera display auto-framing | `apps/web/src/camera-framing.ts` | Remain disabled throughout positioning/measurement; reset and reacquire after setup |
| Practice countdown and attempts | `packages/learning-engine/practice-session.ts` | Remain the sole owner of countdown timing and actual attempt start |
| Scored-run policy | `packages/learning-engine/competition-session.ts` | Start scored intent once through existing policy, after setup succeeds |
| Shared practice types/styles | `apps/web/src/practice-types.ts`, `practice.css` | Add explicit setup state and isolated layout styles |
| Existing optional voice commands | `web/dist/voice.js` | Keep separate from spoken output; no implicit microphone enablement |

Today `HeightCalibration` requires approximately 2.5 seconds and at least 30 stable samples, checks standing posture, and stores relative image height/floor/centre. It immediately resets on invalid assessments, and also resets after sample gaps over 600 ms. Practice already has a countdown; compete configures five seconds. Preserve these facts when integrating instead of layering a second estimator or countdown over them.

Prefer adding focused TypeScript modules/components such as:

- `camera-setup-controller.ts`: pure state machine, timing, intent, and eligibility decisions.
- `CameraSetup.tsx`: preparation/positioning/measurement/success presentation.
- `camera-setup-audio.ts`: prompt scheduling, cancellation, playback state, and fallback.
- `camera-setup-guide.ts`: source-space guide geometry and coordinate mapping.

Names may follow repository conventions. One controller owns setup transitions; React effects must not independently decide success and start playback.

## 4. Entry points and user intent

### Normal practice entry

The current Start practice action opens the preparation surface. Opening that surface does not start a practice attempt or request the microphone.

Show, while the user is close to the device:

**Title:** Get ready to practise

**Explanation:** "First, we'll check your camera position and match your height. Then practice starts after a countdown."

Controls:

- **Spoken guidance** toggle, on by default for a new visit; preserve changes for the visit.
- **Test sound** button: "You'll hear setup instructions like this."
- Primary: **Set up & start practice**.
- Secondary: **Back**.

Short preparation advice: "Place your device securely so you can see the instructor. Leave room to move."

The primary action records `intent = start_practice` and begins permission/camera startup. It explicitly authorizes the later automatic countdown, but never authorizes recording.

### Compete entry

Use the same setup flow with mode-specific copy:

- Title: Get ready for your scored run.
- Explanation explicitly says scoring starts after the countdown.
- Primary: **Set up & start scored run**.
- Intent: `start_compete`.

Do not call `CompetitionSession.start()` while the user is still positioning or measuring. No attempt, recorded score, or incomplete competition result should be created merely by entering setup.

### Manual recalibration

"Match height again" records `intent = setup_only`. Pause the current activity through existing policy before setup begins. Success returns to the workspace paused with "Camera ready. Choose Play when you're ready." It must never silently restart a paused run.

### Valid calibration already available

For this first release, a new camera start or explicit setup request performs setup. Routine play/pause with an unchanged, valid camera does not repeat enrollment. Camera identity/dimensions changing invalidate calibration according to the existing rules. Changing only pane dimensions does not.

## 5. UI layout and visual language

### Dedicated surface

During setup, replace the practice stage and right-side practice controls with a dedicated setup surface. Keep clear Cancel/Back and sound controls. Do not show a moving instructor, timeline, similarity score, recording button, or active-practice heading behind a competing setup card.

Use the full available viewport for setup. Within it, display the complete camera image using contained fitting, with its original aspect ratio and chosen selfie mirroring. Neutral unused margins are acceptable. Do not crop to fill during setup.

On desktop, use a large central camera area with the stage title above and one instruction below. On phones, use the same hierarchy, respect safe areas and browser controls, and keep controls reachable. Do not force a device orientation or claim a wider lens.

The silhouette and all source-anchored markers must be drawn inside the actual video destination rectangle, not across the surrounding letterbox area. Use one source-to-display transform for video, guide, and detected-body feedback. Mirror once; fixed text stays upright.

### Guide design

- Use an original, gender-neutral SVG outline with relaxed arms slightly separated from the torso and a natural standing stance.
- Use broad head/foot target regions and a subtle centre axis rather than a precise cutout to match.
- Start with a fixed target centred at source x=0.5, approximately 70% of source-image height. Adapt its width to the source aspect ratio and available image area so the guide itself is not clipped.
- These target proportions are instructional. Acceptance is based on visibility, edge clearance, standing eligibility, and usable scale, not pixel overlap or a single target height.
- The guide is steady during positioning. It must not chase the detected person or continually resize to make an incorrect position look correct.
- On accepted positioning, it may transition once to detected standing proportions for the measurement animation. Label this as progress feedback; it is still not segmentation of clothing/hair.
- No skeleton overlay or numeric similarity score during setup. A few region checks are sufficient.

### Feedback appearance

Use three visibly distinct conditions without relying on colour alone:

| Condition | Visual feedback |
| --- | --- |
| Waiting for positioning | Soft dashed outline; incomplete head/foot markers |
| Position accepted / measuring | Solid outline; checked regions; progress border or ring |
| Complete | Checkmark, explicit "Camera ready", brief confirmation accent |

Low-confidence regions should return to an incomplete/neutral appearance, not flash red. Red is reserved for an actual error. Keep backgrounds quiet and contrast sufficient against bright/dark camera imagery. A large instruction should be readable across the room, but audio remains the primary distant guidance.

## 6. State machine and transition ownership

Represent stage, user intent, source epoch, calibration validity, current issue, progress, audio status, and start-handoff status explicitly. Do not infer them from message strings or `cameraState === live` alone.

| Stage | User experience | Exit condition |
| --- | --- | --- |
| `prepare` | Explanation, sound test, explicit action | User chooses setup-and-start or setup-only |
| `starting` | "Starting your camera…" | Camera and tracker ready, or recoverable error |
| `positioning` | Fixed silhouette and one correction | Eligible position maintained for 500 ms |
| `measuring` | "Hold still" plus verified progress | Calibration complete, positioning lost, cancellation, or error |
| `ready` | Checkmark and "Camera ready" | Success announcement finishes or times out; current readiness rechecked |
| `handoff` | Restore workspace and prepare countdown | Setup-only returns paused; start intent invokes session start exactly once |
| session `countdown` | Existing preparation countdown | Existing session begins attempt, or interruption pauses it |
| session `playing` | Normal practice/compete | Existing session policy applies |
| `help` / `error` | Specific recovery action, Retry/Cancel | Explicit retry or cancellation |

Cancelled setup is terminal for that source epoch/intent. Discard late model results, audio completions, promises, and timers. Repeated React effects or repeated `done` observations must not start more than one countdown.

Use monotonic time for gates and stale-frame decisions. Feed the capture timestamp and source epoch through the existing pose-worker messages. Reject non-finite, out-of-order, previous-epoch, and overly old observations. Proposed defaults: reject positioning/measurement evidence older than 500 ms; treat a 900 ms absence of fresh results as tracking loss. Keep these tunable in one place and verify on slower supported devices.

## 7. Positioning assessment and correction logic

Expose structured observation results, for example `person_missing`, `head_missing`, `feet_missing`, `hands_missing`, `edge_risk`, `off_center`, `too_small`, `standing_required`, `unstable`, and `eligible`. Include evidence quality and relevant region flags. Do not parse English messages returned by `assessStanding` to drive behavior.

Retain the existing standing checks and source-edge protection. Add visible wrists/hands to setup positioning eligibility: the current height estimator's core list does not include wrists. Reuse supported pose visibility thresholds initially (0.65 for setup); do not claim fine finger detection or precise hair/clothing outlines.

Suggested positioning rules:

1. Find a reliable person in the original frame.
2. Confirm head, hands, knees, and both feet are visible with valid finite coordinates.
3. Confirm sufficient source-edge clearance, including the existing estimated crown and floor checks.
4. Confirm upright standing posture through existing assessment.
5. Prefer horizontal centre within 15% of source width of the guide centre. Use a slightly looser exit threshold to prevent flicker.
6. Accept the existing supported image-height range; do not require exact overlap with the nominal 70% guide. Prompt someone to move closer only when scale is too small to support measurement, not to cosmetically match the outline.
7. Maintain all eligibility conditions for 500 ms before measuring.

Corrections must be evidence-based. Missing feet alone does not prove the person should move backwards: the camera might be tilted. First say feet are missing; then suggest stepping back or adjusting the device if the problem persists. Do not prescribe a precise physical distance from image proportions.

Screen-relative left/right corrections must account for selfie mirroring. Prefer initial copy "Move towards the centre of the guide" plus a large directional arrow. If directional speech is added, test that the instruction is correct from the user's perspective on front and rear cameras.

Rear cameras can use the same visibility/measurement process with suitable device-placement guidance; they must not assume selfie mirroring. Preserve the existing requirement to confirm a visible instructor display/controls. Auto-framing support remains subject to its existing front-camera/layout restrictions.

## 8. Stable measurement and honest scan animation

Use the existing `HeightCalibration` as the measurement authority, with the following explicit continuity policy. A visual sweep alone never declares success.

- On entry, clear previous candidate samples and say "Good position. Stand upright and hold still."
- Progress reflects at least 2.5 seconds of accepted stable observations and at least 30 accepted samples, retaining the existing estimator's height/floor/centre stability tolerances.
- A gap of up to 300 ms with missing/invalid observations pauses visual progress, freezes its last verified value, and adds no samples or valid elapsed time. Do not keep sampling inferred or repeated poses.
- After fresh eligible observations resume, continue only if they are consistent with the retained stable measurements; exclude the missing interval from accepted elapsed time.
- If the interruption exceeds 300 ms, or resumed geometry materially differs, discard the candidate and return to positioning. Communicate the reason calmly. Do not preserve stale partial progress and eventually declare completion from disconnected fragments.
- A clear posture change, camera change, person jump, or source-edge violation can invalidate immediately when continuing would be misleading.
- Do not finish on an invalid/stale observation, even if a visual animation has nearly completed.

This requires a deliberate refactor or adapter around current estimator continuity. The existing implementation resets immediately on an invalid sample and uses raw elapsed time between samples; it does not already implement this pause policy. Keep the new behavior tested and reusable for any existing estimator consumers. Do not merely freeze the UI while secretly retaining an estimator that has reset.

Render a slow light sweep clipped to the guide with a progress border/ring driven by accepted progress. The sweep may be decorative while measurements arrive, but stop/pause it when measurement pauses. Reduced-motion mode uses a static guide and a progress indicator without sweeping/pulsing movement.

The one-time transition to a body-proportioned outline may use stable landmarks. Do not display skin/clothing reconstruction, biometric dots, body measurements, or claims of a detailed 3D scan.

## 9. Spoken guidance and sound scheduling

### Delivery

Use a small set of locally bundled, professionally understandable English prompt recordings as the preferred first-release output. Store audio assets with the app; no runtime generative speech service or microphone permission is required. A browser speech-synthesis fallback is optional, not a dependency for completing setup. Local audio packaging does not alter the existing optional voice-command service or its consent.

Initialize/unlock audio during the user's Test sound or primary-button gesture. Handle rejected playback explicitly. Never assume a toggle being on means sound was audible, and do not promise to detect physical speaker volume. If playback fails, show "Sound couldn't play. Follow the guide on screen" with Test sound/retry controls, and keep visual setup usable.

The user may mute guidance at any stage. Stop active speech and queued prompts immediately on mute, cancel, source change, page exit, or stage replacement. Background suspension follows the existing camera lifecycle; resume requires an explicit action.

### Prompt catalogue

| Event / condition | Spoken wording |
| --- | --- |
| Sound test | "You'll hear setup instructions like this." |
| Positioning begins | "Let's set up your camera. Stand inside the guide with your head and feet visible." |
| No person | "Stand in front of the camera." |
| Feet missing | "I can't see both feet. Step back a little, or adjust the camera." |
| Head missing | "Keep your head inside the camera picture." |
| Hands missing | "Let your arms rest slightly away from your sides so your hands are visible." |
| Off-centre | "Move towards the centre of the guide." |
| Standing required | "Face the camera and stand upright with your arms relaxed." |
| Too small | "Step a little closer, keeping your head and feet visible." |
| Measurement begins | "Good position. Hold still while we match your height." |
| Movement interrupts measurement | "Hold still for a moment, and we'll try again." |
| Complete, start intent | "Camera ready. You're all set." |
| Complete, setup-only | "Camera ready. Choose Play when you're ready." |
| Countdown, practice | "Practice starts in five seconds." |
| Countdown, compete | "Your scored run starts in five seconds." |
| Countdown end | "Three. Two. One. Begin." |
| Prolonged difficulty | "Setup is taking longer than expected. Come closer to the screen for help." |

Review the wording in physical-device testing. Where evidence is ambiguous, choose a neutral visibility instruction instead of a confident directional claim.

### Scheduler rules

- One active prompt; never queue every pose update.
- Coalesce issue changes into one current issue. Let it persist for approximately 750 ms before correction speech.
- Allow approximately 3 seconds for the user to respond after a correction. Repeat an unchanged issue no more frequently than every 6 seconds.
- Priority: cancellation/error → current positioning correction → measurement/success transition → encouragement. No repetitive praise loop.
- Cancel obsolete prompts on a stage transition. Preempt a correction if it contradicts the current stage; do not let "step back" finish after success.
- Use short non-speech tones sparingly: one positioning confirmation if useful, one success chime, then countdown cues.
- Show the current spoken instruction as equivalent visible text. Do not use an assertive screen-reader announcement for every frame.
- Coordinate with existing instruction sounds, metronome, countdown beeps, and optional speech recognition. Suspend recognition while app prompts play to avoid self-triggered commands; restore it only if previously enabled and still authorized. Suppress overlapping setup/countdown audio.

## 10. Completion, countdown, and practice handoff

On verified success:

1. Lock the validated calibration result for the current source epoch and retain the same camera stream/worker.
2. Show a checkmark with **Camera ready**; play one success chime/announcement if enabled.
3. Keep the success screen visible briefly, initially around 1 second. Wait for the short success announcement when enabled, with a bounded completion timeout so audio failure cannot trap the user.
4. Recheck that the camera is live, the source is unchanged, calibration is valid, and tracking is current. If readiness has been lost, return to positioning with an explanation rather than starting.
5. For `setup_only`, restore the paused workspace and stop here.
6. For an explicitly authorized start intent, restore the workspace and invoke its session start exactly once. Use five seconds for this first guided handoff, including silent mode so there is still preparation time.
7. The existing session owns countdown timing, displayed numbers, audio cue events, and the attempt boundary. Do not run a separate setup countdown timer or call playback directly after a fixed timeout.

For practice, support a one-start countdown override rather than permanently overwriting the user's configured countdown. Subsequent repetitions and ordinary starts retain their settings. Compete already uses five seconds through `CompetitionSession`.

During countdown, auto-framing may reacquire according to its existing safe policy. Its display changes must not invalidate the physical calibration. A camera loss, stale tracking, navigation, backgrounding, explicit cancel, or relevant setup interruption cancels the pending start through session policy. Never silently resume a cancelled countdown.

Practice recording remains opt-in. Setup-and-start must not arm `recordNext` or start `MediaRecorder`. If a separate previously authorized recording flow is integrated later, preserve its explicit intent and current attempt-start hook.

## 11. Recovery, accessibility, and privacy

- Permission denial: explain camera access is needed; provide Retry and Back. Do not repeatedly prompt automatically.
- Tracker/model failure: show a useful failure state rather than an endless scan. Preserve existing watch-only access outside setup.
- Positioning difficulty: after approximately 20 seconds without useful progress, offer prominent help while keeping valid attempts possible. After approximately 45 seconds without improvement, stop repeating corrections and offer **Try again**, **Camera placement tips**, or **Back**. Do not silently force success.
- Multiple people/implausible pose jumps: invalidate candidate measurements and ask for one person in view. A single returned pose cannot prove no other person exists; avoid claiming reliable multi-person detection without adding that capability.
- Cancellation: always available, releases setup-owned timers/audio and, when exiting live practice entirely, the camera resources through existing cleanup. No automatic run begins afterward.
- Users unable to adopt the supported standing pose: state the current limitation plainly and offer watch-only/exit. Do not add a "skip and mark calibrated" control that incorrectly enables scoring. A supported seated/adaptive mode needs separate measurement and scoring design.
- Use semantic headings, labelled controls, a progressbar with meaningful values, restrained `aria-live` stage changes, keyboard access, and visible focus. Maintain sound-off and reduced-motion paths with equivalent information.
- No setup images, voice recordings, landmarks, or calibration clips are uploaded or saved by this feature. Do not introduce analytics that contain camera content. Any optional diagnostic timing logs must exclude personal imagery and pose coordinates.

## 12. Implementation phases

### Phase A — state and measurement contracts

Define stage/intent/event types, structured assessment issues, source epoch handling, freshness, pause/reset behavior, and exactly-once handoff. Add pure controller and estimator tests first. Preserve the existing calibration output contract or provide an explicit migration for every consumer.

### Phase B — silent visual flow

Build preparation, full-image guide, region feedback, measurement progress, completion, cancellation, and recovery. Wire them to real existing observations. Verify across camera aspect ratios before adding sound; no mock timer may stand in for measurement success.

### Phase C — spoken guidance

Bundle prompt assets and implement the scheduler, sound test, mute, playback-failure fallback, prompt priorities, and speech-recognition coordination. Verify with autoplay/playback rejection and delayed audio completion.

### Phase D — session integration

Integrate normal practice, compete, and manual recalibration. Reuse the existing countdown owner, introduce a one-start countdown override if needed, preserve recording intent, and keep camera resources alive across the setup/workspace transition.

### Phase E — verification and tuning

Run the automated checks and physical-device matrix below. Tune target guide size, issue hysteresis, speaking cadence, and progress behavior from actual use. Document final parameters and any untested device cases.

## 13. Acceptance criteria and verification

| Scenario | Required behavior |
| --- | --- |
| User chooses Start practice | Setup is unmistakable; no moving instructor or attempt starts during positioning |
| User walks away from device | Spoken corrections and large guide make the next action understandable |
| Short/tall/wide/narrow body proportions | Useful valid positioning can succeed without exact outline overlap |
| Landscape source on portrait screen | Entire source remains visible; guide stays within the actual image |
| Missing head/feet/hands | Relevant region unconfirmed and one useful correction; no measurement success |
| Valid standing body | Position confirmation, then a distinct hold-still measurement stage |
| Stable measurement | Progress reflects accepted observations; success requires both duration and sample count |
| Brief invalid interval | Progress pauses; invalid frames/time do not increase accepted progress |
| Sustained loss / changed posture | Candidate resets clearly; no misleading continuation from stale measurements |
| Completion | One checkmark/chime/announcement and one session handoff |
| Duplicate done events / rerenders | One countdown and at most one attempt start |
| Setup-only | Returns paused with no automatic playback |
| Practice/compete start intent | Five-second guided handoff; scoring begins only at actual attempt start |
| Loss during ready/countdown | Pending start cancelled or returned to positioning; no silent restart |
| Sound disabled or playback rejected | Visual setup remains usable; no deadlock or overlapping prompts |
| Page backgrounded / camera ended / Cancel | Existing camera suspension/cleanup applies; old speech and callbacks cannot start playback |
| Front-camera mirror toggle / rear camera | All markers map correctly, guidance is coherent, and existing rear-camera readiness rules remain enforced |
| Presentation resize/orientation change | Guide recomputes; no false physical recalibration solely from layout change |
| Recording / paired display | Existing explicit recording and raw-track behavior remain unchanged |
| Reduced motion / keyboard / screen reader | Equivalent stages and completion, usable controls, no frame-by-frame announcement spam |

Automated coverage must include synthetic timestamped pose sequences for all stages; discontinuous timestamps; NaN/partial results; low confidence; loss at 99% progress; reacquisition; source epoch changes; cancellation before asynchronous completion; double success events; and invalid observations during success/countdown.

Browser checks must verify the actual rendered guide/contained-image mapping, mirroring, region states, semantic progress, audio scheduling/cancellation, blocked playback, and stream continuity. Include assertions that setup creates no practice attempt, score, or recording.

Run existing relevant unit/engine tests and frontend production build. A separate integration test should prove the same camera track survives setup-to-practice handoff and that practice/compete use only their existing session countdown.

Physical-device acceptance: desktop webcam, Android Chrome, and iPhone Safari where available. Test from across the room with sound on/off, bright/dim backgrounds, different body proportions/clothing, a poor camera angle, interruptions, and real positioning attempts. Record unavailable checks as outstanding; browser emulation is not physical-device verification.

## 14. Developer deliverables and completion

Deliver the implementation, bundled prompt and SVG assets with appropriate usage rights, tests, and a verification note linked from this document. Include screenshots of prepare, positioning, measuring, ready, and failure/help states, plus a short recording demonstrating the spoken sequence if available.

Document final thresholds/timings, supported languages, audio fallback behavior, estimator continuity changes, and any device limitations. Keep the existing auto-framing verification intact and add regression coverage for the new setup interaction.

Done means a first-time user can understand and complete camera setup from a distance, receive truthful measurement feedback, and enter the intended session with an unmistakable countdown. A polished animation without validated measurements and reliable session handoff is not complete.

## References

- Existing [auto-framing plan](live-camera-autoframing-plan.md) and [verification](live-camera-autoframing-verification.md).
- [Apple Face ID setup](https://support.apple.com/en-gb/108411): reference for distinct positioning, capture, and completion stages.
- [Apple Face ID technology](https://support.apple.com/en-gb/102381): explains the depth/infrared hardware distinction; not functionality claimed by this webcam feature.
