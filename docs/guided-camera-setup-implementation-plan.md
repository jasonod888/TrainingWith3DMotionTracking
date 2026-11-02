# Guided camera setup: silhouette, spoken guidance, and verified readiness

Date: 2 November 2026
Status: Phase A (contracts, estimator adapter, tests) and Phase B (silent visual flow, reachable from the normal entries) are implemented. Audio and the guided handoff countdown are still to come. See [Phase A verification](guided-camera-setup-phase-a-verification.md) and [Phase B verification](guided-camera-setup-phase-b-verification.md).

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

### Decision log (review of 2 November 2026)

These decisions were taken after measuring the existing estimator's behaviour and supersede any conflicting wording below; where they conflict, the decision log wins and the section it affects has been rewritten.

| # | Decision | Supersedes |
| --- | --- | --- |
| D1 | Calibration continuity is a dedicated `StableHeightCalibration` adapter. `HeightCalibration` and the standalone motion lab keep their current behaviour. Shared `assessStanding` is hardened only for malformed input and gains structured reasons; its successful return contract is unchanged. | "refactor or adapter" ambiguity in §8 |
| D2 | Keep the 30-observation / 2.5-second requirement, but remove the 3-second collection cliff: a candidate may live up to 10 seconds, sample storage is bounded, and expiry produces an explicit slow-tracking recovery state. No inference-rate change, no lowered sample count. | the 3000 ms sample window inherited from `HeightCalibration` |
| D3 | Interruption tolerance starts at 600 ms (not 300 ms). Credited time for a consecutive accepted interval is capped at 250 ms. Progress pauses on invalid observations and adds no evidence. | §8's 300 ms discard rule |
| D4 | Wrist/hand visibility is a positioning check only, sourced from existing body-observation geometry. It is not added to the estimator's core requirements, and a briefly occluded wrist does not reset measurement. Structured `too_small`, `too_large`, and source-boundary reasons are required; "move closer" is never issued for a cropped head or an oversized body. | §7's "add wrists to setup positioning eligibility" wording is kept, "to the estimator" is not |
| D5 | Rear-camera confirmation lives in the preparation surface. Readiness depends on that explicit confirmation and the camera/display configuration, never on transient voice-recognition state. Preflight before measurement, recheck before handoff. Voice recognition is suppressed during app speech by ignoring results, not by tearing down and restarting recognition. | §7 and §9's `voiceState` coupling |
| D6 | Positioning acceptance freezes a body-proportioned outline for measurement. The outline does not track live landmarks, and no completion checkmark appears before measurement succeeds. | §5's permissive "may transition once" |
| D7 | Setup validity is keyed to a complete source identity: source generation, device identity where available, and actual video dimensions. Pane-only resize never invalidates; an actual source change does. | §4 and §13's single "presentation resize/orientation" row |
| D8 | Setup is a shell-level overlay. The workspace stays mounted and resource-warm, hidden and inert (including keyboard and accessibility focus). The instructor must be ready before countdown. | §5's "replace the practice stage" |
| D9 | Handoff is structurally exactly-once: a consumed token in the controller, a session-level duplicate-start guard, and a setup-active gate covering keyboard, transport, remote and voice actions. Camera-state callbacks must not overwrite setup instructions. | §6's prose-only guarantee |
| D10 | A guided setup-and-start always uses five seconds, including when the user's count-in preference is zero, and says so before the primary action. Implemented as `start(secondsOverride?)`; the persisted preference is never mutated. | §10's "one-start override" without the zero case |
| D11 | First release uses browser speech synthesis where available, with a fully usable visual and optional tone fallback. Prerecorded prompts may replace it later once usage rights are settled; no recording with uncertain rights ships. | §9's "recordings as preferred first-release output" |
| D12 | Browser regression coverage is committed and repeatable, extending `scripts/verify_camera_framing.py`, which already mocks the camera, the pose worker and the API. No separate component-testing framework is added. | §13's unqualified "browser checks" |
| D13 | Portrait-phone / landscape-camera evaluation moves into the first layout spike. Keep the complete image, enlarge the setup surface, use margins for instructions, and offer (never force) a landscape suggestion. | §12's Phase B ordering |
| D14 | No intermediate preparation card. **Start practice**, **Start scored run** and **Match height again** record the intent and start setup immediately. The five-second disclosure moves to the **Camera ready** screen, which is the last moment before the countdown, and the rear-camera confirmation becomes an in-flow card shown when requirements block measurement. | §4's preparation surface and D10's "before the primary action" |
| D15 | The pose tracker is warmed when the practice screen opens, so the ~14.6 MB model and WASM are not charged to the **Start practice** press. The warmed worker is adopted by the first camera start and re-warmed after stop. | implied by §4's single-press entry |
| D16 | A temporary **operator** switch, `CAMERA_CALIBRATION_ENABLED` (default on), can skip guided setup and use a fixed default alignment for testing. It is server-controlled through `/api/capabilities`, is never a user-facing skip, never claims height matching, and records `calibration=default` in the attempt configuration so those sessions are distinguishable. | the literal reading of §11's ban on "skip and mark calibrated" — this is an operator switch, not a user control |

