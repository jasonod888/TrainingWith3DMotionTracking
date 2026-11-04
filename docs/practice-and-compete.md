# Practice and Compete

Practice uses the published section boundaries, adjustable speed, repeats and optional live feedback. Watching works without a camera. Recording remains an explicit practice-only action.

Compete is a private personal challenge. Preparation requires a live camera, height calibration, compatible reference landmarks and a recent readable pose. A five-second countdown leads into the full published sequence at 1x, with no stops at section boundaries. Natural holds in the source movement remain. Navigation, speed, loops, reference switching and observation angles cannot alter an active run. Choose 3D, real instructor video, or 3D with a companion video before starting; the 3D observation angle remains Front. Ordinary practice settings and position are restored when leaving Compete. See `focused-instructor-video.md` for crop generation and media availability.

CompetitionSession owns run policy and results separately from practice history. Results are held in the open session only and are not posted to the practice-attempt API. No video recording starts in Compete.

## Viewing angle

The 3D viewing angle is a viewport control, not a Practice settings row. Front, Back, Left and Right sit in a labelled button group on the movement stage beside the instructor they rotate, so a change is visible while it is made. Pressing the selected angle re-centres the instructor after a manual orbit. The control is hidden for the real instructor, during TV presentation and in Compete, where the 3D reference stays at Front. Any angle other than Front pauses movement comparison, which the camera pane already reports in its tracking line. Practice settings keep no duplicate copy of the current angle.

The Practice settings drawer is a side panel rather than a modal one. Its scrim does not take pointer events and the stage behind it stays interactive, so the angle control, manual orbit and live preview keep working while settings are adjusted. It closes only from its own Close button or Escape, and a click on the model leaves it and its scroll position intact. The other sheets cover the stage, keep it inert and keep tap-outside-to-dismiss.

## Camera

Camera feedback is one control, not two. The Practice setup group offers Off, Front and Rear: Off means instructor-only practice, while Front or Rear enable camera feedback and pick that feed. Choosing Off stops the camera, any recording and screen sharing. Choosing Front or Rear opens that camera immediately, so the stage shows the real arrangement — camera pane, instructor and preview — while settings are still open, and practice stays paused until Play. Device and lens choices, which only refine the chosen feed, stay in the Camera & movement feedback group as Camera device. Everything that depends on a camera — arrangement, instructor emphasis, recording and saved summaries — reads its disabled reason from this single choice, so no copy refers to a separate "camera feedback" setting.

Which choices appear follows evidence, not the platform. Only a device label or a live track may claim a direction: counting cameras is not evidence, because a desktop can expose several video inputs that are all the same physical self camera (a virtual camera, an IR camera, a capture card), and a phone's labels are unreadable until permission is granted. Until a direction is proven the feed is offered as a neutral Camera, so a desktop never shows a Rear choice it cannot honour; a phone gains Front and Rear once its labels are readable, which happens as soon as a camera opens. The list is re-read when a camera starts and when the hardware changes. A saved rear preference is not rewritten when detection is inconclusive; the row falls back to Camera for display only.

Full-run scoring v1 measures approximate movement match using the existing pose comparison. It uses the raw comparison score in 100 ms timeline bins, rather than smoothing or averaging callbacks by frequency. A valid bin needs at least 75% joint coverage. Unobserved or unclear bins count against tracking coverage and do not contribute a zero pose score. Duration weights bins, including partial bins at section boundaries. An overall score requires at least 60% tracked time for the complete run and for every published section. The lowest reliably scored section is suggested for further practice. These thresholds are product rules, not validated competition judging standards.

Stopping, camera loss, recalibration, backgrounding, display interruption, a playback stall over one second, or a change to speed/mode/range/loop invalidates the attempt. A restart always begins at zero. Brief missing tracking can be tolerated, but insufficient coverage yields an unscored completion.

Validation: engine tests cover settings restoration, continuous section playback, duration weighting, missing observations and interruptions. `scripts/verify_compete_flow.py` checks camera preparation, locked controls, reliable and unreliable completions, result actions, return to section practice, backgrounding and mobile/desktop layouts with synthetic camera input. `scripts/verify_practice_flow.py` covers the existing practice and recording flow. Physical-device camera and tracking checks remain necessary before treating scores as comparable performance measurements.

## Publisher preview and session navigation

Feed cards open `page=preview`, showing only the publisher video, title/creator, duration, description, a tap-to-pause affordance, sound toggle, and the two mode choices. Playback loops continuously within `source_start` through `source_start + duration`, independently of teaching sections. Leaving or backgrounding pauses playback. Returning preserves the preview position; sound starts muted.

Lets Practice opens `page=practice`; Lets Compete opens `page=compete`. Neither navigation action requests the camera. Session Back returns to the preview, and preview Back restores the feed. Section recommendations in Compete results open the appropriate Practice section. In-session practice position, speed, ranges and repetition settings are retained while navigating between these screens.

Only video already authorized in the lesson manifest is requested. Existing public manifests intentionally omit private source footage; missing or failed video shows a thumbnail/unavailable state, with both modes still available. A separate publisher-approved public preview asset is not yet supported; this UI does not broaden media access or expose private uploads.

`scripts/verify_practice_preview.py` checks bounded looping, visible video frames, pause/mute, no camera or 3D on preview, session navigation, return position, unavailable media and responsive layout. Its local WebM test fixture avoids the bundled test browser's lack of H.264 decoding; product source videos are not converted by this change.
