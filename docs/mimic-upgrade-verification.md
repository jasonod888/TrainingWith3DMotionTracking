# Mimic upgrade: implementation and verification

30 October 2026. Local implementation; no cloud deployment or native TV receiver installation. Phase names here refer to the Mimic implementation plan, independently of earlier SaaS phases.

## Phase status

| Phase | Implemented | Acceptance still open |
| --- | --- | --- |
| M0: design and capability work | Working responsive interaction design, explicit device choices, placement/controls guidance and state transitions | Observed novice-user sessions; real iPhone/Android/TV capability matrix and measured latency budgets |
| M1: viewport shell | No-scroll practice shell; persistent transport; direct sections/speed/view/loop; searchable, paginated sections; consolidated options; focus-trapped dialogs; short-landscape layout; fullscreen/wake-lock fallback | 200% text/accessibility audit and real virtual-keyboard/browser-toolbar checks |
| M2: camera/readiness | Front/rear/device selection; actual facing-mode inspection when supplied; independent preview/following controls; calibration/readiness guard; rear-camera control confirmation; view presets/reset; opacity/position; camera-free fallback | Real front/rear camera switching, orientation, occlusion and permission recovery on phones |
| M3: distant practice | Cancellable count-in, section/range loops, repetition limits, rest periods, extended opt-in voice commands, screen-mirroring guidance | Speech reliability with music; actual mirrored-screen latency and operation from a practice position |
| M4: paired display | Same-account temporary code, capture approval, revocation, receiver controls, bounded state/command transport, ordering/deduplication, connection interruption handling, view/reflection state, receiver countdown; opt-in WebRTC preview path | Separate physical-device synchronization; live preview transport; network recovery under real delay; TURN/relay deployment if required |
| M5: feedback/replay | Stable joint-comparison cue, clear-joint filtering, attempt-level aggregation, insufficient-evidence state, optional bounded local recording and reference replay, opt-in private account summaries | Real camera recording formats/timing; human validation across movement styles and bodies; technique/timing accuracy |
| M6: extensions/qualification | Manual metronome/eight-count display, editable tempo-based section suggestions, versioned personal history metadata, split loading of practice/3D code | Sustained physical-device thermal/performance tests, novice usability targets and full release qualification |

The software above is implemented, but the phases are **not fully accepted** while their real-device and human-evaluation gates remain open. Do not describe this as certified phone/TV support or validated technique coaching.

## Automated verification

- Frontend TypeScript check and production build passed.
- 21 current-app/controller/contract checks passed, covering countdown cancellation, idempotent Start, exact range bounds, rest/repetition limits, section navigation, low-confidence attempt summaries, manual phrase boundaries and resource cleanup.
- 30 shared prototype pose/label/voice checks passed, including opt-in extended commands without changing the prototype's default vocabulary.
- 54 API checks passed. New coverage includes pairing approval, same-account binding, single-use codes, token roles, expiry, stale-state rejection, command deduplication/acknowledgement and opt-in/idempotent practice-summary storage.
- Eight opt-in infrastructure checks passed against real local PostgreSQL and private object storage. Added concurrent receiver retry coverage verifies that PostgreSQL row locks enqueue one command. Fixtures create and clean up only their own generated records.
- Migrations applied locally through `0008`; readiness now checks the new tables.

The restricted execution environment initially prevented Python's local test-loop connection from opening. The affected API/infrastructure checks were rerun successfully with local networking enabled. No failed restricted run is counted as a pass.

## Browser verification

Using the local development application:

