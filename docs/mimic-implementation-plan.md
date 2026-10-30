# Mimic Interface implementation plan

Status: proposed, 30 October 2026. Builds on `mimic-interface.md` and `mimic-competitive-review.md`. These phase numbers describe this Mimic upgrade, independently of the existing SaaS phase numbers. No application changes are authorized or implemented by this planning document.

## Product contract

The interface must be easy to operate both at arm's length and while standing far enough away for full-body capture. Simplicity includes visibility, reachability, clear state and predictable recovery.

- No vertical or horizontal page scrolling in setup, watching, practice or review. Do not meet this requirement by clipping content, shrinking text beyond readability or hiding needed actions.
- One viewport shell; a large movement stage; stable, labelled controls. Browser fullscreen is optional: the normal browser viewport must already work.
- Main actions remain visible. Secondary actions are one tap away; their actual settings take at most one further tap. A section picker may require paging/search and then selection.
- Use bounded, paginated panels for settings and section lists rather than growing the page or relying on a scrolling drawer. At enlarged text or short heights, reduce stage size and paginate controls/content. Test this explicitly.
- No gesture-only, hover-only or voice-only essential operation. Touch, pointer and keyboard must complete every task locally. A setup with an inaccessible phone must have an accessible control path before starting.
- Camera choice, selfie reflection, instructor-following direction and 3D viewing angle are distinct settings. Anatomical left/right always means the person's own left/right.
- Camera and microphone activation remain explicit. Watching requires neither. Recording is separately optional.
- Phone screen mirroring and an app-paired second screen are different experiences with different guarantees. Never label an unavailable capability as connected.

## Supported situations and proposed defaults

| Situation | Capture and display | Starting layout and controls |
| --- | --- | --- |
| Desktop/laptop | Front-facing webcam and same screen | Matched-height learner/instructor panels; pointer/keyboard; optional voice; alternate camera selection available |
| Phone, front camera, phone display | Same phone captures and displays | One shared stage with instructor beside learner; optional instructor-large/self-preview view; large touch controls and countdown |
| Phone, rear camera, no other display | Rear camera sees learner, phone screen faces away | Guided setup preview only until user confirms another visible display or assistance; do not suggest this is a usable solo visual-following setup |
| Phone, front camera, screen mirrored to TV | Phone captures; TV shows phone output | Large-screen layout manually selectable; establish controls before stepping away; local phone touch still works |
| Phone, rear camera, screen mirrored to TV | Rear camera sees learner facing TV; phone screen faces away | Placement guide; large-screen layout; configure voice, reachable remote or helper controls; countdown before user moves into position |
| Phone, either camera, app-paired desktop/receiver | Phone captures; receiver renders lesson and controls | Receiver-sized stage and keyboard/pointer controls; phone supplies capture/status and remains session authority |
| Watching without camera | Any supported display | Instructor dominates; full playback/navigation; no tracking prompts |

Front webcam and front phone camera are defaults, not restrictions. Detect available devices and remember a non-sensitive preference, but never silently resume capture. Screen size alone cannot identify casting or the user's physical position.

## Screen and interaction design

Use a compact header (Exit, lesson/section, connection status), an elastic stage and a fixed-height control dock. Two labelled rows on narrow screens are preferable to tiny icons or hidden primary actions. Reserve safe-area and browser-toolbar space. In short landscape views, move controls to a side rail. Choose layout from available width AND height, not a phone/desktop label.

Proposed visible actions: Previous, Play/Pause, Repeat, Next; section chip, Speed, View and More. More opens a bounded action panel with Camera, Sound/Voice, Loop, Feedback and Connect categories. Camera settings include device choice, preview reflection and recalibration. View includes layout, instructor angle, following direction and reset. Keep current values visible on the corresponding chips. Consolidate the current two settings panels.

Setup uses a few bounded steps: camera/display choice, position/readiness, controls and Start. Offer sensible defaults with a short path for returning users. Camera-free Watch remains available from each blocked setup state. During practice, pause before opening settings that obscure the stage; show Resume after closing. Cosmetic display adjustments may use a small non-obscuring panel. Never silently resume on closing a panel.