Copy: use "practice" throughout, never "practise". The spoken-guidance preference is held in memory for the current visit only and is not persisted with `PracticePreferences`.


## 3. Current code and integration constraints

| Area | Existing code | Implementation responsibility |
| --- | --- | --- |
| Practice entry, controls, recording | `apps/web/src/PracticeWorkspace.tsx` | Own entry intent, visible surface, cancellation, and final handoff |
| Camera/worker lifecycle and calibration | `apps/web/src/MimicInterface.tsx` | Keep one camera stream and worker; deliver setup observations and validated calibration results |
| Standing assessment and estimator | `web/dist/pose.js`: `assessStanding`, `HeightCalibration` | `assessStanding` gains structured reasons and malformed-input rejection; `HeightCalibration` is unchanged |
| Setup measurement continuity | `apps/web/src/camera-setup-estimator.ts`: `StableHeightCalibration` (new) | Own the pause/credit/expiry policy for the new flow only; never mutate the legacy estimator |
| Setup state machine | `apps/web/src/camera-setup-controller.ts` (new) | Own stage, intent, source identity, freshness, dwell, exactly-once handoff |
| Camera display auto-framing | `apps/web/src/camera-framing.ts` | Remain disabled throughout positioning/measurement; reset and reacquire after setup. Also the single source of region/hand visibility geometry |
| Practice countdown and attempts | `packages/learning-engine/practice-session.ts` | Remain the sole owner of countdown timing and actual attempt start; add a one-start countdown override |
| Scored-run policy | `packages/learning-engine/competition-session.ts` | Start scored intent once through existing policy, after setup succeeds |
| Shared practice types/styles | `apps/web/src/practice-types.ts`, `practice.css` | Add explicit setup state and isolated layout styles |
| Existing optional voice commands | `web/dist/voice.js` | Keep separate from spoken output; no implicit microphone enablement; add output suppression |

Today `HeightCalibration` requires approximately 2.5 seconds and at least 30 stable samples, checks standing posture, and stores relative image height/floor/centre. It immediately resets on invalid assessments, and also resets after sample gaps over 600 ms. It retains only a 3000 ms sample window, which makes the 30-sample requirement unsatisfiable below 10 accepted observations per second — measured at 6 Hz, 8 Hz and 9 Hz the progress value saturates and never reaches 1. The new flow therefore uses `StableHeightCalibration` rather than inheriting that window. Practice already has a countdown; compete configures five seconds. Preserve these facts when integrating instead of layering a second estimator or countdown over them.

Prefer adding focused TypeScript modules/components such as:

- `camera-setup-controller.ts`: pure state machine, timing, intent, and eligibility decisions.
- `camera-setup-estimator.ts`: `StableHeightCalibration` continuity adapter and its tunables.
- `CameraSetup.tsx`: preparation/positioning/measurement/success presentation.
- `camera-setup-audio.ts`: prompt scheduling, cancellation, playback state, and fallback.
- `camera-setup-guide.ts`: source-space guide geometry and coordinate mapping.

Names may follow repository conventions. One controller owns setup transitions; React effects must not independently decide success and start playback.

## 4. Entry points and user intent

### Normal practice entry

The current Start practice action starts setup directly: it records `intent = start_practice`, requests the camera and opens the positioning stage. It does not start a practice attempt, request the microphone or ask for a second confirmation (D14). The camera is warmed before this point (D15).

The five-second countdown is disclosed on the **Camera ready** screen, immediately before it runs: "Practice starts in five seconds." That replaces the old preparation card, which was removed because it added a press without adding information the setup surface could not carry at the moment it mattered.

The rear-camera confirmation appears inline when it actually blocks progress, rather than on an entry card.

The primary action records `intent = start_practice` and begins permission/camera startup. It explicitly authorizes the later automatic countdown, but never authorizes recording.

### Compete entry

Use the same setup flow with mode-specific copy:

- Title: Get ready for your scored run.
- Explanation explicitly says scoring starts after the countdown.
- Primary: **Set up & start scored run**.
- Intent: `start_compete`.

Do not call `CompetitionSession.start()` while the user is still positioning or measuring. No attempt, recorded score, or incomplete competition result should be created merely by entering setup.

### Rear-camera preparation

When the selected or actual camera is rear-facing and no paired display is active, the preparation surface carries the existing **"I can see the instructor and operate controls"** confirmation instead of hiding it in the Camera panel. Readiness depends on that explicit confirmation plus the camera and display configuration. It must not depend on transient voice-recognition state (D5).

