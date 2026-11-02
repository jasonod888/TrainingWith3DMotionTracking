# Paired practice display and wide-camera implementation plan

Date: 2 November 2026  
Status: Implemented for a LAN-only milestone; automated checks pass, real-device
verification is outstanding. See
[paired-display-verification.md](paired-display-verification.md) for results,
the untested device matrix and the manual test script, and
[paired-display-connectivity.md](paired-display-connectivity.md) for
configuration and user instructions.

## 1. Product objective

Let a person place their phone in a stable position, choose a front or rear camera, and practise while watching their live camera feed and an animated 3D instructor together on a larger screen. The larger screen must adapt to its own available aspect ratio. The phone remains the camera and controller and can show a different interface.

When the person chooses a rear camera, prefer a wide or ultrawide lens when the phone's browser exposes a usable option. Preserve the complete captured view so the person has more space to move sideways and perform movements without presentation cropping.

Success means a working two-device practice experience, not simply a resized phone screenshot. Matching a TV's native pixel resolution is not a requirement.

### Objectives and measurable outcomes

| ID | Objective | Required outcome |
| --- | --- | --- |
| O1 | Independent larger-screen presentation | Receiver displays live camera and locally rendered 3D animation simultaneously; phone controls remain independent. |
| O2 | Adapt to the receiving screen | Layout responds to the receiver's usable viewport without stretching video, cropping the captured image, or distorting the model. |
| O3 | Clear camera choice | User can select front or rear camera before setup and change it through the camera settings. The app reports the actual selection or a clear fallback. |
| O4 | More visible movement space | Rear mode prefers an exposed, identifiable wider lens; users can inspect and manually select exposed cameras when automatic identification is uncertain. |
| O5 | Reliable session behavior | Camera changes, interruptions, and reconnections cannot reuse invalid calibration, show stale video as live, or accidentally start a session. |
| O6 | Verifiable delivery | Developer supplies automated results, real-device evidence, and a documented compatibility matrix, including ultrawide limitations. |

## 2. Scope and product decisions

### First release

- Extend the existing browser-based paired practice display and existing same-account approval flow.
- Support a receiver browser on a computer or other tested device; that device may be connected to a TV or monitor over HDMI.
- Direct smart-TV browser support is conditional on testing the specific TV/browser combination. A screen without an app or browser needs a connected receiver device.
- Default receiver view: two comparison panes. On a wide viewport, camera is left and instructor is right. On a narrow or portrait viewport, stack camera above instructor.
- Provide front/rear selection, best-effort rear-wide selection, manual selection of exposed camera devices, full-view framing, and correct camera switching.
- Include receiver-visible setup/readiness feedback so rear-camera users can position themselves while facing the larger screen.
- Preserve existing practice, competition, recording, permissions, and lesson access rules.

### Explicit exclusions from this release

- Native mobile/TV apps, automatic TV discovery, and a Google Cast/AirPlay device picker. Browser pairing must be named "Connect display" or "Practice display", not presented as a completed native Cast integration.
- A universal guarantee of ultrawide access on every phone/browser. If universal lens control later becomes mandatory, evaluate a native mobile capture app separately.
- Rendering at the TV's native 4K/8K resolution, transmitting a rendered 3D video from the phone, or encoding a combined camera/model video stream.
- New scoring algorithms, room mapping, depth sensing, physical floor anchoring, or an avatar that automatically follows the person around the room.
- New paired-display composite/overlay mode. Preserve the existing local composite mode; the first-release paired comparison uses separate panes. Reproducing composite remotely would need its own calibrated transform contract.

These are planning defaults that make the first release implementable. They do not change the core requirement to show both camera and animated model together.

## 3. Existing implementation to extend

Paths below are relative to the repository root. Findings describe the working tree reviewed on the date above, including ongoing local changes; recheck before implementation and preserve unrelated work.

