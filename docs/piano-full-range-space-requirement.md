# Full piano range and reliable Space playback — worker requirement

Project D:\3d_trainer\developement. Implement both items below, preserve all accepted waterfall/UX work and pre-existing uncommitted changes. Codex plans/reviews; DeepSeek implements application code and focused tests. No commits, push, new dependencies, separate player, backend/schema changes or unrelated redesign. Latest independent full baseline552/552 passed120s/build pass; no need fullsuite for this bounded change.

## 1. Standard88-key piano

- Desktop/laptop normal width (use deliberate threshold around1024px available INSTRUMENT width) defaults to full A0–C8, MIDI21–108 INCLUSIVE: exactly88unique keys,52white36black, no pitches outside this range.
- Range is fixed and musically named, independent of song min/max or selection. Full range applies to keyboard AND waterfall, using existing shared geometry. No notes fall outside the standard piano range visually; genuinely non-piano source notes outside21..108 retain honest out-of-range cue and their data is not altered/deleted.
- Keep current taller natural key proportions, thin separators, HTML labels actualfont sizes, keyboard activation/audition/explicit pitchChoose/Replace, selected/sounding states. Label octaves and both A0,C8 endpoints; subtle middle-C (C4/MIDI60) indication using label/mark, never permanent sounding/selection highlight. Do not colour all Ckeys or add loud text.
- Mobile/narrowtablet/compactlandscape: complete logical A0–C8 instrument remains available, but do NOT squeeze88tiny keys into360px. Use a pan-able visible range of comfortably usable keys with accessible previous/next range controls (existing octave controls can become bounded panning) and/or real horizontal pan. Every piano key includingA0andC8 must be reachable. All pan/resize changes keep waterfall and keys on EXACT same pitch lanes. If using bounded visible-window rendering, it still represents the full88instrument; no arbitrary MIDI0..127 octave jumps. Clamp windows correctly at boundaries (A0 neednotC-aligned). Clear unobtrusive range label so user knows visible portion, no misleading claim full88visible onmobile. No zoom UI required for this task.
- Desktop fullrange needs no misleading octavebuttons that suggest pitches outsideA0–C8; hide or meaningfully repurpose them. Narrow pans must not seek/stopplayback/change selectedpitch/editdocument/history/follow; resize preserves state and usesfullrangeonwidescreens, sensible remembered/current view whennarrow. Keyboard and waterfall share one range owner; no independent panning or remountedmedia.
- Preserve Guide/Sheet compactmodes and normal waterfall→keys→collapsedroll→sheet ordering. Contextualeditor/modebanner must not block actual keytargets/viewportcontrols.
- Keep standalone KeyboardEditor consumers compatible; apply fullpiano policy intentionally at focusedworkspace or opt-inprops, do not silently change unrelated editor defaults if unnecessary.

## 2. Reliable desktop/laptop Space Play/Pause

Current workspace has no explicitSpace transportshortcut: it only appears to work whennativefocusedPlaybutton/video receivesSpace. Add deliberate workspace keyboardshortcut through SAME toggleTransport and authoritative nativevideo clock/followlogic. No newtimer/clock, duplicatedtoggle or separateaudio.

Behavior:
- With piano workspace active/visible and focus on page background, sheet/roll/waterfall background or another noninteractive workspace surface, plainSpace togglescurrenttransport exactlyonce and prevents page scroll. It should work after openingpage (before clickingPlay) and after pointer navigation among musicareas, not depend onPlaybuttonretainingfocus.
- Ignore repeatkeydown so holdingSpace doesn'trapidtoggle. Ignore modifiersCtrl/Meta/Alt/Shift, IME/composing, alreadydefaultPrevented events. Cleanlistener on unmount/norouteleak.
- Respect input/textarea/select/range sliders/contenteditable (includingeditableancestors), links, buttons and interactive widgets/menus soSpace keeps native meaning. Do NOT takeSpace from focusedpiano key: its Enter/Space audition/Choose semantics remain. ExistingPlaybutton remains nativekeyboardactivatable once (avoid global+native doubletoggle). Nativevideocontrols should retainbrowserhandling; don't doubletogglevideoevents. Exclusion logic must handle SVG targets/rolebutton/slider aswell asHTMLElement controls.
- ModalReviewSave/confirmation, other modal dialogs and active textediting never triggerbackgroundplayback. Respect context rather than blindly binding all windowSpace. Nonmodalpanel/form controlinteraction remains normal. No playback from outsideworkspace/otherapp routes.
- Use current media.paused/currenttransport rather than stale capturedplayingstate; paused→play resumes temporarily suspendedfollow usingexistingpath, explicitlydisabledFollow staysdisabled. Media unavailable/playrejection handled through existingtransport; don't inventfakeplaying.
- Expose discoverable hint e.g.Playtitle 'Play (Space)'/Pause title or short Settingshint and aria-keyshortcuts='Space' on transport where appropriate. Keep accessible Play/Pause name stable for tests/screenreaders.

## 3. Implementation/verification contract

Inspectrelevant existingtests and code, implement coherentbatch, run focused meaningfultests ONCE after work; rerunaffectedchecksonly for actualfailures. Use maintained normal runner docs/frontend-test-workflow.md, selected --file; no broad journeys/fullsuiteperedit. Avoid DOMobjectequalassertions; useboolean checks. Typecheck/build once final if environment permits, reportpermissionblockeronceforCodex. No repeatedblockedcommands or allinone substitutedtestclaims.

Meaningfulfocusedcoverage:
- Geometry exactly21..108 inclusive,88/52/36counts, correct A0/A#0/B0/C1 edge andC8, sharedlanes and keycenteralignment.
- Narrow viewport allendsreachable/pansbounded; pan/resize keepsselection/edits/playback/media; actualusercontrols not syntheticonly.
- Space backgroundinitialplay,pause,afterclickmusicarea,holdrepeatignored,modifier/defaultPrevented/composingignored; focusedPlay/nativecontrols no doubletoggle; inputs/editor/slider/modal/pianokeyreserved; cleanup/norouteleak. Some canbeoneparameterizedtest ratherthanmanyredundantmounts.
- Preserve existing compact/keyboard modes; only rerun relevant files if changed.

Write .local/full-piano-space-progress.md at milestones (currentactivity,checks actualcounts/timings/exit,blocker,nextaction). Handoff .local/full-piano-space-handoff.md: exactfiles, decisionsincludingdesktopthreshold/mobilepanmechanism, checks, limits and concisebrowserrepro. STOP forCodexreview; don'tselfdeclarebrowserpassfromJSDOM. Codex monitors roughlyevery10min and independentlychecksdesktop88count/labels/lanealignment, mobilepantoA0/C8,actualSpace/typing/nativekeyhandling,viewportfit/mediaidentity. Usecontrolledfixturehelpers in.local if browseraccessavailable; neveroverwriteuserlessonforchecks.
