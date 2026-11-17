# Correction editor: shared timeline and playback following

## Goal and completion contract

Make the continuous correction sheet and optional piano roll behave as one navigable musical workspace. During playback, the currently playing position must remain visible while Follow playback is enabled. When the roll is expanded, both surfaces must share horizontal positioning, zoom, navigation and one visible playback cursor.

Deliver the complete interaction, geometry and regression package. Implementation checkpoints are encouraged; partial checkpoints are not acceptance submissions. Do not change musical data merely to make the pictures align.

This is an implementation plan, not an implementation or a new acceptance decision. Preserve the accepted Phase 8 formatted-score baseline and existing unsaved work.

## 1. Scope

Included:

- One horizontal scroll owner for the continuous correction sheet and expanded roll.
- Shared musical-to-horizontal geometry, with recorded performance timing projected through the existing alignment.
- One playback-cursor overlay, driven by the existing source-video clock.
- Safe-area playback following, manual inspection, Resume follow and offscreen direction controls.
- Shared zoom, overview navigation, selection reveal and responsive resizing.
- Preservation of existing roll pitch/time/duration editing under the new geometry.
- Preservation of collapsed-roll state, vertical roll scrolling, read-only restrictions, save/export and formatted-mode lifecycle.

Excluded:

- Horizontal dragging of notes in the correction sheet. Sheet dragging remains pitch-only.
- New beat detection, transcription, alignment authoring, hand separation, MIDI/PDF export or engraver replacement.
- Paginated formatted-score automatic page following.
- Activating the inactive occurrence limit, deployment or release.
- Reopening the Phase 7 timing matrix without a demonstrated regression that warrants it.

The separately requested complete vertical-drag preview and clef/key/time repairs must remain intact. If still unfinished, track them explicitly as dependencies rather than silently claiming this navigation work completes them.

## 2. Existing implementation and why it needs restructuring

Relevant files under `apps/web/src/music/workspace/`:

| File | Current responsibility | Required direction |
| --- | --- | --- |
| `PianoWorkspaceHarness.tsx` | Owns time window, Follow, score targets, selection reveal, transport and alignment | Compose one timeline controller; remove competing horizontal writers |
| `TimeRoll.tsx` | Seconds-to-pixels, horizontal and vertical scrolling, roll gestures | Consume shared horizontal geometry; retain roll-only vertical pitch navigation |
| `ContinuousScore.tsx` | Measure-to-pixels, own scroll container, score cursor, reveal and linked scrolling | Consume shared geometry/visible range; stop owning horizontal scroll/cursor |
| `viewport.ts` | Seconds viewport helpers and separately padded score-coordinate helpers | Introduce one explicit, continuous, invertible musical layout contract |
| `ClipOverview.tsx` | Whole-clip navigation using seconds | Adapt source-time requests to the shared viewport |
| `clock.ts` | Frame-rate mirror of the video clock | Reuse; do not create another transport clock |
| `workspace.css` | Independent panel/scroll layout | Add shared horizontal viewport, pinned gutters and overlay clipping |

Existing Follow behaviour differs by surface: the roll periodically moves its time window, while the score receives tick targets and positions those near its left edge. They are linked by position but do not share a visible range or scale. Copying scrollLeft values or hiding one scrollbar is insufficient.

Existing `xForTick` also has internal measure padding. At a measure boundary, the end of one interval and the start of the next do not necessarily have a continuous x coordinate. Do not compose this unchanged with inverse gesture mapping and assume a continuous timeline.

Inspect the current branch before editing; code may have advanced since this plan was written. Adapt names, but retain the behaviour and invariants below.

## 3. Product decisions to implement

