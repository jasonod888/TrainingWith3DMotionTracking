# Practice and Compete

Practice uses the published section boundaries, adjustable speed, repeats and optional live feedback. Watching works without a camera. Recording remains an explicit practice-only action.

Compete is a private personal challenge. Preparation requires a live camera, height calibration, compatible reference landmarks and a recent readable pose. A five-second countdown leads into the full published sequence at 1x, with no stops at section boundaries. Natural holds in the source movement remain. Navigation, speed, loops, original-video switching and observation angles cannot alter an active run. The instructor view is fixed at Front. Ordinary practice settings and position are restored when leaving Compete.

CompetitionSession owns run policy and results separately from practice history. Results are held in the open session only and are not posted to the practice-attempt API. No video recording starts in Compete.

Full-run scoring v1 measures approximate movement match using the existing pose comparison. It uses the raw comparison score in 100 ms timeline bins, rather than smoothing or averaging callbacks by frequency. A valid bin needs at least 75% joint coverage. Unobserved or unclear bins count against tracking coverage and do not contribute a zero pose score. Duration weights bins, including partial bins at section boundaries. An overall score requires at least 60% tracked time for the complete run and for every published section. The lowest reliably scored section is suggested for further practice. These thresholds are product rules, not validated competition judging standards.

Stopping, camera loss, recalibration, backgrounding, display interruption, a playback stall over one second, or a change to speed/mode/range/loop invalidates the attempt. A restart always begins at zero. Brief missing tracking can be tolerated, but insufficient coverage yields an unscored completion.

Validation: engine tests cover settings restoration, continuous section playback, duration weighting, missing observations and interruptions. `scripts/verify_compete_flow.py` checks camera preparation, locked controls, reliable and unreliable completions, result actions, return to section practice, backgrounding and mobile/desktop layouts with synthetic camera input. `scripts/verify_practice_flow.py` covers the existing practice and recording flow. Physical-device camera and tracking checks remain necessary before treating scores as comparable performance measurements.

## Publisher preview and session navigation

Feed cards open `page=preview`, showing only the publisher video, title/creator, duration, description, a tap-to-pause affordance, sound toggle, and the two mode choices. Playback loops continuously within `source_start` through `source_start + duration`, independently of teaching sections. Leaving or backgrounding pauses playback. Returning preserves the preview position; sound starts muted.

Lets Practice opens `page=practice`; Lets Compete opens `page=compete`. Neither navigation action requests the camera. Session Back returns to the preview, and preview Back restores the feed. Section recommendations in Compete results open the appropriate Practice section. In-session practice position, speed, ranges and repetition settings are retained while navigating between these screens.

Only video already authorized in the lesson manifest is requested. Existing public manifests intentionally omit private source footage; missing or failed video shows a thumbnail/unavailable state, with both modes still available. A separate publisher-approved public preview asset is not yet supported; this UI does not broaden media access or expose private uploads.

`scripts/verify_practice_preview.py` checks bounded looping, visible video frames, pause/mute, no camera or 3D on preview, session navigation, return position, unavailable media and responsive layout. Its local WebM test fixture avoids the bundled test browser's lack of H.264 decoding; product source videos are not converted by this change.