Confirmation belongs to a configuration key: source generation, device identity, actual video dimensions, facing mode and paired-display status. Any change to that key invalidates the confirmation and returns the user to preparation. Requirements are preflighted before measurement starts and rechecked before handoff.

### Manual recalibration

"Match height again" records `intent = setup_only`. Pause the current activity through existing policy before setup begins. Success returns to the workspace paused with "Camera ready. Choose Play when you're ready." It must never silently restart a paused run.

### Valid calibration already available

For this first release, a new camera start or explicit setup request performs setup. Routine play/pause with an unchanged, valid camera does not repeat enrollment.

Setup validity is keyed to a complete source identity (D7):

- **Source generation** — the existing `SourceSession` epoch, advanced when the camera stops or restarts.
- **Device identity** — the selected device id, and the actual facing mode where the platform reports it.
- **Actual video dimensions** — `videoWidth` × `videoHeight`, which is what the calibration numbers are expressed in.

A change to any part invalidates the candidate or calibration and returns to the appropriate setup stage. A pane-only resize (layout, orientation of the presentation, window resize) must not invalidate anything: it only recomputes the display transform. The dimension check is the discriminating test, so do not treat "orientation change" as one case — if the source dimensions change, it is a source change; if they do not, it is a presentation change.

Confirmation and requirements share the same key, so a source change also clears the rear-camera confirmation.

## 5. UI layout and visual language

### Dedicated surface

Setup is a shell-level overlay, not a replacement of the practice stage (D8). The workspace below it stays mounted so the camera stream, pose worker and instructor resources stay warm, but it is visually hidden and inert: no pointer events, no keyboard reachability, no accessibility visibility (`inert`/`aria-hidden` and a focus trap on the overlay), and the desktop sidebar, transport, context panel and decorative gradients cannot paint over or compete with the setup surface. Setup owns the full viewport for its duration, including the 320 px desktop sidebar region.

Keep clear Cancel/Back and sound controls. Do not show a moving instructor, timeline, similarity score, recording button, or active-practice heading behind a competing setup card.

Within the surface, display the complete camera image using contained fitting, with its original aspect ratio and chosen selfie mirroring. Neutral unused margins are acceptable and are the preferred home for instructions. Do not crop to fill during setup.

On desktop, use a large central camera area with the stage title above and one instruction below. On phones, use the same hierarchy, respect safe areas and browser controls, and keep controls reachable. Do not force a device orientation or claim a wider lens.

Before countdown the instructor must already be renderable. The workspace is warm and unmounted resources are not reloaded at handoff; a loading flash or an invisible instructor at attempt start is a failure, not a cosmetic defect.

The silhouette and all source-anchored markers must be drawn inside the actual video destination rectangle, not across the surrounding letterbox area. Use one source-to-display transform for video, guide, and detected-body feedback. Mirror once; fixed text stays upright.

### Guide design

- Use an original, gender-neutral SVG outline with relaxed arms slightly separated from the torso and a natural standing stance.
- Use broad head/foot target regions and a subtle centre axis rather than a precise cutout to match.
- Start with a fixed target centred at source x=0.5, approximately 70% of source-image height. Adapt its width to the source aspect ratio and available image area so the guide itself is not clipped. The 70% figure is an illustration target for the first frame, not a measurement or an overlap requirement.
- These target proportions are instructional. Acceptance is based on visibility, edge clearance, standing eligibility, and usable scale, not pixel overlap or a single target height.
- The guide is steady during positioning. It must not chase the detected person or continually resize to make an incorrect position look correct.
- On accepted positioning, transition once to an outline derived from the accepted body proportions, then freeze it for the whole measurement stage (D6). Do not re-derive it from live landmarks: the estimator's own stability tolerance is 4% of body height, so a tracking outline visibly breathes during "hold still".
- No skeleton overlay or numeric similarity score during setup. A few region checks are sufficient.

### Small-guide layout (portrait phone with a landscape camera)

This is evaluated in the first layout spike, before animation work (D13). A portrait phone commonly delivers a 1280×720 landscape source, so a contained full-body preview is a short strip and a 70%-of-source silhouette can render around 150 px tall. Handle it by enlarging the setup surface and placing the instruction, progress and controls in the unused margins, not by cropping the image or accepting a clipped body. Offer a landscape suggestion when the source is landscape and the viewport is tall; do not force orientation.

### Feedback appearance

Use three visibly distinct conditions without relying on colour alone:

| Condition | Visual feedback |
| --- | --- |
| Waiting for positioning | Soft dashed outline; incomplete head/foot markers; one correction |
| Position accepted / measuring | Solid outline, frozen at accepted proportions; checked regions; progress border or ring; label "Position found" |
| Complete | Checkmark, explicit "Camera ready", brief confirmation accent |

"Position found" is not "Camera ready". No checkmark, success tone or completion wording may appear before measurement succeeds (D6).