| Situation | Required behaviour |
| --- | --- |
| Initial load | Follow playback on; correction sheet visible; roll retains its agreed collapsed default |
| Start/resume playback with Follow on | Reveal current position once if necessary, then follow using the safe area |
| Normal playback | Cursor moves across a stationary view until the right threshold, then content scrolls beneath it |
| Manual horizontal pan/scroll | Suspend Follow immediately; preserve playback and allow free inspection |
| Playback started while manually suspended | Stay suspended; do not erase a deliberate inspection state |
| Follow explicitly switched off | Preserve this choice across pause/play; only explicit enabling resumes it |
| Resume follow or offscreen direction button | Enable Follow and reveal current playback position, without seeking |
| Pause | Stop automatic scrolling immediately and preserve current view |
| Explicit seek | Seek the existing video, reveal the destination once, preserve Follow on/off choice |
| Musical edit gesture starts | Freeze horizontal geometry and automatic movement before the first preview |
| Gesture ends or cancels | Leave Follow suspended for inspection; Resume follow is explicit |
| Only roll vertical scroll changes | Do not suspend Follow or horizontally move the sheet |
| Roll collapsed/reopened | Preserve horizontal view, selection, zoom, playback and roll vertical position |
| Formatted mode entered | Preserve editor viewport; stop its animation; retain existing pause/read-only/cancel policy |
| Return to correction | Restore exact viewport; do not automatically reveal merely because the mode changed |

Clarification of the earlier “start playback enables Follow” suggestion: starting ordinary playback uses Follow by default. It must not override a later deliberate suspension or explicit off choice. Otherwise users cannot inspect another passage while playback continues.

## 4. Shared coordinate system

### 4.1 Choose the sheet's musical spacing as the horizontal authority

The correction sheet remains the primary editing view. Both surfaces use the same x-for-musical-tick layout. The roll retains recorded attack/end timing, but projects those times into this layout. It will no longer have constant pixels per second.

Use the existing measure-density layout as the starting width policy. Do not introduce a second independently calculated layout for the roll. Apply one shared zoom factor to that layout.

Define timeline content coordinates without pinned gutters:

- `tickToX(tick)`: musical tick to content x.
- `xToTick(x)`: inverse, returning fractional ticks until a command explicitly snaps/rounds.
- `sourceSecondsToX(seconds)`: effective video seconds through alignment, then tickToX.
- `xToSourceSeconds(x)`: xToTick through the existing inverse alignment policy.
- `viewportX = contentX - scrollLeft`; screen x additionally includes the common gutter and viewport bounding box.

Keep source seconds, stored note seconds and musical ticks explicitly named. Existing alignment helpers apply the authored offset exactly once. Do not add offset both before and inside an offset-aware helper.

The current seconds-to-tick helper rounds to integer ticks. For display/inverse gesture geometry, introduce a tested fractional conversion following the same alignment segments and boundary rules; round only where an editing command or musical snap requires it. Do not globally change existing command rounding semantics just to implement viewport geometry.

### 4.2 Require continuity and inversion

For the first implementation, distribute ticks proportionally across each complete measure box, using shared boundaries for adjacent measures. Put leading/trailing content breathing room outside the measure map. Avoid independent per-measure start/end padding that creates jumps or dead zones.

For measure i, start tick t0, duration d, content start x0 and shared width w:

`x = x0 + ((tick - t0) / d) * w`

The end boundary of measure i and start boundary of i+1 must resolve to the same x. Renderer-only glyph offsets must not change the temporal anchor. Size measure boxes generously enough for symbols; preserve existing collision/readability requirements.

If existing notation constraints require additional spacing knots, use one shared strictly increasing tick/x knot table with a tested inverse. Do not introduce discontinuities, use notehead bounding boxes as time coordinates, or invent separate roll geometry.

Geometry APIs must define empty documents, invalid inputs, before-start/after-end values and zero-size measurement safely. Note pitch or display labels must not affect time inversion.

### 4.3 Recorded timing is not written position

- Sheet notehead x comes from written onset tick.
- Roll attack x comes from effective recorded onset through alignment.
- Roll end x comes from effective recorded end through alignment.
- Current playback x comes from the same frame-clock source time through alignment.

An attack can sit slightly to either side of the written note's nominal beat. Preserve this. “Shared timeline” means shared coordinates, not forced equality between recorded and authored values.

Do not move notes, quantize the document or modify alignment to improve visual overlap. A renderer can show legitimate disagreement in the data.

### 4.4 Held/explanation passages and out-of-map time