| Area | Existing files | Current behavior and required change |
| --- | --- | --- |
| Receiver entry | `apps/web/src/LibraryApp.tsx` | Account screen includes "Use as practice display". Reuse this route and account requirement. |
| Pairing and sender | `apps/web/src/PracticeWorkspace.tsx` | Creates a code, approves a receiver, publishes playback state, and offers optional camera sharing. Improve the connection flow and stream lifecycle. |
| Receiver | `apps/web/src/MimicReceiver.tsx` | Receives WebRTC video, loads the lesson, and runs local playback. Camera is currently an inset rather than an equal comparison pane. |
| Camera and inference | `apps/web/src/MimicInterface.tsx` | Already uses `facingMode` or an exact `deviceId`, enumerates cameras after permission, and defaults capture requests to ideal 1280×720 at 30 fps. Add lens policy, selected/actual device state, and coordinated switching. |
| Rendering | `apps/web/src/MotionStage.tsx` | Three.js renderer responds to container resize; pixel density is capped. Reuse resizing and fit the model to its pane. Do not remove the cap just to match TV pixels. |
| Camera geometry | `apps/web/src/camera-framing.ts` | Central display-transform math exists. Reuse it for local full-view rendering and overlay alignment. Rear mode must not silently crop. |
| Setup | `apps/web/src/camera-setup-controller.ts`, `camera-setup-estimator.ts`, `camera-setup-guide.ts`, `CameraSetup.tsx` | Existing guided setup and source identity should remain the authority for calibration/readiness. Integrate with these, not a second setup state machine. |
| Contracts | `apps/web/src/mimic-connection.ts`, `apps/api/mimic_pairing.py` | Typed playback snapshot and authenticated, database-backed signaling already exist. Extend both sides together. |
| Presentation | `apps/web/src/practice.css` | Replace receiver inset styling with responsive comparison-pane styles scoped to the receiver. |

Important existing constraints: the receiver currently constructs `RTCPeerConnection` without configured ICE servers; the interface already notes that a relay is not configured. The phone currently stops its camera on page hide/backgrounding. Pairing approval and working live-video delivery are different states. Existing claim codes expire after ten minutes; approval extends the pair to two hours. Preserve these expiry rules unless a separate requirement changes them.

Related plans: `docs/guided-camera-setup-implementation-plan.md` and `docs/live-camera-autoframing-plan.md`. For this feature, rear full-view presentation must preserve the wider view, while front-camera auto-framing can retain its existing behavior. Keep guided setup's exactly-once start and source-validity rules.

## 4. Intended user journey

1. User opens a lesson on the phone and chooses **Connect display**.
2. Phone explains that the other device must open the app and sign into the same account. User creates a connection code.
3. On the receiving device, user opens **Use as practice display**, enters the code, and waits for approval.
4. Phone identifies a waiting receiver and asks for the existing approval. Camera sharing must be an explicit action or clearly included in a new, combined "Approve and share camera" action. Existing control-only approval must not silently start video sharing.
5. User selects **Front camera** or **Rear camera**. Rear mode defaults to **Prefer wide view**. Camera access is requested through the user's camera-start action.
6. After permission, app refreshes its device list. If a wider rear lens is identifiable and accessible, select it; otherwise use the available rear camera and show an honest fallback message. Manual exposed-device selection remains available.
7. Receiver shows the full live image beside the instructor. Phone and receiver distinguish "Display connected", "Camera connecting", and "Camera live".
8. User places the phone securely and completes guided setup while watching large instructions on the receiver. The phone stays awake, foregrounded, and unlocked.
9. The existing setup-and-start flow starts practice once, after its readiness checks/countdown. Playback commands on the phone apply to the receiver. Existing permitted receiver controls also work through the phone's authoritative session.
10. If the user switches camera or changes lens/zoom, pause practice, reacquire/replace the stream, clear old calibration, show the new view, and require setup again before resuming.
11. Disconnect or stop sharing immediately clears receiver video. Stopping display sharing does not implicitly stop local practice; stopping the phone camera ends its transmission as well.

## 5. Architecture and ownership

```text
PHONE / CAPTURE DEVICE                  RECEIVER DEVICE
Camera capture ---- WebRTC video -----> Camera pane
Pose inference                         Local 3D renderer <--- Lesson assets
Practice session -- state snapshots -> Local playback clock
Setup controller -- setup summary ---> Large positioning/readiness feedback
                 <- permitted commands Receiver controls
          \                              /
           Existing authenticated pairing/signaling API
```

The phone is authoritative for lesson position, speed, section, session phase, camera choice, calibration, and scoring. The receiver renders the lesson locally using the same lesson revision and projects the phone's playback state forward between updates. Receiver controls are requests to the phone, not independent changes to its playback authority.