Low-confidence regions should return to an incomplete/neutral appearance, not flash red. Red is reserved for an actual error. Keep backgrounds quiet and contrast sufficient against bright/dark camera imagery. A large instruction should be readable across the room, but audio remains the primary distant guidance.

## 6. State machine and transition ownership

Represent stage, user intent, source identity, calibration validity, current issue, progress, audio status, and start-handoff status explicitly. Do not infer them from message strings or `cameraState === live` alone.

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

### Observation admission

Use one monotonic clock for gates and stale-frame decisions — the same clock the capture timestamp is taken from, so `performance.now()`-based requestAnimationFrame times in `MimicInterface`. Feed the capture timestamp and source identity through the existing pose-worker messages. Admit an observation only when all of these hold:

- it belongs to the current source identity;
- its capture timestamp is finite and strictly greater than the previous admitted observation (duplicate and out-of-order results are dropped, never counted);
- `receivedAt - capturedAt` is within the freshness budget (initial 500 ms), measured on the same clock;
- it is not a previous-epoch result delivered late.

Repeated delivery of the same observation must never add measurement evidence. Rejected observations are reported with a structured reason, not a user-facing correction.

Proposed initial budgets, tunable in one place and verified on slower supported devices:

- evidence freshness: 500 ms;
- tracking loss (no fresh valid observation at all): 900 ms;
- positioning eligibility dwell: 500 ms;
- measurement interruption tolerance: 600 ms;
- credited time per consecutive accepted interval: 250 ms.

### Exactly-once handoff

Cancellation is terminal and handoff is structurally single-use (D9). Three independent protections are required:

1. **Controller token.** `consumeHandoff()` returns a payload at most once; the controller records `consumed` before returning. Repeated completion events, re-renders and duplicate `done` observations cannot mint a second token.
2. **Session guard.** `PracticeSession` refuses a duplicate start request while a countdown or attempt it already owns is running, so even a leaked second call cannot restart the countdown or create a second attempt.
3. **Setup-active gate.** Keyboard handlers, transport buttons, remote/paired-display commands and voice actions are blocked while setup owns the workspace, so nothing can navigate or start playback underneath the overlay. Camera-state callbacks must not overwrite setup-owned instructions while setup is active.

All three are tested: repeated `done`, delayed audio completion after cancellation, cancellation before an asynchronous completion, and React StrictMode double-effects.

## 7. Positioning assessment and correction logic

Expose structured observation results. The estimator contributes `no_person`, `invalid`, `occluded`, `out_of_frame`, `not_standing`, `too_small`, `too_large` and `eligible` with the measured `scale` and the breaching `edge`. The setup controller composes the user-facing issues `person_missing`, `head_missing`, `feet_missing`, `hands_missing`, `edge_risk`, `off_center`, `too_small`, `too_large`, `standing_required`, `unstable`, `tracking_lost` from those reasons plus region geometry. Include evidence quality and relevant region flags. Do not parse English messages returned by `assessStanding` to drive behavior.

There must be two distinct eligibility predicates, not one:

- **Positioning eligibility** (setup only): standing posture, reliable body, both feet, both hands, source clearance, usable scale and horizontal centring.
- **Measurement eligibility** (the estimator): the existing standing checks and core landmarks. Unchanged.

Wrists and hands (D4) belong to positioning only. The legacy estimator's core list deliberately excludes wrists, and it must stay that way: adding them would reject valid standing poses and change the measurement contract. After positioning, a briefly occluded wrist alone must not reset an otherwise valid measurement.

Region geometry comes from the existing body observation in `apps/web/src/camera-framing.ts` (`observeBody`), which already reports `headVisible`, `feetVisible`, `handsVisible`, `edgeRisk` and `outsideSource`. Do not add a second independent interpretation of the same landmarks. Pass one threshold override for setup purposes.

Thresholds are documented by purpose and need not converge:

| Purpose | Visibility threshold | Owner |
| --- | --- | --- |
| Auto-framing crop acquisition | 0.60 (`FRAMING_DEFAULTS.visibilityThreshold`) | `camera-framing.ts` |
| Setup positioning and measurement eligibility | 0.65 (`SETUP_DEFAULTS.visibilityThreshold`) | `camera-setup-*` |

Suggested positioning rules:

1. Find a reliable person in the original frame.
2. Confirm head, hands, knees, and both feet are visible with valid finite coordinates.
3. Confirm sufficient source-edge clearance, including the existing estimated crown and floor checks.
4. Confirm upright standing posture through existing assessment.
5. Prefer horizontal centre within 15% of source width of the guide centre. Use a slightly looser exit threshold (20%) to prevent flicker.
6. Accept the existing supported image-height range; do not require exact overlap with the nominal 70% guide. Prompt someone to move closer only when scale is too small to support measurement, not to cosmetically match the outline.
7. Maintain all eligibility conditions for 500 ms before measuring.

Correction direction must follow the structured reason. `too_small` is the only reason that may say "move closer". A cropped head (`out_of_frame` with `edge.top`, or a clipped crown estimate) and an oversized body (`too_large`) must say "step back" or "adjust the camera", never "move closer".