The first design output is annotated layouts for desktop, phone portrait, short landscape, large-screen mirror, and paired receiver. Include loading, permission denial, camera loss, tracking uncertainty, camera switch, connection loss, completion, enlarged text and long section names. Validate the defaults with users before making them permanent.

## Phase M0 — Design contract and capability experiments

Purpose: settle the interaction rules and prove the riskiest device assumptions before implementing the full flow.

Deliverables:

- Clickable screen layouts for all situations above, including novice users and learners who rely on visible text or keyboard navigation.
- Final control inventory, names, default layouts and bounded-panel pagination rules. Test whether learners understand mirror versus same-side following using an asymmetric movement.
- Define an explicit setup state model: idle/watch, requesting-camera, tracking-loading, positioning, calibrating, ready, countdown, playing, paused, loop-rest, reviewing, interrupted and error. Define allowed actions and cancellation at every transition.
- Short real-device experiments for front/rear capture, camera selection, orientation, screen mirroring, fullscreen, wake lock, audio activation and voice. Record capability results by device/browser; avoid assuming universal browser or TV support.
- Establish timing measurements: camera capture-to-feedback, casting lag, and sustained rendering/tracking on representative devices. Define and record numerical performance budgets after these measurements and before implementation acceptance.
- Define supported receiver scope: browser on a laptop/desktop first. Native TV casting receivers or TV browser support require their own validation and integration work.

Exit gate: every physical setup has a visible display, feasible control path and agreed fallback. Mockups pass a no-scroll review at small sizes and enlarged text. Device uncertainties are recorded rather than hidden in a generic Cast button.

## Phase M1 — Viewport shell and accessible controls

Purpose: deliver the no-scroll experience before adding more functionality.

Deliverables:

- Extract a practice shell containing the stage, status and shared transport from the current `LessonWorkspace`/`MimicInterface` split. Keep section editing outside practice.
- Allocate actual available viewport height, including dynamic browser chrome, safe areas and virtual keyboard. Let the stage shrink; prevent nested stage minimum-heights from overflowing the shell.
- Implement desktop side-by-side, compact shared-stage, instructor-large/self-preview, short-landscape rail and manually selected large-screen layouts.
- One labelled transport, section picker, direct speed access and consolidated paginated settings. Move Recorded test into diagnostics.
- Read-only practice navigation, keyboard focus management, visible focus, screen-reader labels, sufficient contrast and non-color status. Use at least 44 CSS-pixel touch targets and generous separation for critical controls.
- Focus mode, optional browser fullscreen and capability-aware keep-awake during active practice. Normal mode works without either API.

Exit gate: no page scrolling, clipping or unreachable controls at 320/360/390/768/1024/1440 widths, short landscape, browser-toolbar changes and 200% text sizing. All settings remain reachable without obscuring the only Pause control. Use pagination/search for long content; do not truncate essential meaning.

## Phase M2 — Camera setup, orientation and readiness

Purpose: make each camera/display configuration understandable and safe to recover.

Deliverables:

- Camera picker: front default; rear option on phone; actual device picker where device labels are available after permission. Treat requested facing mode as a preference and inspect the resulting track before claiming the requested camera is active.
- Preview and placement guidance specific to each setup. For rear-camera/TV use, verify the camera points at the learner and the learner faces a visible instructor display.
- Separate selfie reflection, instructor reflection/following direction and viewing-camera presets. Keep screen reflection out of stored pose coordinates. Make asymmetric L/R examples part of verification.
- Readiness checks for full-body visibility, stable framing and calibration; cancellable visible/audible countdown. Readiness alone never starts movement without a deliberate Start action.
- Camera switching pauses playback, cancels countdown, releases the old source as required by the device, clears stale scores and re-establishes tracking/calibration. On failure show camera-free Watch and an explicit retry rather than a frozen prior frame.
- Viewing-angle presets plus reset. For views whose target alignment is not yet validated, allow observation but disable misleading comparison with a plain explanation. Body turns inside the lesson and user orientation are separate from orbiting the viewing camera.

Exit gate: real front/rear tests on iPhone and Android; desktop webcam tests; deny/retry, camera removal, rotation and background/resume. No resource leaks or stale score. Learners can correctly describe which arm to move from the displayed instructions.