Send the camera's media track, not a capture of the phone's UI or a cropped presentation canvas. Keep pose inference on the phone for this release. Transmit only bounded setup/status summaries needed for receiver feedback; do not add a second pose model on the receiver.

Keep the existing authenticated API for pairing, approval, playback snapshots, and SDP signaling initially. A WebSocket or WebRTC data channel is a possible later optimization, not a prerequisite. Do not route video through the ordinary API or database. TURN, when used, relays media transport separately.

## 6. Receiver aspect-ratio and rendering specification

### Layout policy

- Measure the actual presentation container, not the phone dimensions or advertised physical screen resolution.
- Use a CSS grid with two equal flexible columns when container width/height is at least 1.2; below that ratio, use two equal flexible rows. Treat 1.2 as an initial tunable layout constant and verify that the chosen panes remain usable.
- Header/status/controls occupy bounded space outside the comparison area. Use compact receiver controls and allow presentation chrome to hide during practice without making Exit/controls inaccessible.
- Use full available presentation space, with both panes allowed to shrink using `min-width: 0` and `min-height: 0`. Never hard-code 1920×1080, 16:9, or a phone aspect ratio as the outer layout.
- For camera video, set an explicit pane-sized video box and use `object-fit: contain; object-position: center`. Padding/letterboxing is expected when source and pane ratios differ. Do not stretch or use `cover` for the default full view.
- Apply rear non-mirrored and front mirrored defaults consistently. Mirror the image exactly once and keep instructor mirroring a separate lesson setting.
- Add a fullscreen action where supported, triggered by the user. Also work correctly outside fullscreen; do not assume browsers permit automatic fullscreen.

### Geometry and resize rules

For source dimensions `Sw × Sh` and pane dimensions `Pw × Ph`, the full-view fit is:

```text
scale = min(Pw / Sw, Ph / Sh)
renderedWidth  = Sw * scale
renderedHeight = Sh * scale
offsetX = (Pw - renderedWidth) / 2
offsetY = (Ph - renderedHeight) / 2
```

Use this same content rectangle for any receiver positioning guide or source-space overlay. Mirror coordinates only if the image is mirrored. Never independently fit video, guide, and landmark labels.

Use `ResizeObserver` for the 3D pane; update renderer dimensions and camera projection. Fit the instructor using bounds that include expected animation motion, so wide kicks/raised hands do not disappear at narrow ratios. Preserve reasonable margins. Pixel density and render quality can remain capped for performance; aspect-ratio correctness must not depend on native-resolution rendering.

On receiver resize/fullscreen, recompute layout and projection without reopening the phone camera, recalibrating, or restarting playback. A source camera/lens change is different and does invalidate calibration. Handle zero-sized containers during transitions without invalid projection values.

## 7. Camera selection and wide-lens policy

### State and UI

Maintain separate requested and actual camera state. Suggested fields:

```text
requestedFacing: front | rear
requestedLens: default | prefer-wide | explicit-device
requestedDeviceId: optional, local only
actualFacing: front | rear | unknown
actualDeviceId: local only
actualWidth, actualHeight
lensStatus: wide-confirmed | wide-requested-unverified | standard | unknown
sourceGeneration: monotonically increasing local source identity
```

Front/rear are the primary choices. Show **Rear wide camera** only when selection is supported by evidence, and **Rear camera — wide lens unavailable in this browser** only when that limitation is established. If uncertain, say **Rear camera — lens type not identified**. Avoid claiming a confirmed ultrawide lens merely because the user enabled the preference.

The advanced camera list displays browser-provided labels, with neutral numbered names when labels are absent. Do not fabricate lens names. Persist preferences locally, but revalidate device IDs on each start; permissions/device availability can change. A manual device selection overrides automatic preference until the user selects Auto/prefer-wide again.

### Acquisition algorithm