Corrections must be evidence-based. Missing feet alone does not prove the person should move backwards: the camera might be tilted. First say feet are missing; then suggest stepping back or adjusting the device if the problem persists. Do not prescribe a precise physical distance from image proportions.

Screen-relative left/right corrections must account for selfie mirroring. Prefer initial copy "Move towards the centre of the guide" plus a large directional arrow. If directional speech is added, test that the instruction is correct from the user's perspective on front and rear cameras.

Rear cameras can use the same visibility/measurement process with suitable device-placement guidance; they must not assume selfie mirroring. Preserve the confirmation requirement described in §4. Auto-framing support remains subject to its existing front-camera/layout restrictions.

## 8. Stable measurement and honest scan animation

`StableHeightCalibration` (`apps/web/src/camera-setup-estimator.ts`) is the measurement authority for the setup flow. It wraps the existing standing assessment; it does not re-measure anything and it does not change what "height" means. `HeightCalibration` and the standalone motion lab are left untouched (D1). A visual sweep alone never declares success.

### Continuity policy

- On entry, clear any previous candidate and say "Good position. Hold still while we match your height."
- Completion requires **both** at least 30 distinct accepted observations **and** at least 2.5 seconds of credited accepted time, with the existing height/floor/centre stability tolerances.
- There is no 3-second sample window. The legacy estimator discarded anything older than 3000 ms, which makes 30 samples unreachable below 10 accepted observations per second; measured at 6, 8 and 9 Hz the progress value saturated and never reached 1. A candidate may now live for up to **10 seconds**, with bounded sample storage, so slower devices simply take longer (D2). Inference frequency and the sample count are not weakened.
- Credited time accumulates only across consecutive accepted observations, and each interval is capped at **250 ms**. A long silent interval can therefore never masquerade as continuously observed stability, while a genuinely slow stream still accumulates.
- An interruption of up to **600 ms** (D3) pauses progress and freezes the last verified value. No samples and no credited time accrue from invalid observations, and repeated or inferred poses are never sampled. This preserves the existing tolerance for occasional device hiccups.
- On resume, continue only if the fresh observation is consistent with the retained candidate. Exclude the missing interval from credited time: the first observation after a pause credits nothing.
- Beyond 600 ms, or when resumed geometry materially differs, discard the candidate, reset progress to zero and return to positioning with a calm reason. Do not preserve stale partial progress and eventually declare completion from disconnected fragments.
- A posture change, source change, implausible person jump, or source-edge violation invalidates immediately when continuing would be misleading.
- Do not finish on an invalid or stale observation. Completion can only occur inside the handling of a fresh, admitted, eligible observation.
- If a candidate cannot complete within 10 seconds, stop pretending it is progressing: emit an explicit `expired` / slow-tracking result and move to a recovery state offering **Try again**, **Camera placement tips** or **Back**. Progress must never sit at a fixed fraction indefinitely (D2).

Measured with the committed defaults, the supported observation rate floor is about **3 Hz** — 30 samples at 333 ms spacing completes at 9.67 s of the 10 s budget. 4 Hz completes at 7.25 s, 6 Hz at 4.83 s, 8 Hz at 3.63 s, 10 Hz at 2.90 s, 14 Hz at 2.57 s; 2.5 Hz and below expire. For scale, the app posts at most one frame per 70 ms, so the floor leaves wide margin for slower supported devices. This is an arithmetic bound, not yet a physical-device measurement.

Both tunables and the interruption/credit constants live in one configuration object read by the adapter and the controller. Adjust them only against measured results, and record final values in the verification note.

### Evidence quality

Observations are admitted with real capture timestamps. The adapter rejects non-finite timestamps, duplicates and out-of-order timestamps, and never counts the same capture twice. Freshness (§6) is enforced by the controller before the adapter sees the observation. A completed measurement is locked for the current source identity and re-validated at handoff.

### Visual treatment

Render a slow light sweep clipped to the guide with a progress border/ring driven by accepted progress. The sweep is decorative while measurements arrive, but it stops or pauses whenever measurement pauses, including during an interruption. Reduced-motion mode uses a static guide and a progress indicator without sweeping or pulsing movement.

The one-time transition to a body-proportioned outline happens once, on acceptance, and then freezes for the measurement stage (D6). It may use the accepted stable landmarks; it must not track live ones. Do not display skin/clothing reconstruction, biometric dots, body measurements, or claims of a detailed 3D scan.

## 9. Spoken guidance and sound scheduling

### Delivery

The first working release uses **browser speech synthesis** where available (D11). It is optional at the point of failure and never a dependency for completing setup: the visual surface and short non-speech tones carry the same information. No microphone permission is required for output. Prerecorded prompts may replace synthesis later once the assets and their usage rights are settled; no recording with uncertain rights ships, and audio assets must not block Phase B or D.