## Phase M3 — Hands-free repetition and basic large-screen use

Purpose: make practice usable once the learner steps away from the device.

Deliverables:

- Section loops, temporary practice ranges, optional repetitions and rest/countdown. Preserve existing step-and-hold behavior. Practice ranges do not modify published lesson boundaries.
- Extend commands with explicit start/resume, slower/faster and repeat/loop. Use an idempotent remote `pause` action, distinct from a local play/pause toggle. Every input path uses the same command validation and controller.
- Show recognized commands and listening status. Test speech with count-in/music, and provide complete keyboard/touch alternatives. Do not make microphone availability a condition of using a mirrored display.
- Screen-mirroring placement/help flow and large-text display preset; user confirms the image is visible and controls work. OS-level mirroring is user-established, and connection/latency status must not be fabricated.
- For rear-camera setups whose phone controls are inaccessible, require a tested voice path, reachable keyboard/controller, helper, or the paired receiver delivered in M4 before calling the setup ready for independent practice.
- Audio owner and output selection rules prevent duplicate count-ins. Mirroring latency is treated as a limitation for timing interpretation, not learner lateness.

Exit gate: learners can start, pause, repeat and advance from their full-body practice position with their chosen supported controls. Missing voice has a clear usable alternative. Countdown/loop actions cannot fire after exit, camera change or interruption.

## Phase M4 — App-paired large-screen display and remote control

Purpose: make phone capture with a separately rendered large display a first-class experience, especially when the rear camera hides the phone screen.

Deliverables:

- Pair phone and receiver through a short-lived QR/code flow. If the rear camera is already positioned and scanning is awkward, allow manual code entry before placement. Require approval on the camera device before granting receiver control or showing learner video.
- One capture device and one approved receiver for the initial scope. Phone is authoritative for capture, scoring and practice state. Receiver sends commands and renders authoritative state; it does not create a competing playback session.
- Versioned session messages: session epoch, revision, command ID, monotonic state sequence, playback anchor time/rate, range, pause/countdown status and capability flags. Deduplicate commands and reject stale epochs or lesson revisions.
- Use a session coordinator and real-time signaling endpoint. Estimate clock offset and network delay to schedule receiver playback against the phone timeline. Receiver loads the exact authorized lesson revision/assets and corrects drift within measured budgets. Live accuracy feedback is timestamped and suppressed when stale.
- Independent 3D rendering needs lesson/state data, not camera-frame upload. Showing the learner on the receiver requires an explicitly enabled video path, preferably WebRTC, with separate consent and a video-off option. Relay requirements, costs and network constraints must be assessed; no promise that every connection remains peer-to-peer.
- Show connecting/connected/reconnecting states and active controller identity. A receiver disconnect pauses the paired practice session on the phone; reconnection requires explicit Resume. Phone-local controls and Stop always remain authoritative.
- Session-scoped grants, bounded expiry, disconnect/revoke, origin checks and authenticated asset access. A pairing code must not turn a private lesson into a public share link. Do not place long-lived lesson/media credentials in QR codes or logs.
- Backgrounding the capture phone stops camera/voice and interrupts the session consistently with the existing lifecycle policy. Preventing display sleep does not justify unattended background capture.

Exit gate: front/rear phone camera plus a real desktop receiver; network loss, reconnect, sleep, stale/duplicate commands, expired pairing, mismatched revisions and revoked lesson access. Measure displayed motion versus scoring time, including video latency when enabled. If alignment is insufficient, hide precision timing feedback and retain useful watch/practice controls.

M4 is required for the complete product scope, not a decorative later casting feature. M1–M3 can be released incrementally for the configurations they actually support; they must not claim universal large-screen or rear-camera usability.

## Phase M5 — Trustworthy feedback and attempt review

Purpose: help the learner improve without distracting them during movement.

Deliverables:

