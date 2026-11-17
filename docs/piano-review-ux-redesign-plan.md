# Piano review: friendly listening and contextual editing

Status: UX audit and proposed design only. No application implementation authorized in this step. Codex authored this audit directly; no delegation.

## Product direction

Make this feel like a calm room for listening to and improving a piece of music inside Form, rather than a specialist correction application. The default task is listen, follow, select, and make a small adjustment. Powerful authoring remains available through clear progressive disclosure.

Retain the existing music document, commands, source clock, alignment, source audio verification, save/recovery rules, read-only restrictions, history and export. This is a presentation and interaction redesign, not a musical-data rewrite or new sharing/publishing flow.

## Observed problems

Audit used the current normal music-review route with the existing 1,338-note fixture, controlled API data and a fixture video. It did not alter a real lesson. Measurements below describe that fixture and viewport, not every possible lesson.

- At 1366×768, the keyboard starts at y=378, score at y=659 and overview at y=898, with the roll collapsed. Page height is 1,337px. Essential controls cannot be seen together.
- At 1920×1080 the keyboard grows to about 280px tall and the page remains about 1,334px tall. More width increases keyboard height instead of improving the usable workspace.
- At 390×844 the toolbar wraps to about 297px. The keyboard starts around y=681, score y=1,016 and overview y=1,265. The sticky side content puts the source video over the useful work area.
- Global search, Create and the persistent social-navigation rail use space without helping the current task. They also offer unrelated exits while a draft may be unsaved.
- The header presents file-like naming, note/event counts, selection IDs and change totals before the music. The title and next action have weak hierarchy.
- Many controls have the same small outlined treatment. Play has no stronger visual priority than export, reopening a revision, snap or alignment.
- Playback is distributed between the toolbar, native video controls, a range input and the density overview. The separate horizontal scrollbar is easy to mistake for another seek control.
- The permanent inspector is long and often empty. Source video, note details, insertion, alignment and history all compete for attention and make the page height depend on forms.
- Notes and keyboard are surrounded by repeated instructional paragraphs. Important hints compete with technical explanations instead of appearing when needed.
- Vocabulary such as occurrence, logical note, written event, ticks, velocity, anchored alignment and verification identity assumes specialist knowledge.
- The note inspector exposes pitch, spelling, score timing, recorded timing, written value and deletion scope at once. These are different concepts with different consequences, but the visual hierarchy treats them as peers.
- An explicitly disabled Piano preview and its technical explanation occupy permanent space, even when the only available audio is Original.
- Save is disabled behind an easily missed Reviewed checkbox. Change state, source clock, alignment state and general notices share a crowded toolbar.
- Selection, playback highlighting, keyboard audition and edit modes need a consistent visual language. A user should know which action changes a note and which only previews it.
- Current layout is vertically stacked and content-driven. Hiding controls alone will not meet the viewport requirement; the app shell and height allocation must change.

## Recommended default workspace

Use a route-specific focus shell. Preserve global navigation elsewhere in Form.

1. A compact header: Back, readable piece title, truthful private-draft/save state, Undo/Redo, Settings, More and Save. Collapse lower-priority header actions responsively, not the primary Save action. No global search, Create or permanent social rail on this route.
2. A height-capped piano keyboard with discreet octave navigation. Remove persistent paragraphs; provide a short first-use hint and contextual help. Do not display five tiny octaves on a phone.
3. A collapsible piano roll, closed by default. Its disclosure remains visible and easy to tap. Expanding it reallocates stage height rather than extending the page.
4. The continuous grand staff as the visual centre. Show key/time information quietly in the surface, without another panel heading and instruction paragraph. Keep readable note sizes.
5. One bottom playback dock: a strong Play/Pause button, elapsed/total time, note-activity overview/seek track, speed and a compact sound/video control. Keep it visible when editing or opening a drawer.

The overview is note density, not an audio waveform. Do not mislabel it or imply audio-derived data. Preserve click-to-seek, blue-box/visible-window dragging that moves playback, and follow-resume behavior.

The source video is a secondary viewing tool, available from a labelled Video control. Open a bounded preview panel; allow pinning on wide screens if useful. It must not automatically consume a permanent sidebar or cover the keyboard on mobile. Keep one source media element/controller and one clock; do not create a second player when changing presentation.

## Progressive disclosure and control homes