Handle these explicitly:

- synthesis unavailable, or no usable English voice → visual-only plus tones, with a calm note that spoken guidance is unavailable;
- `speak()` throwing or the utterance ending in error → the same "Sound couldn't play. Follow the guide on screen" state with Test sound/retry;
- the user muting at any point → stop active speech and drop queued prompts immediately;
- voices loading asynchronously (`voiceschanged`) → never block on availability at startup.

Initialize/unlock audio during the user's Test sound or primary-button gesture, including an actual playback attempt from that gesture where the platform requires it. Handle rejected playback explicitly. Never assume a toggle being on means sound was audible, and do not promise to detect physical speaker volume. If playback fails, show "Sound couldn't play. Follow the guide on screen" with Test sound/retry controls, and keep visual setup usable.

Audio failure must never block completion, block the countdown, or imply the user heard something they did not.

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
| Too large / cropped head or feet | "Step back so your head and feet are visible." |
| Measurement begins | "Good position. Hold still while we match your height." |
| Slow tracking (candidate expired) | "We couldn't measure your height. Check your lighting and camera position, then try again." |
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
- Coordinate with existing instruction sounds, metronome, countdown beeps, and optional speech recognition. Suppress overlapping setup/countdown audio.
- **Suppress, do not restart, recognition** (D5). While an app prompt is playing, ignore recognition results and keep the recognition session alive, plus a short trailing guard after playback ends so the prompt's own tail cannot trigger a command. `VoiceCommands.stop()` tears down the `Recognition` object and has restart-rate limits, so suspending per prompt would churn the microphone, risk `audio-capture` errors and disturb the user's enabled state. Preserve existing consent and enabled state; restore result handling only if recognition was enabled and still authorized. Readiness must never depend on the live recognition state.

## 10. Completion, countdown, and practice handoff

On verified success:

1. Lock the validated calibration result for the current source identity and retain the same camera stream/worker.
2. Show a checkmark with **Camera ready**; play one success chime/announcement if enabled.
3. Keep the success screen visible briefly, initially around 1 second. Wait for the short success announcement when enabled, with a bounded completion timeout (initial 1.5 seconds) so audio failure cannot trap the user or delay the start indefinitely.
4. Recheck that the camera is live, the source identity is unchanged, calibration is valid, tracking is current, and the §4 requirements are still confirmed. If readiness has been lost, return to positioning with an explanation rather than starting.
5. For `setup_only`, restore the paused workspace and stop here.
6. For an explicitly authorized start intent, restore the workspace and invoke its session start exactly once through the consumed handoff token.
7. The existing session owns countdown timing, displayed numbers, audio cue events, and the attempt boundary. Do not run a separate setup countdown timer or call playback directly after a fixed timeout. Countdown numbers, spoken countdown and beeps all derive from the same session state.

A guided handoff always uses **five seconds** (D10), including when the logged-in count-in preference is zero and including silent mode, so there is still preparation time. The preparation screen must say so before the primary action. Implement this as a one-start override — `start(secondsOverride?)` on `PracticeSession` — and never by mutating `countdownSeconds`, which is persisted on unmount and shown in settings. Subsequent repetitions and ordinary starts retain the user's configured countdown. Compete already uses five seconds through `CompetitionSession`.

`PracticeSession.start()` is currently not idempotent: a second call restarts the countdown and mints a new attempt. Add a guard so a duplicate start request while a countdown or attempt is already owned is ignored. This is the second of the three exactly-once protections in §6.

During countdown, auto-framing may reacquire according to its existing safe policy. Its display changes must not invalidate the physical calibration. A camera loss, stale tracking, navigation, backgrounding, explicit cancel, or relevant setup interruption cancels the pending start through session policy. Never silently resume a cancelled countdown.

Practice recording remains opt-in. Setup-and-start must not arm `recordNext` or start `MediaRecorder`. If a separate previously authorized recording flow is integrated later, preserve its explicit intent and current attempt-start hook.

## 11. Recovery, accessibility, and privacy