The alignment supports `held` passages: source time advances while the musical tick remains fixed. The seconds-to-tick mapping is therefore not globally invertible.

For this delivery, preserve that musical meaning:

- The shared cursor holds at that tick during an explanation; video/text time continues normally.
- Show a compact non-obscuring “Explanation · score paused” status while that passage is active.
- Label held-time boundaries/ruler markers; do not draw thousands of identical second labels at one x.
- Seeking that exact musical tick uses the existing earliest-matching-time policy. Retain video controls and clip overview for seeking within the explanation.
- If a recorded event maps to zero visual width, retain an accessible/selectable minimum-width marker. Store real start/end separately from its enlarged hit area. Do not silently omit the occurrence.
- A time/resize gesture whose candidate depends on an ambiguous held mapping must refuse the commit with a clear explanation; leave data/history unchanged. Do not jump it silently to the start of the explanation.
- Before/after aligned score time, clamp the score cursor, show a neutral “Outside scored passage” status, and retain whole-video navigation.

Do not expand held passages into a new score axis or rewrite alignment in this scope. If this policy cannot support an existing valid editing route, surface the exact case and resolve it explicitly before claiming completion.

If no valid alignment exists, use the project's valid estimated alignment where available. Otherwise show that coordinated musical navigation is unavailable and retain video controls; never fabricate a mapping, silently save a replacement alignment, or draw a cursor at an unrelated score location.

## 5. Layout: one horizontal scroll owner

Introduce a shared timeline frame, conceptually:

1. Pinned controls and shared timeline ruler.
2. Shared horizontal viewport containing equal-width roll and score content.
3. Roll-only vertical pitch viewport when expanded.
4. One overlay cursor clipped to the musical plotting area.
5. One horizontal scrollbar for this timeline.

Use one native horizontal scroll element as the authority. Both content rows must occupy the same horizontal origin and width. Pinned clefs/time/key and roll pitch labels live in equal-width gutters outside the musical viewport; neither may independently shift the plot.

The roll's vertical scrollbar must not shrink its horizontal plot relative to the sheet: reserve the same trailing scrollbar gutter for both, or put the vertical control outside their shared plotting width.

The overlay has `pointer-events: none`. It must not intercept note selection, dragging, ruler seeking or scrolling. Draw one x position across the active roll/score plotting bands; avoid drawing through controls, captions or the accordion heading. Separate clipped segments are acceptable if they visibly form one line and share one overlay calculation. Do not leave old child cursors underneath.

Keep the clip overview's whole-video range selector as navigation, not a second horizontal scrollbar for the expanded score/roll. Its displayed selection is derived from the shared viewport; it does not maintain another viewport state.

Keep the video and correction subtree mounted across formatted-mode switches. Native overflow dimensions can clamp scrollLeft while hidden; save and restore the controller's canonical scroll value after valid remeasurement, rather than trusting a hidden element's zero dimensions.

## 6. Controller and state ownership

Introduce a controller/hook such as `useSharedTimeline` and a pure geometry module such as `timeline-layout.ts`. Names are illustrative.

Canonical UI state:

- Shared zoom and viewport width.
- Canonical horizontal scrollLeft, clamped against shared content width.
- Follow preference: enabled/disabled.
- Follow suspension reason: none/manual-pan/edit.
- Active gesture lock and frozen geometry revision.
- Last measured nonzero width, current layout revision, mode visibility.

Derived state:

- Visible tick/source ranges, visible measure indexes and buffered occurrence range.
- Current cursor content/viewport x.
- Offscreen direction and whether Resume follow should be offered.
- Shared overview range and ruler marks.

Use explicit controller actions with origins: `manual-pan`, `follow-frame`, `seek-reveal`, `selection-reveal`, `overview-navigation`, `zoom`, `resize`, `mode-restore`. Only deliberate manual horizontal navigation should suspend Follow. A programmatically caused scroll event is an observation, not a new user command.

Do not rely solely on a boolean reset one animation frame later to distinguish origins. Browser event timing, inertia and resize clamping can outlast that window. Track commanded offsets and actual trusted input intent; consume programmatic scroll observations without creating feedback loops.

