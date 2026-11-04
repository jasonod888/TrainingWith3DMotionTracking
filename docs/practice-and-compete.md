# Practice and Compete

Practice uses the published section boundaries, adjustable speed, repeats and optional live feedback. Watching works without a camera. Recording remains an explicit practice-only action.

Compete is a private personal challenge. Preparation requires a live camera, height calibration, compatible reference landmarks and a recent readable pose. A five-second countdown leads into the full published sequence at 1x, with no stops at section boundaries. Natural holds in the source movement remain. Navigation, speed, loops, reference switching and observation angles cannot alter an active run. Choose 3D, real instructor video, or 3D with a companion video before starting; the 3D observation angle remains Front. Ordinary practice settings and position are restored when leaving Compete. See `focused-instructor-video.md` for crop generation and media availability.

CompetitionSession owns run policy and results separately from practice history. Results are held in the open session only and are not posted to the practice-attempt API. No video recording starts in Compete.

## Stage controls

Everything that changes how the reference looks lives on the stage beside it, in four labelled groups: **Arrangement** (Together or Side by side, shown while camera feedback is on), **Instructor opacity** (only while Together is active, because that is the only mode where the reference overlays anything), **Follow direction** (Match or Mirror, always available in practice) and **Viewing angle** (Front, Back, Left and Right, 3D only). A change is visible while it is made, and none of them has a duplicate row in Practice settings.

The angle group re-centres the instructor when the selected angle is pressed again. It is hidden for the real instructor, during TV presentation and in Compete, where the 3D reference stays at Front. Any angle other than Front pauses movement comparison, which the camera pane already reports in its tracking line. Arrangement hides for 3D with the real instructor, for lessons without a transparent companion, and while the camera is off. Follow direction hides only where those choices are fixed: Challenge, TV presentation and camera setup.

The groups are separate pills rather than one bar, so they wrap above the dock on a narrow stage instead of shrinking their labels; on a phone the reference pane gives them a full row each.

On a phone the two panes stack instead of sitting in columns: camera above, reference below, split 2:3 so the instructor keeps the larger share. Half-width columns cannot hold a full body and leave a landscape camera feed in a narrow strip. Each pane then reserves only the space its own overlays need, because the old full-stage reserves left the model a sliver of the shorter pane. The stage controls rest with the other chrome after inactivity and wake on a tap, so they never sit on the feet during a repetition.

The Practice settings drawer is a side panel rather than a modal one. Its scrim does not take pointer events and the stage behind it stays interactive, so the stage controls, manual orbit and live preview keep working while settings are adjusted. It closes only from its own Close button or Escape, and a click on the model leaves it and its scroll position intact. The other sheets cover the stage, keep it inert and keep tap-outside-to-dismiss.

## Camera

Camera feedback is one control, not two. The Practice setup group offers Off, Front and Rear: Off means instructor-only practice, while Front or Rear enable camera feedback and pick that feed. Choosing Off stops the camera, any recording and screen sharing. Choosing Front or Rear opens that camera immediately, so the stage shows the real arrangement — camera pane, instructor and preview — while settings are still open, and practice stays paused until Play. Everything that only refines the chosen feed — Camera device and Similarity and cues — sits directly under the Camera row, so camera settings follow the camera choice and instructor settings follow the Instructor row. The preview overlays are not panel rows at all: mirroring, the skeleton and auto-frame sit on the camera pane itself, just under the feed they change, so their effect is visible while they are toggled. Auto-frame stays disabled there unless the front camera and Side by side are both active.

Position and height matching is not a permanent row. Setup runs before practice begins, so the row only appears when it still has a job: a server that performs height calibration, or a rear camera whose reachability must be confirmed. With calibration off and a front camera the row is absent, and the duplicate "End practice" it used to carry is gone — the dock owns that action.