- Permission denial: explain camera access is needed; provide Retry and Back. Do not repeatedly prompt automatically.
- Tracker/model failure: show a useful failure state rather than an endless scan. Preserve existing watch-only access outside setup.
- Positioning difficulty: after approximately 20 seconds without useful progress, offer prominent help while keeping valid attempts possible. After approximately 45 seconds without improvement, stop repeating corrections and offer **Try again**, **Camera placement tips**, or **Back**. Do not silently force success.
- Slow or unclear tracking: a measurement candidate that cannot complete within 10 seconds ends in an explicit recovery state with the same **Try again** / **Camera placement tips** / **Back** choices. It must never sit at a frozen progress fraction, and it must never declare success from partial evidence.
- Multiple people/implausible pose jumps: invalidate candidate measurements and ask for one person in view. A single returned pose cannot prove no other person exists; avoid claiming reliable multi-person detection without adding that capability.
- Cancellation: always available, releases setup-owned timers/audio and, when exiting live practice entirely, the camera resources through existing cleanup. No automatic run begins afterward.
- Users unable to adopt the supported standing pose: state the current limitation plainly and offer watch-only/exit. Do not add a "skip and mark calibrated" control that incorrectly enables scoring. A supported seated/adaptive mode needs separate measurement and scoring design.
- **Temporary operator switch (D16).** Setting `CAMERA_CALIBRATION_ENABLED=false` on the API removes the guided surface entirely: entry starts the camera, the instructor uses a fixed default alignment, readiness no longer waits for a match, and nothing in the UI claims that height was matched. It exists so the rest of the product can be exercised where a full-body camera position is impossible; it is not a user preference and cannot be turned on from the client. Scoring is unaffected either way, because pose comparison never consumed the calibration. When the switch becomes unnecessary, delete it rather than leaving a second path.
- Use semantic headings, labelled controls, a progressbar with meaningful values, restrained `aria-live` stage changes, keyboard access, and visible focus. Maintain sound-off and reduced-motion paths with equivalent information.
- No setup images, voice recordings, landmarks, or calibration clips are uploaded or saved by this feature. Do not introduce analytics that contain camera content. Any optional diagnostic timing logs must exclude personal imagery and pose coordinates.

## 12. Implementation phases

### Phase A — state and measurement contracts

Define stage/intent/event types, structured assessment issues, complete source identity, observation admission and freshness, pause/credit/reset behavior, and exactly-once handoff. Add pure controller and estimator tests first. Preserve the existing calibration output contract or provide an explicit migration for every consumer.

Implemented in Phase A (see the [verification note](guided-camera-setup-phase-a-verification.md)):

- `assessStanding` rejects short arrays, missing required points and non-finite coordinates/confidence instead of throwing or becoming eligible, and returns structured `reason`/`detail`/`scale`/`edge`. The successful return contract is unchanged.
- `StableHeightCalibration` implements the §8 continuity policy with bounded storage and an explicit expiry outcome.
- `camera-setup-controller.ts` implements the stage machine, intent, source identity, admission, dwell, readiness recheck and a single-use handoff token.
- Pure tests cover synthetic timestamped sequences at 4, 6, 8, 10 and ~14 Hz, sub-threshold rates producing a recovery outcome, discontinuous timestamps, NaN/partial results, low confidence, loss at 99% progress, reacquisition, source changes, cancellation before asynchronous completion, duplicate completion, and invalid observations during `ready`.

Phase A deliberately does not change any user-facing flow. `PracticeSession`, `PracticeWorkspace` and `MimicInterface` are untouched; the new modules are reachable only from tests until the controller and measurement gates are verified.

### Phase B — silent visual flow

Build preparation, full-image guide, region feedback, measurement progress, completion, cancellation, and recovery. Wire them to real existing observations. Start with the portrait-phone / landscape-camera layout spike (D13) before animation work. Verify across camera aspect ratios before adding sound; no mock timer may stand in for measurement success.

Implemented: `camera-setup-guide.ts`, `CameraSetup.tsx`, the `.is-setting-up` shell state, camera
wiring in `MimicInterface`, entry intents and handoff in `PracticeWorkspace`, and
`start(secondsOverride?)` with a duplicate-start guard. The flow is now reachable from **Start
practice**, **Start scored run** and **Match height again**. See the
[Phase B verification note](guided-camera-setup-phase-b-verification.md) for what was and was not
exercised.

### Phase C — spoken guidance

Implement the speech-synthesis output, scheduler, sound test, mute, playback-failure fallback, prompt priorities, and the recognition output-suppression guard. Verify with playback rejection, missing voices, delayed completion and cancellation mid-prompt. Prerecorded assets are a later replacement, not a prerequisite.

### Phase D — session integration

Integrate normal practice, compete, and manual recalibration. Reuse the existing countdown owner, add the `start(secondsOverride?)` override and the duplicate-start guard, preserve recording intent, and keep camera resources alive across the setup/workspace transition.

### Phase E — verification and tuning

Run the automated checks and physical-device matrix below. Tune target guide size, issue hysteresis, speaking cadence, and progress behavior from actual use. Document final parameters and any untested device cases.

Add committed, repeatable browser regression coverage by extending `scripts/verify_camera_framing.py` (D12), which already mocks `getUserMedia`, the pose worker and the API — see §13.

## 13. Acceptance criteria and verification