1. Check secure context and capture support. Request `audio: false` and obtain permission only in the explicit camera-start flow.
2. Reuse an existing permitted stream where appropriate. Otherwise request the selected front/rear facing mode with supported ideal dimensions/frame rate; do not bind dimensions to the receiver screen.
3. Enumerate `videoinput` devices after permission and refresh on `devicechange` where available. Before permission, labels/device lists may be incomplete.
4. For rear + prefer-wide, use an explicit user choice first; otherwise use browser labels and device evidence only to identify plausible rear wide/ultrawide candidates. Labels are localized and not a standardized lens taxonomy. Do not rely on array order, device ID text, or video resolution to determine field of view.
5. Acquire a candidate by exact `deviceId` when available. Inspect `track.getSettings()` and supported capabilities. Verify actual facing where exposed; if unknown, retain that uncertainty and provide preview confirmation.
6. There is no standard `facingMode: ultrawide` or portable field-of-view constraint. `environment` requests a rear-facing camera, not a particular lens. Do not promise universal browser access to every physical lens.
7. If zoom capability is exposed, show a bounded supported control only after checking capabilities. A reported minimum zoom or a numeric zoom below 1 must not be treated as proof of optical ultrawide selection. Do not synthesize a fake 0.5× mode by shrinking a cropped image.
8. If a preferred device disappears or cannot start, fall back to another usable rear camera after releasing stale capture resources, show the actual outcome, and keep manual selection available. If no rear camera works, report it and let the user explicitly choose front rather than silently mislabelling front as rear.
9. Treat permission denial distinctly from unsupported constraints/device unavailability. Stop retries on denial; do not cycle through all lenses or repeatedly prompt. Apply a bounded fallback chain and generation checks to prevent races.

Real-device evidence is required for lens classification. If a browser exposes only a logical rear camera, the app cannot promise control over hidden physical lenses. Document that result rather than treating it as an implementation bug.

### Switching transaction

1. Disable repeated switch/start actions while one switch is pending; pause practice/countdown and end any active recording segment cleanly through the existing recording flow. Never combine different source calibrations into one scored attempt.
2. Increment source generation, clear pending old observations, and invalidate calibration/readiness before displaying a new source as ready. Notify the guided setup controller using its source-change mechanism.
3. Release the previous track before reacquisition when required by the browser. Avoid opening multiple phone cameras simultaneously just to compare lenses.
4. Acquire and attach the new stream, wait for metadata/usable frames, update actual dimensions/facing/mirroring, then attach the same source to inference and remote sharing.
5. If camera sharing was already explicitly enabled for this receiver, use `RTCRtpSender.replaceTrack()` when compatible. If replacement needs negotiation, make a fresh, generation-tagged offer and process its answer. Do not require a new pair or renewed sharing action for an ordinary user-requested switch within that same approved session.
6. Keep the existing source lifetime/epoch protections. A late stream or worker message from a superseded request must be stopped/discarded immediately. A former track's `ended` event must not stop the replacement stream.
7. Receiver clears old live status while switching and reports readiness only after new frames arrive. User completes setup again; resumption is explicit or follows an already-requested setup-and-start intent exactly once.
8. If switching fails, keep the session paused and offer retry/restore-previous-camera. Restoring still requires fresh setup. Do not silently resume a scored run or recording.

Lens/zoom changes can invalidate calibration even when dimensions and `deviceId` remain unchanged. Treat app-controlled changes as source changes. Detect reported external changes where possible; instruct users to repeat setup after moving the phone or changing its view.

## 8. Movement space, tracking, and setup

- Rear mode defaults to full sensor-stream view at the presentation layer. Disable automatic digital cropping/zooming there so it does not undo the wider lens benefit. A browser may itself crop capture to satisfy constraints; avoid unnecessarily strict aspect-ratio constraints and verify actual field of view on hardware.
- Keep existing front-camera auto-framing behavior, with an explicit full-view option. Do not enable front auto-framing behavior on rear mode implicitly.
- The user may move laterally within the captured image after completing standing setup. Do not require them to remain inside the initial setup silhouette throughout practice.
- Preserve full-body tracking requirements: a wider image can make the person too small, and image edges can increase distortion. Use existing tracking quality/too-small/out-of-view feedback; do not relax scoring thresholds to make ultrawide appear successful.
- The phone remains physically stationary. Recalibrate after moving it or changing camera/lens/zoom. Ordinary lateral movement with adequate tracking does not itself trigger calibration each frame.
- Existing local overlay placement remains fixed unless its own product behavior changes. The paired instructor is in its own pane and does not claim to share the user's room coordinates.
- Show receiver setup stage, positioning hint, measurement progress, camera-ready state, and countdown. Use the phone's authoritative controller. Receiver rendering must not start a separate countdown or independently declare calibration complete.
- Send only the normalized guide geometry needed for receiver rendering, if a guide is shown. Include source generation and source dimensions; discard late setup summaries from prior sources. Distinguish camera unavailable from poor pose tracking.
- Preserve existing competition loss-of-tracking policy. When observations are unreliable, clear stale pose feedback and apply existing scoring coverage rules. Do not freeze the last good score and present it as current tracking.