Manual intent includes scrollbar dragging, horizontal touch pan, trackpad horizontal deltas, Shift+wheel and focused horizontal navigation keys. Respect text inputs, sliders and other controls when routing keyboard events. Plain vertical pitch scrolling must not suspend Follow.

Remove competing writers: old roll window-follow effect, per-clock score targets, reciprocal onScoreScroll/changeWindow linking, child reveal scroll effects and duplicate cursor layers. Adapt their callers to one controller instead of running both architectures together.

## 7. Follow algorithm

### 7.1 Safe area

Let W be the usable musical viewport width excluding gutters. Let p be playback content x and s the canonical scroll offset.

- Desktop right threshold: r = 0.70.
- Narrow viewport starting value: r = 0.60, selected from the editor's measured width rather than device name.
- Left safety threshold: l = 0.15.
- Cursor screen position within the plot: q = p - s.

During continuous forward playback with Follow enabled and no suspension/gesture lock:

- While q is inside the safe area, leave s unchanged.
- Once q reaches rW, advance s with playback so q stays near rW.
- Compute `sWanted = clamp(p - rW, 0, contentWidth - W)`.
- Do not move backward during ordinary forward playback merely because minor clock jitter reduces p.
- At the end, clamping naturally stops scrolling while the cursor advances to the final event.

The threshold transition should be continuous: at q = rW the new scroll target is already the current s. Update the controller at the visual clock cadence. Avoid calling native `scrollTo({behavior: 'smooth'})` every frame; stacked smooth animations can lag indefinitely behind the cursor.

Use direct frame updates for normal following. If additional easing is necessary, bound it so it never lets the cursor escape the safety band. Prefer deterministic tracking over delayed cosmetic animation.

### 7.2 Discontinuities and reveal

Treat seeks, loops, replay-from-start, source replacement and large clock jumps as explicit discontinuities. Do not ease across a distant musical passage.

- If the new cursor is outside the viewport, reveal it once at approximately 25% width, clamped to content bounds.
- If already visible, preserve the viewport unless it is immediately outside the safe region and active Follow needs adjustment.
- Resume follow explicitly reveals if needed, then enters normal tracking.
- A valid held passage is not a stalled clock or a seek: keep its x fixed and show the passage status.
- Use media seek/loop events and controller intent where available; do not classify every sparse clock update as a seek solely by an arbitrary delta.

Respect reduced-motion preference: ordinary visibility following still works, but optional animated transitions are disabled. Do not use easing across large seeks even without reduced motion.

### 7.3 Pause, playback failure and mode changes

Pause stops scroll writes and preserves view. A failed `play()` must not leave the follow animation running as if media were playing. Formatted mode stops hidden timeline animation and preserves the current view. Returning must restore viewport before reacting to another playback action.

Changing playback rate uses the existing video clock; no independent distance-per-second accumulator is allowed. At 0.5x, 0.75x or 1x, cursor position still comes from actual media time.

## 8. User controls and interaction priority

- Label the toggle “Follow playback”.
- While suspended, offer “Resume follow”. If explicitly off, provide an “Enable follow” action.
- If the cursor is offscreen, show “Playing to the right →” or “← Playing to the left” while playing; use “Playhead” wording when paused.
- Direction action reveals/enables Follow, never seeks or edits.
- Avoid per-frame live-region announcements; announce user-triggered state changes only.

Priority, highest first: active musical transaction; deliberate user navigation; explicit seek/reveal/zoom command; automatic following. Cancellation and read-only guards must remain authoritative throughout.

Selecting an already visible note must not move the view. Selecting a remote note may reveal it once and suspend Follow so the selection is not immediately pulled away. Audition remains separate from video seeking.

Zoom is shared. Anchor on the pointer position for a supported pointer zoom, otherwise the visible playhead, otherwise the viewport centre. Preserve the same musical tick beneath the anchor. Zoom must not seek or mutate musical data. Refuse/defer zoom while an edit transaction holds frozen geometry.

Viewport resizing preserves a stable musical anchor and recalculates both surfaces together. With active Follow, keep the current cursor visible; while suspended, preserve the user's left-edge musical anchor as closely as clamping allows.