Which choices appear follows evidence, not the platform. Only a device label or a live track may claim a direction: counting cameras is not evidence, because a desktop can expose several video inputs that are all the same physical self camera (a virtual camera, an IR camera, a capture card), and a phone's labels are unreadable until permission is granted. Until a direction is proven the feed is offered as a neutral Camera, so a desktop never shows a Rear choice it cannot honour; a phone gains Front and Rear once its labels are readable, which happens as soon as a camera opens. The list is re-read when a camera starts and when the hardware changes. A saved rear preference is not rewritten when detection is inconclusive; the row falls back to Camera for display only.

## Arrangement

Together draws the reference into the live camera image. For the 3D instructor the rig is placed from the learner's height calibration; for the real instructor the transparent companion is drawn at the same scale and floor line, so both references sit where the learner's body is rather than floating in a corner. Instructor opacity fades the reference for both.

The reference is positioned by dragging it on the stage: the pointer's horizontal position across the camera image sets its placement, for the 3D rig and the real instructor alike. Vertical placement follows the calibrated floor line and does not follow the pointer. There is no position slider; the stage itself is focusable, and the arrow keys move the reference in small steps (Shift for larger, Home and End for the edges), so placing it does not require a pointer.

Together is unavailable for the real instructor when the lesson has no transparent companion, when the browser cannot decode VP9 alpha (the app draws one frame and checks its alpha, falling back to Side by side rather than covering the learner), and for 3D with the real instructor, which stays Side by side. The remembered 3D arrangement is kept while the real instructor is selected.

Full-run scoring v1 measures approximate movement match using the existing pose comparison. It uses the raw comparison score in 100 ms timeline bins, rather than smoothing or averaging callbacks by frequency. A valid bin needs at least 75% joint coverage. Unobserved or unclear bins count against tracking coverage and do not contribute a zero pose score. Duration weights bins, including partial bins at section boundaries. An overall score requires at least 60% tracked time for the complete run and for every published section. The lowest reliably scored section is suggested for further practice. These thresholds are product rules, not validated competition judging standards.

Stopping, camera loss, recalibration, backgrounding, display interruption, a playback stall over one second, or a change to speed/mode/range/loop invalidates the attempt. A restart always begins at zero. Brief missing tracking can be tolerated, but insufficient coverage yields an unscored completion.

Validation: engine tests cover settings restoration, continuous section playback, duration weighting, missing observations and interruptions. `scripts/verify_compete_flow.py` checks camera preparation, locked controls, reliable and unreliable completions, result actions, return to section practice, backgrounding and mobile/desktop layouts with synthetic camera input. `scripts/verify_practice_flow.py` covers the existing practice and recording flow. Physical-device camera and tracking checks remain necessary before treating scores as comparable performance measurements.

## Publisher preview and session navigation

Feed cards open `page=preview`, showing only the publisher video, title/creator, duration, description, a tap-to-pause affordance, sound toggle, and the two mode choices. Playback loops continuously within `source_start` through `source_start + duration`, independently of teaching sections. Leaving or backgrounding pauses playback. Returning preserves the preview position; sound starts muted.

Lets Practice opens `page=practice`; Lets Compete opens `page=compete`. Neither navigation action requests the camera. Session Back returns to the preview, and preview Back restores the feed. Section recommendations in Compete results open the appropriate Practice section. In-session practice position, speed, ranges and repetition settings are retained while navigating between these screens.

Only video already authorized in the lesson manifest is requested. Existing public manifests intentionally omit private source footage; missing or failed video shows a thumbnail/unavailable state, with both modes still available. A separate publisher-approved public preview asset is not yet supported; this UI does not broaden media access or expose private uploads.

`scripts/verify_practice_preview.py` checks bounded looping, visible video frames, pause/mute, no camera or 3D on preview, session navigation, return position, unavailable media and responsive layout. Its local WebM test fixture avoids the bundled test browser's lack of H.264 decoding; product source videos are not converted by this change.