## 9. Pairing, state, and transport changes

### Separate states

Represent pairing, permission to share, media connection, and tracking readiness separately. Suggested media states: `off`, `starting`, `live`, `interrupted`, `failed`. A successful pairing or an incoming `ontrack` event alone is insufficient proof that current frames are playing.

Receiver should handle `loadedmetadata`, autoplay rejection, mute/unmute, track end, connection-state changes, and absence of fresh frames. Provide a **Show camera** action if playback needs a receiver gesture. Keep video muted to avoid feedback; microphone capture is not required.

### Extend the existing protocol

Add bounded optional fields or introduce an explicit protocol version. Update TypeScript types and backend validation together; the current backend snapshot schema explicitly lists allowed fields, so a frontend-only change is insufficient.

Suggested additions:

| Field | Purpose |
| --- | --- |
| `source_generation` | Distinguishes current camera/setup source from an old stream. Separate from the existing fixed protocol `epoch: 1`; do not reinterpret that field. |
| `camera_status`, `camera_facing`, `lens_status` | Honest status on the receiver without transmitting device identifiers. |
| `source_width`, `source_height` | Normalized guide geometry and source-change handling; actual receiver video metadata remains the source for fitting decoded video. |
| `setup_phase`, `setup_hint_code`, `setup_progress` | Receiver setup feedback. Use bounded enums and finite progress values. |
| `guide` | Optional bounded normalized geometry required by the chosen setup visualization, not raw high-rate landmark arrays. |
| `signal_generation` | Associates an offer, answer, stream replacement, and retry with one negotiation. |
| `layout` | Only if users can choose layouts; otherwise keep the first-release adaptive comparison policy receiver-local. |

Preserve monotonic snapshot sequence numbers, bounded command queues, acknowledgements, access checks, pair expiry, revocation, and lesson revision pinning. Older/missing optional fields must produce safe defaults. A stale offer/answer from an earlier generation must not overwrite a newer connection. If signal generations require storage changes, include and test the corresponding migration; do not add a migration merely for optional JSON snapshot fields.

Clear sender/receiver tracks, video `srcObject`, timers, stale SDP, and live-state indicators on stop sharing/revoke/unmount. A replacement camera must never turn sharing on when it was off. Reconnection after explicit sharing withdrawal must require a fresh sharing action.

### Connectivity and recovery

Configure the same supported ICE configuration on both peers. Supply STUN and, for production reliability across restricted networks, authenticated TURN with short-lived server-issued credentials. Never embed permanent TURN credentials in frontend code. An initial LAN-only development milestone may defer TURN, but production completion must include relay testing or an explicit documented LAN-only release limitation.

Use bounded retries with backoff and a visible retry action. Handle prolonged receiver loss through the phone's existing pause policy; keep temporary interruption distinct from explicit disconnect. Receiver pauses its local animation on stale control state. A disconnect banner must not imply the old camera image is live.

Reuse current playback synchronization first. Measure control response and camera/animation timing separately: matching the phone's clock does not remove WebRTC video latency. If visual comparison is consistently offset, add measured receiver presentation compensation with documented limits; never alter phone scoring timestamps simply to hide display delay.

## 10. Implementation work packages and order