## 9. Preserve roll editing under nonuniform horizontal spacing

This is a mandatory migration step. The existing roll's `dx / pixelsPerSecond` helpers cannot remain after changing its scale.

At pointer-down, capture the note's true onset/end, pointer content x, shared scroll offset, layout/alignment revision and candidate state. Freeze horizontal layout and automatic scrolling until commit/cancel. Suspend Follow immediately. Cancel the transaction on incompatible resize, document replacement or alignment change rather than interpreting coordinates against a different map.

- Time move: derive the candidate onset by mapping `originalOnsetX + pointerDeltaX` back to source seconds. Then remove offset once to obtain stored onset. Preserve the original recorded duration.
- Resize: map `originalEndX + pointerDeltaX` back to source seconds, subtract unchanged effective onset, then validate the new duration.
- Pitch-only drag: preserve stored onset/end exactly.
- Snap in the existing intended domain. If snap represents musical subdivisions, snap candidate ticks before mapping to source seconds; do not approximate musical snap with one global seconds-per-tick across anchored tempo segments.
- Unknown durations retain existing default/export semantics; geometry must not write defaults into the document merely to draw a rectangle.
- Apply existing limits, conflict policy and bounds after conversion. Invalid/ambiguous candidates remain previews with clear feedback and cannot commit.
- No movement must produce no edit. Avoid round-trip rounding that creates a tiny accidental time change.
- Escape, pointercancel, lost capture, preview entry and unmount must cancel without history changes or late commits.

Do not add sheet horizontal editing during this migration. Preserve one gesture = one undo transaction and existing read-only protections.

## 10. Rendering and performance

Reuse buffered virtualisation. Derive sheet visibility from the shared x range; derive roll candidates from the mapped visible source intervals, including held-boundary cases and long notes crossing the viewport. Do not cull solely by note onset.

Precompute indexed layout/alignment structures by document/alignment/zoom revision. Binary search is appropriate for tick/x and visible measure lookup. Do not rebuild all measures, scan every note or rerender the inspector on every clock frame solely to move the cursor.

The small cursor/controller layer subscribes to the existing clock. Glyph layers rerender for visible-range boundary changes or actual edits. Dispose subscriptions/listeners/animation handles on unmount and source changes.

Performance qualification here is focused: use the real recording plus a synthetic large existing-range fixture, verify bounded DOM counts and absence of sustained scroll/cursor lag. Do not treat this as a request to repeat the complete Phase 7 timing matrix.

## 11. Implementation sequence

1. **Capture baseline and inventory writers.** Record commit/worktree status, existing mode/gesture policy and representative current behaviour. Preserve unrelated changes. List every code path writing horizontal position.
2. **Build/test pure geometry.** Continuous tick/x mapping, aligned seconds conversion, inverse policy, held intervals, clamping and zoom anchors. No UI migration before these contracts are clear.
3. **Introduce the shared viewport/controller.** Equal plotting origins, shared width/scrollbar, pinned gutters, roll vertical scrolling. Wire manual navigation before adding automatic follow.
4. **Migrate both renderers and gestures.** One layout for sheet/roll/rulers, recorded attack preservation, inverse-mapped roll editing. Remove old child scroll effects and duplicate cursors.
5. **Add the cursor and follow state machine.** Frame-clock tracking, safe area, seek handling, manual suspension, explicit resume, pause/end/rate handling.
6. **Integrate auxiliary journeys.** Overview, selection reveal, zoom/resize, accordion, formatted-mode restore, save/reopen and read-only policy.
7. **Qualify the final integrated build.** Automated geometry/controller/application tests, real-media journeys, visual captures and focused performance checks.

Make coherent commits/checkpoints. Do not seek acceptance after step 3 or 5 while editing or lifecycle behaviour is unfinished.

## 12. Acceptance tests and evidence

### A. Geometry and data integrity