| Capability | New home |
| --- | --- |
| Play/pause, seek, elapsed/total time, speed | Persistent bottom playback dock |
| Original/Piano audio and volume | Sound control in the dock; show only selectable audio modes, explain unavailable Piano on demand |
| Show/hide roll | Visible disclosure on the roll surface; also available in View settings |
| Return to playhead / resume following | Contextual pill beside the timeline when browsing has suspended follow or the playhead is offscreen |
| Explicit Follow preference | Playback settings; preserve unchecked preference across play and seeking |
| Undo/Redo | Compact header actions with accessible names and shortcuts |
| Save privately / reviewed confirmation | Visible Save; a clear Review and save confirmation surface preserves the existing server contract |
| Unsaved, saving, saved, conflict and recovery | Quiet truthful status near Save; actionable errors/recovery surface visibly when relevant |
| Pitch, audition, common note values, loudness | Contextual note editor shown only after selection |
| Exact played timing/length, spelling, linked-note/chord scope, written ticks | Clearly labelled additional note options; never silently combine played and written timing |
| Insert note/chord, rest, duplicate and scoped deletion | Contextual note/add controls; keep explicit modes and existing edit commands |
| Zoom, keyboard range, continuous/formatted view | View settings; formatted preview remains a separate read-only viewing state |
| Snap and editing preferences | Editing settings |
| Offset, timing anchors, passage classification | Advanced timing settings |
| Teaching sections and assessment | Lesson settings |
| Verification findings/diagnostics | Advanced details; blocking/relevant problems also surface as an actionable message outside settings |
| History, reopen saved revision, MusicXML and reference download | More menu with clear labels; history/revision dialogs remain within the workspace |

Settings should have named sections/tabs, not one enormous unstructured drawer. Export and reopening a revision are actions, not preferences; More is a better home. Save and Undo must not be buried behind a gear.

## Note selection and editing

Recommend a stable, compact contextual drawer rather than a large floating window attached to a moving note. A moving playhead and narrow staff make a large anchored popup unreliable.

- Default: no inspector, no empty selected-note panel.
- Selecting a note keeps the existing pause/select policy and highlights the same selection in score, roll and keyboard. Open one note-editing surface. Do not open multiple popovers or jump focus unexpectedly.
- Desktop: a narrow right-side drawer within the workspace, approximately 300–340px. Keep the selected note visible when usable width changes by preserving its musical anchor, not its old pixel scrollLeft. Do not change horizontal geometry during an active drag.
- Mobile: a bottom sheet with compact and expanded states. Keep the transport accessible. The expanded state is for deliberate editing, not the initial reaction to every tap.
- First layer: note name and location, audition, semitone decrement/increment, note-value choices and Loudness. Use labelled controls, not a pitch slider with dozens of ambiguous positions.
- Secondary layer: played start/duration and musical value are separately named. Additional score position, spelling and scope controls retain the existing precise semantics.
- A keyboard pitch change requires an explicit Choose on keyboard action. Ordinary keyboard taps continue to audition/select. Show a clear temporary instruction and Cancel while that mode is active.
- Deletion must identify its scope in everyday terms and preserve the underlying occurrence/logical-note distinction. Dangerous multi-note/linked changes need a clear explanation before applying them.
- Closing the drawer does not undo already committed edits. For uncommitted field drafts, explicitly define Apply/Cancel. Escape closes the active surface first and returns focus to the selected note/control.
- Undo remains available after a change. Provide a short descriptive confirmation, such as Pitch changed to D4, without filling the screen with logs.

Do not expose a single generic Length control that ambiguously edits either performed duration or written note value. Do not turn gestures that currently edit exact recorded seconds into quantized score edits by accident.

## Viewport contract

The main workspace should fit the available viewport without vertical document scrolling at normal zoom and the agreed test sizes. Use the dynamic viewport height, flexible grid rows, min-height:0 on shrinkable regions and explicit height caps. Do not solve overflow by shrinking fonts or clipping actions.

Targets: 1280×720, 1366×768, 1440×900, 1920×1080; mobile portrait 390×844 and 360×740; a short landscape view. Account for browser chrome and mobile safe areas.