| Package | Work | Completion gate |
| --- | --- | --- |
| A. Baseline and contracts | Reproduce existing pairing/video on two devices; record current behavior; define camera/source/media states and schema additions; inspect existing local changes and related setup contracts. | A short baseline report and agreed field definitions. |
| B. Receiver layout | Replace inset with comparison grid; contain video; adapt to portrait/landscape; resize/refit 3D; handle fullscreen and media placeholders. | Viewport matrix passes with no image stretch/crop or lost model limbs. |
| C. Camera service/policy | Extract acquisition/selection logic into a focused testable module if needed; expose front/rear, wide preference, actual source, manual device list, bounded fallbacks. Keep one lifecycle owner. | Device selection/fallback tests pass; genuine-device preview confirms actual source. |
| D. Switching and setup | Coordinate camera switch with source generation, calibration, recording, competition, inference, and rear full view. | No stale calibration/observations or unintended resume after switching. |
| E. Receiver synchronization | Extend validated state; show setup feedback; replace/re-negotiate tracks; separate media-live from paired state; handle playback gestures and stop sharing. | Rear-camera setup and camera switching work without re-pairing. |
| F. Connectivity and recovery | Add/test ICE configuration, relay credentials if shipping beyond LAN, bounded reconnect, interruptions, revocation, page lifecycle. | Direct and required relay scenarios pass with honest failure states. |
| G. Verification and handoff | Run focused regressions, real phones/receiver tests, performance measurements, compatibility report, and user documentation. | Acceptance criteria below are demonstrated and limitations disclosed. |

Packages B and C can be developed independently after A, but integration must use one shared source/session contract. Do not replace the established practice session or guided setup controller with competing state owners.

## 11. Acceptance criteria

| ID | Test | Pass condition |
| --- | --- | --- |
| AC1 | Independent presentation | Phone controls and receiver layout differ; receiver displays moving camera video and moving 3D model simultaneously. |
| AC2 | Aspect ratios | At 16:9, 16:10, 4:3, 21:9, and portrait viewports, both panes fit without horizontal overflow, image distortion, or presentation cropping. Source images include corner/edge markers to prove full visibility. |
| AC3 | Resize/fullscreen | Changing receiver size/orientation/fullscreen preserves lesson progress and camera capture; model projection remains correct. No phone recalibration for a receiver-only resize. |
| AC4 | Front/rear | On a supported multi-camera phone, each choice opens the corresponding source and shows an honest actual selection. Rear is not mirrored by default; front is mirrored exactly once. |
| AC5 | Wide supported | On hardware/browser exposing an identifiable ultrawide lens, rear preference selects it or manual selection reaches it. At a fixed phone position, more of the room is visible than on the standard rear lens. |
| AC6 | Wide unavailable/uncertain | On hardware/browser not exposing a wider lens, rear capture works with a clear unavailable/unknown result. No false ultrawide/0.5× claim. |
| AC7 | Full rear view | User can move sideways within the captured view without the app digitally cropping them out. Existing tracking feedback correctly reports low confidence/out-of-view. |
| AC8 | Camera/lens switch | Active practice pauses; old calibration and pending observations are invalidated; receiver gets the new stream and correct mirror; setup is required before resume. Pairing is preserved. |
| AC9 | Source change with same dimensions | Lens/zoom change invalidates calibration even if width/height are unchanged. Rapid repeated choices cannot attach an obsolete stream. |
| AC10 | Rear setup from a distance | User can see positioning feedback, measurement, readiness, and countdown on the receiver and complete setup-and-start once without returning to the phone after positioning. |
| AC11 | Sharing permission | Pair/control approval without camera-sharing action sends no camera track. Stop sharing removes receiver video; subsequent camera switch does not re-enable sharing. |
| AC12 | Interruptions | Denied permission, missing camera, busy camera, backgrounded phone, receiver reload, failed media, and expired/revoked pair produce actionable states with no stale "live" image or unintended start. |
| AC13 | Existing session rules | Competition cannot silently continue as one valid scored run across a source switch. Recording is finalized/interrupted cleanly. Local-only practice still works. |
| AC14 | Synchronization | Start/pause/seek/repeat/speed/countdown changes apply once and converge on the authoritative phone state. Old snapshots and signal generations are rejected/ignored. |
| AC15 | Access and cleanup | Cross-account/unapproved/revoked access is denied. Tracks, workers, connection objects, observers, and timers are released on their owning lifecycle transitions. |
| AC16 | Sustained use | On each declared primary phone/receiver pair, complete a 15-minute practice session without an unrecovered failure or growing resource usage. Record camera fps, model fps, latency, and thermal behavior. |