- Practice layout at 320×480, 360×640, 390×844, 844×390, 768×1024 and 1440×900: ten main controls present, no page overflow and no offscreen main buttons.
- All option categories and their pages inspected at 320×480; no offscreen controls or dialog overflow in the inspected states. Camera alignment was subsequently added as a fourth bounded page with two controls.
- Public demonstration opens without camera activation. The labelled development-only recorded-source diagnostic ran the real tracker, completed calibration and displayed approximate similarity. This is software exercise against a reference recording, not a live human/camera accuracy test.
- Active separate view at 320×480 kept camera/reference panels beside each other with matching bounds inside the stage, without page scrolling.
- Two browser tabs using an existing synthetic lesson exercised code creation, pending receiver state, capture approval, remote Start/countdown, Pause and receiver exit. The temporary pair was revoked on exit. No live camera, microphone, video preview sharing or learner recording was activated in these browser checks.
- Screenshots and geometry observations are under ignored `.local/qa/mimic-upgrade/`. They are local QA evidence, not portable assets required by the application.

Viewport emulation is not physical-phone testing. Same-machine tabs are not proof of separate-device clock alignment or TV latency.

## Operation

Run `.venv-saas/Scripts/python.exe -m alembic upgrade head`, rebuild the frontend and restart the local API. The identified local project API was restarted during this task; its existing listening scope was preserved. Existing lessons and accounts were retained.

Open a lesson for the new practice shell. More exposes Camera, Sound & voice, Loop, Feedback, Larger screen, Practice history, Recording and Rhythm. Direct controls expose section selection, speed, view and looping. Settings pause practice and never resume it automatically.

For a paired display, open a saved private/shared lesson on the camera device, choose More → Larger screen → connection page, and create a code. On the receiver, sign into the same account and choose **Use as practice display** in the library. Enter the code; approve controls on the camera device. Capture remains authoritative and must stay visible/awake. Explicitly resume after an interruption.

Codes have 48 bits of random entropy, are stored hashed, and expire after ten minutes without approval. Approved sessions expire after two hours. Tokens remain in memory and are stored hashed on the server. One receiver is allowed per pair; active sessions are bounded. All requests still require the account and existing CSRF protection for writes. Pairing does not grant access to a different account or bypass lesson revocation/publication rules.

State transport uses bounded sequential HTTP polling at approximately 300 ms plus request latency, with no overlapping requests. This is a deliberately simple initial transport backed by PostgreSQL, not an unimplemented WebSocket claim. The receiver extrapolates the authoritative lesson time between snapshots and stops advancing stale state. It is not a validated rhythm-assessment clock. A relay and production polling capacity need workload testing before a broad launch.

Live preview is separately enabled. The initial WebRTC path uses available host ICE candidates; no STUN/TURN service, relay credentials or native Chromecast/AirPlay integration is configured. Where direct connectivity fails, the reference and controls remain useful; the user can also establish OS-level screen mirroring. Camera video is not carried by the polling APIs.

Recording is opt-in, local/in-memory, bounded to two minutes or approximately 32 MB plus a recorder chunk, and removed on leaving the lesson. Replay uses the attempt's source start and playback speed; a speed command stops that recording to avoid silently changing its time mapping. Actual device recording alignment remains to be validated.

Saved account history is separately opt-in for future attempts. It stores summaries, configuration and lesson/scoring versions, not camera frames or video. History remains personal; teachers do not receive these scores through existing sharing summaries. Only matching configurations/ranges/revisions should be compared.

The recorded-source diagnostic is available only in development with `?diagnostics=1`, under the placement page of Camera setup. It is absent from ordinary learner settings and production builds.

## Intentionally gated or unimplemented parts of the broader roadmap

- A validated rhythm/timing score and technique-coaching claims require measured latency and human ground truth. Current similarity remains approximate.
- A precisely registered, accuracy-colored ghost requires alignment validation. The existing combined view and skeleton colors are not described as a validated error ghost.
- Universal casting, native TV receivers and network relays are separate compatibility/deployment work.
- Automatic beat detection and social-video-link import were candidates in M6, not assumptions required by the core practice loop; they are not implemented here. Manual tempo/phrase tools and file upload remain available.
- Real-device acceptance, accessibility enlargement, representative human feedback evaluation and sustained thermal/performance qualification must be completed before marking all phases accepted.