- Header about 56–64px; keyboard approximately 100–140px depending on available height; transport about 80–100px. The score receives the remaining space.
- The roll opens within that height budget. Use a compact roll height at short desktop sizes; keep a readable grand staff visible and do not let expanding a panel push playback below the viewport.
- A larger monitor should show more useful musical content or breathing room, not disproportionately tall piano keys.
- On phones use a suitable visible keyboard range and a compact score/roll arrangement. If a very short viewport cannot show both representations legibly, keep one active musical surface with an explicit Score/Roll switch. Preserve their common timeline and state.
- Overlays stay between the header and playback dock. One major overlay at a time; no floating settings/inspector/video stacks.
- Long advanced forms may scroll within their own drawer/dialog. The underlying music workspace stays fixed. At high browser zoom or with an onscreen keyboard, accessibility and reachable actions take priority over a literal no-scroll rule.
- Distinguish score browsing from playback seeking. Keep horizontal pan available via trackpad/scrollbar/appropriate touch affordance; style any scrollbar quietly without removing keyboard or assistive access.

## Visual direction

- Keep Form's warm, restrained character: light neutral canvas, dark readable music, muted green accents, gentle surface contrast, generous but economical spacing.
- Fewer bordered boxes. Group by alignment and spacing rather than nesting panel borders around every control.
- A clear, inviting primary Play/Pause control, approximately 48–56px on desktop, with proper focus and pressed states. Motion is subtle and respects reduced-motion preferences.
- One consistent selected-note treatment across views. Distinguish selection from currently sounding notes and the playback cursor using shape/outline as well as color.
- Readable interface text, comfortably tappable controls and visible labels for unfamiliar actions. Tooltips supplement labels; they do not carry essential meaning.
- Use mm:ss for ordinary playback time. Show milliseconds, IDs, ticks and diagnostic counters only where precise editing requires them.
- Rename headings in everyday language: Note details, Loudness, Timing, Your changes. Keep precise expert terminology available in advanced options and explanations.
- Do not add decorative social cards, comments, likes or feed controls to this workspace. Friendliness comes from clarity and responsiveness, not additional chrome.

## Save, errors and accessibility

- Keep Save visible and preserve the current private-save/review confirmation rule. If the only backup is local recovery, do not label it Saved or Autosaved to the server.
- An editing redesign must not introduce publication or change visibility. Saved privately and Shared are distinct states.
- Read-only mode remains unmistakable; hidden edit controls cannot accidentally become enabled through another surface.
- Save conflicts, failed audio verification, stale recovery and unavailable media remain actionable. A Settings icon must not hide a problem the user needs to resolve now.
- Dialog/drawer focus management, Escape, keyboard navigation, labelled icon buttons, touch targets and screen-reader announcements are part of acceptance. Do not announce the playback time on every frame.

## Suggested implementation sequence for later delegation

1. Route-specific focus shell and viewport grid; move existing views without rewriting their data/controller logic.
2. Consolidate transport and overview; retain one source clock and the accepted follow/seek behavior.
3. Contextual note drawer/sheet and discoverable Add flow; relocate existing controls to their documented homes.
4. Settings/More grouping, visible save/recovery handling and optional source-video preview.
5. Refine typography, spacing, color, responsive behavior and accessibility.

This is one integrated UX delivery. Avoid accepting a cosmetic reskin that keeps the same oversized toolbar/sidebar structure.

## Acceptance and focused validation

- Default view contains the title/header actions, keyboard, collapsed-roll control, readable staff and playback dock; no permanent technical forms or empty inspector.
- Core workspace does not vertically scroll at the agreed laptop/desktop sizes, with the roll both open and closed. No clipped controls on mobile or at high zoom; internal advanced-panel scrolling is allowed.
- Note selection/editing surfaces do not hide the selected note, create a second source clock, lose unsaved work or jump the timeline during a gesture.
- A control inventory accounts for every existing feature. All original note-edit, scope, alignment, verification, save/recovery, read-only, history and export behavior remains available.
- Preserve the accepted overview drag/click/keyboard seek, explicit Follow-off, native/toolbar play resumption, independent roll pitch scroll and formatted-mode lifecycle.
- Verify selected notes, unsaved changes, playing/paused, errors, recovery, read-only and unavailable-Piano states. Use controlled fixtures plus a real media element; do not modify user lessons during checks.
- Use the repaired focused test workflow during changes. Add only meaningful coverage for panel lifecycle, focus/escape, viewport fitting and preserved navigation/editing. Run the full web/engine suite once at final handoff, not after every styling edit.

## Completion boundary for this audit

This document and the accompanying design concept are a proposal. No application files were changed for the UX audit, and DeepSeek has not been asked to implement it.