Initial engineering performance targets for primary supported hardware: at least 24 displayed camera fps and 30 model fps during steady practice; phone-command-to-receiver response within 500 ms and typical glass-to-glass camera delay below 300 ms on healthy local Wi-Fi. These are proposed targets to validate during the first device spike, not claims about every TV or network. Report measured distributions/ranges and any deviations. Geometry, permissions, fallback honesty, and calibration correctness remain mandatory even on slower devices.

## 12. Verification strategy

### Automated checks

- Camera policy: missing/ambiguous/localized labels, explicit selection precedence, stale stored device IDs, unsupported constraints, permission denial, missing capabilities, and bounded rear fallback.
- Lifecycle: rapid switches, stale acquisition promises, obsolete track-end/worker callbacks, same-dimension lens change, sender replacement failure/renegotiation, no automatic re-sharing, and cleanup.
- Geometry: contain-fit rectangles, mirrored guides, portrait/ultrawide panes, zero-size transitions, and receiver resize without source invalidation. Reuse existing framing tests.
- Guided setup/session: source invalidation, remote action gates during setup, exactly-once handoff, recording termination, competition interruption, and stale observations.
- API/protocol: finite/bounded fields, stale snapshot sequences, old signal generations, approved/unapproved roles, revocation, expiry, pinned lesson revision, and safe missing-field defaults. Extend `tests/api/test_mimic_pairing.py` and existing infrastructure checks where applicable.
- Build/type check and focused frontend/engine suites through the existing `apps/web/package.json` scripts. Run the API pairing suite using the repository's established test setup. Expand testing only when changes affect additional areas.

### Real-device matrix

| Dimension | Minimum coverage |
| --- | --- |
| Phone browsers | iPhone Safari and Android Chrome on declared supported OS/browser versions. Record exact versions. |
| Camera hardware | A phone with physical ultrawide hardware; a phone/browser with only standard rear exposed; front camera; a single-camera or desktop fallback. |
| Receiver | Desktop Chrome or Edge, including HDMI to a TV; every directly supported smart-TV browser/device must be tested individually. |
| Network | Normal same-Wi-Fi direct path; restricted path/forced TURN if production relay is in scope; interrupted/recovered connection. |
| Display shape | 16:9, 16:10, 4:3, 21:9, portrait, and window/fullscreen changes. |
| Movement | Standing setup, lateral steps both directions, raised arms, wide stance/kicks, temporary edge/out-of-frame movement, and return to view. |

Browser mocks cannot prove physical lens selection, mobile camera switching, field of view, hardware decoding, or thermal stability. Save a short demonstration of the primary phone/TV flow and a compatibility table with separate results for rear access, actual wide lens access, camera switching, and receiver media/rendering support. Mark untested combinations as untested.

## 13. Delivery checklist

- Implementation in reviewable work packages with no unrelated changes overwritten.
- Updated connection and camera UI, with clear full-view and rear-wide fallback wording.
- Updated validated frontend/backend contracts and migration only if required.
- Focused automated test results and real-device evidence mapped to AC1–AC16.
- Configuration documentation for HTTPS, receiver access, STUN/TURN, and credential handling; no secrets committed.
- User instructions: connect display, approve sharing, select camera, position phone, complete setup, switch/recalibrate, stop sharing, and recover from common failures.
- Compatibility report distinguishing browser pairing from native casting and physical ultrawide hardware from browser-accessible lenses.
- Verification report listing measured performance and any remaining gaps. Do not claim completion solely because pairing succeeds or desktop simulated media works.

## 14. Technical references

These references support browser/API constraints; the product behavior and release choices above are proposed implementation decisions.

- [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — permission, secure context, constraints, and releasing resources when switching cameras.
- [MDN: enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices) — permitted device enumeration and label/access limitations.
- [MDN: facingMode](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode) — user/environment facing requests; not a lens-type selector.
- [MDN: getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities) — inspect track capabilities before exposing optional controls.
- [MDN: replaceTrack](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack) — replace a media source, with negotiation limitations and failure handling.
- [MDN: object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit) — preserve image proportions and fit the complete image with `contain`.
- [MDN: WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) — browser media/data transport.
- [Google Cast overview](https://developers.google.com/cast/docs/overview) — separate sender/receiver integration if native Cast launching becomes a later requirement.