- Tick/x round trip within a documented floating-point tolerance at every measure boundary and interior sample. No boundary jumps/backtracking.
- Timed source/x round trip within 1 ms before deliberate snapping, with estimated/anchored alignment and nonzero offsets. Do not use the existing integer-rounded tick helper for a precision-sensitive inverse without accounting for its quantisation.
- Held passages obey the documented non-inverse policy and retain access to their real source time.
- Corresponding tick anchors, gridlines and ruler positions align between roll and sheet within 1 CSS pixel after scroll/zoom/resize.
- A deliberately early/late recorded attack remains early/late relative to its written beat.
- Navigation/follow/zoom/collapse/pause/reveal do not change document, history, dirty state, saved checkpoint or authored metadata, and send no mutation request.

### B. Playback visibility

- Play through multiple screenfuls without touching a scrollbar: cursor remains in view and upcoming notes remain visible.
- Initially stationary view; tracking begins at the configured threshold without a jump back to the left.
- Assert visibility against musical viewport bounds and threshold against its usable width, not the whole panel/window.
- Shared cursor x is consistent with the source clock; compare frame-clock/media samples taken together, not a coarse text-clock display against a tighter tolerance than its refresh cadence.
- Pause freezes horizontal position. End-of-content clamps cleanly. Replay/backward seek reveals correctly.
- Test supported playback rates, held explanation time, empty/short clips and a long silent/intro interval.

### C. Manual inspection and controls

- Wheel/trackpad, touch pan, keyboard and scrollbar navigation suspend Follow without seeking.
- Playback continues offscreen during suspension; direction indicator is correct.
- Resume reveals and tracks without changing media time/rate/play state.
- Explicit off persists through pause/play. Manual suspension persists until explicit resume.
- Roll vertical scrolling alone does not suspend Follow or move the sheet horizontally.
- Programmatic scrolling never masquerades as manual scrolling or creates oscillation/feedback loops.
- Ruler/video/overview seek reveals once while preserving Follow preference. Overview range drag that only pans does not seek.

### D. Editing and lifecycle

- During a held note drag, no follow movement or geometry shift can occur under the pointer.
- Roll time/resize edits work across differently sized measures and alignment slopes; exact intended seconds/duration survive save/reopen and Undo/Redo.
- Pitch edits do not change timing. Sheet horizontal dragging remains unavailable.
- Late pointer-up after formatted entry remains refused. Gesture cancellations leave data/history unchanged.
- Repeated accordion and formatted-mode switches preserve selection, dirty state/history, shared scroll/zoom, roll vertical position and video identity/time/rate.
- Existing formatted rendering and MusicXML agreement remain intact; this layout is display-only.

### E. Responsive and visual qualification

- Desktop, narrow mobile portrait and landscape/browser resize; test actual usable plotting width.
- One timeline scrollbar and no independent sheet/roll horizontal navigation. No page-wide horizontal overflow introduced.
- Cursor never paints over pinned labels/controls or blocks input. Collapsed roll leaves one correct sheet cursor.
- Inspect beginning, threshold crossing, mid-follow, manual-offscreen, resume, final passage and held passage captures.
- Reduced-motion and keyboard operation work. Never claim physical-device qualification from emulation alone; record any unavailable hardware separately.

Run the ordinary suite, TypeScript/build and affected gesture, transport, viewport, save/reopen and formatted-mode regressions. Report actual results, including externally blocked checks. Do not weaken assertions to obtain a pass.

## 13. Required developer handoff

Submit one final commit identity and a completed checklist for geometry, shared navigation, follow state, gesture migration and lifecycle. Include:

- Brief explanation of state ownership and the removal of competing scroll writers.
- Evidence of continuous mapping and preserved recorded/written differences.
- Automated results for the acceptance groups above.
- Real-media playback capture covering several viewport widths plus manual suspension/resume.
- Desktop/mobile visual captures, including expanded and collapsed roll.
- Saved/reopened/edit/Undo/Redo evidence under the new mapping.
- Exact limitations, hardware checks not run and unchanged release/policy restrictions.

The completion goal is one coordinated timeline that follows the playing music reliably, lets the user inspect freely, and preserves all existing corrections and editing behaviour. Do not submit a cosmetic shared scrollbar while leaving different geometry, hidden playheads, broken roll gestures or competing scroll effects behind.