- Separate tracking quality from movement similarity. Handle uncertain reference motion and insufficient learner coverage; do not show a low score where no defensible assessment exists.
- Show at most one stable, evidence-supported cue at a time. Use anatomical labels and visual markers together. Let the user reduce or hide feedback.
- Attempt boundaries tied to deliberate starts, selected ranges, interruptions and completion. Record lesson revision, scoring version, mirror/following settings, camera configuration and usable coverage with summaries.
- Bounded review state: one strength, one correction, Repeat this section and Next. Details use paginated panels within the viewport.
- Optional local learner recording with replay synchronized to reference timestamps. Explicit start/retention/delete controls, memory/duration limits, supported recording formats and safe interruption handling. Recording failure never blocks ordinary practice.
- Validate pose similarity and timing independently. Account for capture/render/network/display delay, particularly on a second screen. Sequence alignment must not erase the timing errors a timing score claims to measure.
- Experiment with an aligned ghost only after registration is reliable. Keep a clear separate-view fallback.

Exit gate: representative human evaluation across correct/incorrect poses, different bodies, turns, occlusion and speeds. Record false corrections and false praise. Establish acceptable rates with instructors before presenting cues as coaching. Do not promote approximate similarity into technique correctness through wording alone.

## Phase M6 — Useful extensions and release qualification

Purpose: add value around a proven practice loop and validate the complete system.

Candidates, in demand order: optional musical count-in/metronome, dance-specific eight-count markers, personal attempt history, suggested sections, and simpler content import. Generic movement sections remain supported. Automatic beat/section suggestions remain editable.

Qualification includes novice usability sessions; keyboard/screen-reader/enlarged-text checks; sustained ten-minute and longer thermal/performance runs; both phone cameras; front webcam; mirrored screen; paired display; slow network; interrupted permissions; revoked access; reconnect; and revision changes. Reuse and complete the existing physical-device checklist. Adapt 3D quality/tracker frequency within measured budgets and show degraded capability honestly.

Proposed usability targets: at least four of five first-time pilot users start their first practice without verbal help; every participant can find Pause and Repeat; all essential actions can be completed from the selected practice position. These are pilot gates, not statistical proof of best-in-class status.

## System design boundaries

- **Practice shell:** layout, focus, panels, accessibility and user-facing states.
- **Practice session controller:** source lifecycle, readiness, countdown, interruption, loop and attempt transitions; delegates actual lesson time to the existing Playback controller. State is event-driven, with cancellation on generation changes; avoid independent React timers for each control.
- **Capture/tracking adapter:** camera device, worker, confidence and calibration. Keep the existing generation-based cleanup; do not duplicate it for casting pages.
- **Orientation model:** capture coordinates, preview reflection, following transform and viewing camera, explicitly represented and independently tested.
- **Reference renderer:** 3D/video presentation and projection. Keep per-frame rendering out of React state; reference adapters use the shared lesson timeline.
- **Feedback engine:** versioned pose/timing calculations, confidence and cue selection, independent of display layout.
- **Connection adapter:** local-only, OS-mirrored guidance, or paired receiver. Capability and connection state drive UI; no user-agent guesswork.
- **Persistence host/API:** saves preferences, allowed progress and later optional attempt summaries. Private camera frames and recordings stay local unless a clearly chosen feature sends them elsewhere. Settings such as preferred layout may persist; camera permission use, active recording, voice and calibration do not auto-restore.

Add session-scoped pairing endpoints/grants and real-time transport in M4. Add attempt-summary persistence in M5 only if enabled. Ordinary loops/view settings do not need backend schema changes. Preserve immutable lesson revisions, account authorization and the single reusable MimicInterface for owned/shared lessons. One learner with two devices is not a synchronized multi-learner classroom.

## Delivery discipline and dependency order

M0 → M1 → M2 → M3 → M4 → M5 → M6. Begin physical-device validation in M0 and repeat the relevant checks at every phase; do not postpone mobile discoveries until final QA. Feedback experiments can occur earlier, but release waits for valid orientation and timing.

Each phase delivers working UI, necessary shared-controller changes, focused behavioral checks, real-device evidence and an updated capability matrix. Use feature switches for incomplete pairing/feedback capabilities, with existing camera-free practice as the fallback. Do not release partially working controls as enabled options. Maintain a readable migration path from existing progress and lessons.

Effort estimates follow M0's device/receiver experiments. Pairing and valid feedback are substantial engineering work and should not be estimated as small UI changes. Keep explicit release gates rather than assigning unsupported dates.