| Scenario | Required behavior |
| --- | --- |
| User chooses Start practice | Setup is unmistakable; no moving instructor or attempt starts during positioning |
| User walks away from device | Spoken corrections and large guide make the next action understandable |
| Short/tall/wide/narrow body proportions | Useful valid positioning can succeed without exact outline overlap |
| Landscape source on portrait screen | Entire source remains visible; guide stays within the actual image; instructions use the margins; landscape offered, never forced |
| Missing head/feet/hands | Relevant region unconfirmed and one useful correction; no measurement success |
| Cropped head or oversized body | "Step back" or camera-placement correction; never "move closer" |
| Valid standing body | "Position found", then a distinct hold-still measurement stage; outline freezes at accepted proportions |
| Stable measurement at 4, 6, 8, 10 and ~14 Hz | Completes on both duration and sample count; slower rates take proportionally longer without stalling |
| Sub-threshold observation rate | Candidate expires at 10 s into an explicit slow-tracking recovery state, never a frozen fraction. Committed defaults support down to ~3 Hz (measured) |
| Stable measurement | Progress reflects accepted observations; success requires both duration and sample count |
| Brief invalid interval (≤600 ms) | Progress pauses; invalid frames/time do not increase accepted progress; first resumed observation credits no time |
| Sustained loss / changed posture | Candidate resets clearly; no misleading continuation from stale measurements |
| Completion | One checkmark/chime/announcement and one session handoff |
| Duplicate done events / rerenders / StrictMode | One countdown and at most one attempt start |
| Setup-only | Returns paused with no automatic playback |
| Practice/compete start intent | Five-second guided handoff even when the count-in preference is zero; the preference is not mutated; scoring begins only at actual attempt start |
| Loss during ready/countdown | Pending start cancelled or returned to positioning; no silent restart |
| Sound disabled, unavailable voice, or playback rejected | Visual setup remains usable; no deadlock, no overlapping prompts, no claim that guidance was heard |
| Page backgrounded / camera ended / Cancel | Existing camera suspension/cleanup applies; old speech and callbacks cannot start playback |
| Front-camera mirror toggle / rear camera | All markers map correctly, guidance is coherent, and rear-camera confirmation is required in preparation, invalidated by configuration change |
| Pane-only resize or orientation change | Guide recomputes; no physical recalibration |
| Source dimension, device or generation change | Candidate and calibration invalidated; returns to the appropriate setup stage |
| Recording / paired display | Existing explicit recording and raw-track behavior remain unchanged; setup starts no recording |
| Reduced motion / keyboard / screen reader | Equivalent stages and completion, usable controls, no frame-by-frame announcement spam; workspace inert behind the overlay |

Automated coverage must include synthetic timestamped pose sequences for all stages; discontinuous timestamps; NaN/partial results; low confidence; loss at 99% progress; reacquisition; source identity changes; cancellation before asynchronous completion; double success events; invalid observations during success/countdown; and stable streams at 4, 6, 8, 10 and ~14 accepted observations per second plus rates below the supported bound.

Browser checks must verify the actual rendered guide/contained-image mapping, mirroring, region states, semantic progress, audio scheduling/cancellation, blocked playback, and stream continuity. Include assertions that setup creates no practice attempt, score, or recording. These checks are committed and repeatable (D12): extend `scripts/verify_camera_framing.py`, which already provides the mocked camera feed, synthetic pose worker and API routing needed for a deterministic run. Document the dependency and the URL it expects. Do not add a separate component-testing framework unless a specific assertion cannot be expressed this way.

Run existing relevant unit/engine tests and frontend production build. A separate integration test should prove the same camera track survives setup-to-practice handoff and that practice/compete use only their existing session countdown.

Physical-device acceptance: desktop webcam, Android Chrome, and iPhone Safari where available. Test from across the room with sound on/off, bright/dim backgrounds, different body proportions/clothing, a poor camera angle, interruptions, and real positioning attempts. Record unavailable checks as outstanding; browser emulation is not physical-device verification.

## 14. Developer deliverables and completion

Deliver the implementation, the original SVG guide asset with appropriate usage rights, tests, and a verification note linked from this document. Spoken prompts are synthesized at runtime in the first release (D11); any later bundled recordings must ship with documented rights. Include screenshots of prepare, positioning, measuring, ready, and failure/help states, plus a short recording demonstrating the spoken sequence if available.

Document final thresholds/timings, supported languages and voice fallbacks, audio failure behavior, estimator continuity changes, and any device limitations. Keep the existing auto-framing verification intact and add regression coverage for the new setup interaction.

Done means a first-time user can understand and complete camera setup from a distance, receive truthful measurement feedback, and enter the intended session with an unmistakable countdown. A polished animation without validated measurements and reliable session handoff is not complete.

## References

- [Phase A verification](guided-camera-setup-phase-a-verification.md): contracts, adapter, tests and measured rates.
- Existing [auto-framing plan](live-camera-autoframing-plan.md) and [verification](live-camera-autoframing-verification.md).
- [Apple Face ID setup](https://support.apple.com/en-gb/108411): reference for distinct positioning, capture, and completion stages.
- [Apple Face ID technology](https://support.apple.com/en-gb/102381): explains the depth/infrared hardware distinction; not functionality claimed by this webcam feature.
