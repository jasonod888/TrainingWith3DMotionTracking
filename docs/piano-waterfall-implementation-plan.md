# Piano review: integrated waterfall, keyboard, and adaptable layout

Status: approved user requirements; implement through DeepSeek in three gated phases.
Project: D:\3d_trainer\developement
Worker conversation: session-82e56a90-cf22-4a9a-9a52-9e47c2475e46
Codex is planner/reviewer. DeepSeek implements application code and runs focused tests.

## 1. Intended experience

A friendly musical stage with a plain warm-neutral background, restrained borders and shadow, coherent typography, and a polished keyboard. Take visual cohesion and natural piano proportions from the user's SheetVideo reference, without copying imagery, watermark, chord overlay, or decorative particles.

Default desktop/portrait section order is EXACTLY:
1. Waterfall (falling upcoming performance notes).
2. Piano keyboard directly touching waterfall's strike line.
3. Horizontal editing roll, collapsed by default.
4. Sheet music (continuous grand staff).
5. Existing persistent playback/seek dock outside the rearrangeable stage.

Waterfall and keyboard form one inseparable instrument module. Roll and score are separate modules, in that order. Preserve existing header, Settings/More, contextual editor, Review and save, one video, recovery and all editing features. No commits/push/deployment. No new audio engine, MIDI player, server endpoints or dependencies by default. Implement a small custom SVG waterfall based on existing live data.

Mobile landscape/short-height offers ONLY Guide / Sheet visual modes:
- Guide: waterfall + keyboard.
- Sheet: sheet music + keyboard (sheet ABOVE keyboard in this compact mode).
- Hide editing roll in both modes; retain its open state for return to regular layout.
- Compact dock contains visible accessible Guide / Sheet switch, play/pause, seek and time; optional controls remain reachable in Settings.
- Switching preserves source time/play state, selection, edits, undo history, follow state, open roll preference, and single video element.
- Guide is initial default. Remember compact mode choice locally as UI preference, separate from lesson data/dirty/save/recovery. Guard invalid/unavailable storage and SSR/test environments. Desktop does not inherit compact hiding.
- Detect limited available HEIGHT (proposed max-height560px), not orientation alone. Desktop short windows/high zoom also get a coherent compact view. Mobile portrait360x740/390x844 gets normal layout, with reduced budgets.

## 2. Non-negotiable invariants

Existing uncommitted work is accepted baseline; inspect git status, preserve all changes. Do not reset/revert/reformat unrelated files. Latest independent full run538/538 passed123s; a later new contextual regression also passed. Full runner now539 tests before this feature (discover actual inventory).

The authoritative editable document is state.document, including performance occurrences. Use occurrenceIntervals(document, offsetSeconds) / existing equivalent for id,pitch,start,end. Waterfall reflects recorded performance timing in source seconds, not quantized written ticks. Written-only spelling/duration changes must not invent a new performed duration. Global sync offset affects guide identically to active key highlights. Preserve overlaps, tied recorded attacks, same-pitch repeated notes, chords and held notes already sounding at a seek target. Never merge occurrence identity merely because pitch/start look similar.

Source video is sole clock. Use existing ClockStore/useClockTime to draw from absolute current seconds; requestAnimationFrame only mirrors media time. Never accumulate animation elapsed time or run an independent player/timer. Paused edits/seeks redraw immediately. Native video controls, rate changes, scrubbing, seek-box drag, toolbar play and temporary/explicit Follow behavior remain correct. A manually panned score may suspend follow; the waterfall remains a time guide driven by playback, not horizontal score viewport.

Single source-video element remains mounted across panels/modes/layout changes. No per-frame rerender of inspector/header or rebuilding entire score. Geometry/document indexes memoized by real dependencies; draw only visible notes including intersecting held notes. Stop animation when paused/unmounted, no duplicate subscriptions/leaks.

## 3. Layout/geometry architecture

Build independent instrument, roll and sheet sections with stable IDs and one default layout configuration. Keep musical state above them. Future reorder should change a layout descriptor, not music state. DO NOT implement drag handles, drag ordering, resize handles or layout customization UI now. Waterfall+keyboard stay grouped. Avoid premature generic framework or unnecessary extracted components.

Create a shared pure key-geometry calculation (pitch,white/black,x,width,range) consumed by keyboard and waterfall. One range/geometry owner for instrument module; exact lane/key alignment for black and white pitches. Reuse safe existing KeyboardEditor props/defaults for other routes or add optional controlled geometry/range; no regressions to standalone keyboard. Avoid two keyboards or a waterfall-generated duplicate keyboard.

Keyboard range remains stable during playback and ordinary selection; do not recompute base from selected note each frame. Establish practical range from lesson and viewport; explicit octave navigation updates keys AND waterfall together. A narrow viewport cannot show entire wide passage usefully: preserve tap targets, allow explicit octave navigation and give understated out-of-range cue when required. No silent omission suggesting every upcoming note is visible. Selecting an off-range note may reveal its octave intentionally, without resetting playback or causing repeated range jumps.

Fix current SVG distortion: do not stretch text with preserveAspectRatio=none. Key geometry scales responsively while labels keep actual11–12px+ type where shown. Use subtle key gradients/inset edge/shadow, thin separators, natural black-key lengths/widths; no photographic textures or heavy3D. Keep accessible keyboard activation (Enter/Space), existing audition/explicit pitch-pick behavior, focus indicators. Octave controls44px where space permits, at least comfortably usable; never obstruct keys with editor/banner.

Target desktop keyboard white-key height140–180px, responsive rather than arbitrary fullwidth stretch. Portrait keyboard100–130px if needed. Compact short-height80–110px if needed. Show a sensible number of keys for available width, not microscopic full88. These are budgets, not mandates to clip score/actions.

Normal viewport allocation: compact header~56px; dock~72px; instrument flexible waterfall plus keyboard; roll disclosure~28px (open roll bounded~120–160px); full sheet184px musical SVG plus small metadata. At1280x720 opening roll may reduce waterfall rather than hide staff. At360x740/390x844 prioritize readable sheet, playable keys, useful short waterfall; no document vertical scrolling at supported normal sizes. No giant empty band around a fixed-height centered score. Staff gutter and body use same coordinate and remain aligned. Hidden roll body must not reserve space.

Extreme short/high-zoom layout may use bounded internal scrolling for secondary editors, never make playback unreachable. Compact Guide/Sheet eliminates simultaneous roll+score+waterfall. Header/status/recovery notices must not silently cover stage/dock; include recoverable severe-error layout.

## 4. Waterfall rendering and interaction

Plain subtly tinted stage with faint pitch lanes/octave markers if useful, a thin clear strike line directly at keybed top, restrained rounded note blocks. Future notes descend; lower/start edge reaches strike line at onset; length is recorded duration. Sustained notes remain active until exact end and clip at key boundary. Neutral/soft green guide blocks, current sounding green/key highlight, selected blue (existing visual language). Avoid using left/right-hand colours unless actual hand/voice assignment is reliable; do not infer hands solely from pitch. No chord labels without reliable metadata.

Use configurable visible future time window (initial~4–6 source seconds, reduce if small stage); continuous absolute-time y positioning. Clamp/clip within stage. Grace/short notes get minimal visual height without altering true activation time. At rate0.5 animation should naturally move more slowly because media clock advances slower; no double rate scaling. Seek into sustained note shows remaining hold correctly. No video source: use existing fixture/manual clock, explain unavailable playback honestly.

Blocks carry stable occurrence IDs and use existing select(occurrenceId), opening same contextual editor and current exact-onset seek behavior. No drag/resize waterfall editing in this scope. Editing via score/roll/inspector immediately updates waterfall pitch/start/length/add/delete; undo/redo/recovery update same projection. Keep selected glyph visible when opening mobile peek, including actual clicked waterfall vs score/roll geometry. Existing keyboard Choose/Replace/Place modes must remain usable. If compact layout hides the editing roll needed for Place, provide deliberate temporary editing route/surface or switch with explanation; never leave an invisible interaction mode. Escape/Cancel returns prior context.

Reduced-motion: respect preference with a quiet/static upcoming guide or limited updates; preserve accurate current-key/time information. SVG accessible name and meaningful note selection; avoid thousands of tab stops/per-frame announcements. No colour-only selection (outline/shape) or decorative animation announcements.

## 5. Phases and gates

### Phase 1 — modular stage and shared keyboard geometry
- Inspect relevant source/default keyboard consumers and baseline; identify minimum changes.
- Implement pure geometry/range and controlled integration; improve keyboard proportions/labels.
- Introduce independent stage modules/default order, instrument shell with waterfall slot; preserve roll/score shared scrolling and gesture locks.
- No fake placeholder notes or final completion claims; a temporary empty waterfall slot may stay collapsed until phase2.
- Focused tests: geometry covers black/white alignment, boundaries and viewport/range; existing keyboard/source test(s), shell and key-mode behavior if changed. Tests must check behavior/math, not mirror CSS implementation.
- Typecheck and relevant focused tests once after coherent change. Handoff exact files, tests(count/time/exit), known transitional issues and browser check instructions. STOP until reviewer authorizes phase2.

### Phase 2 — live editable waterfall
- Implement visible-window SVG guide driven by authoritative intervals/clock, shared geometry, selection and current key activation.
- Handle pitch/start/duration/add/delete, undo/redo, offset, seek-held/chords/repeats, octave changes, pause/native play/rate, no source, reduced motion.
- Integrate regular preferred order and budget layout, useful waterfall space and full score.
- Focused tests for real geometry/time mapping and updates using controlled clock; one integration scenario checking edit+undo updates without media remount. Retain overview/follow checks only if their code changed.
- No independently scheduled audio/player. No rendered movie/export/retranscription.
- Handoff actual tests, browser checks/known limits, STOP for review.

### Phase 3 — compact modes, visual finish and final acceptance
- Add remembered Guide/Sheet compact toggle, correct visibility/order, safe state transitions and accessible controls.
- Final visual pass on regular desktop, portrait, short landscape; verify selected note panel, mode banner, octave controls, docking, errors/recovery, safe areas, correct readable labels and full staff alignment.
- Audit control inventory: no feature lost through hiding/reordering; update existing inventory/docs.
- Focused tests for switch persistence/state/media identity and transitions while selected/playing/in keyboard modes. Run build; ONE final full suite if environment permits (normal maintained runner,10min bound). Do not repeat full suite after cosmetic corrections.
- If worker environment blocks normal test/build/browser, report once and provide exact reproducible request for Codex. Do not retry blocked commands repeatedly or substitute all-in-one JSDOM runs to hide failures.
- Return concise final report/evidence and stop. Codex independently verifies before final completion.

## 6. Verification matrix and review evidence

Primary normal sizes1280x720,1366x768,1920x1080,390x844,360x740; roll collapsed/open. Compact740x390 and640x360 (zoom equivalent): Guide and Sheet. Check document fits, dock actionable, actual notes/keys/labels visible, frozen staff aligned. Measure real rects and hit targets, not only scrollHeight. Screenshots from real controlled long-lesson fixture with1338notes and true video; existing .local browser helpers demonstrate setup and intercepted saves. Add only small adapted checks needed for this feature. Do not run a huge exhaustive matrix every phase.

Final interactions: actual pointer note select, edit pitch+duration+undo, seek into hold, overview click+drag, octave change, native/toolbar pause/play, compact switch while playing, portrait/landscape resize, single video identity, mobile bass peek, explicit Choose on keyboard actual keys, save confirmation/error unchanged. Existing automated tests cover unrelated saved/conflict/recovery pathways; rerun only relevant tests unless final full gate. Final visuals must be inspected by reviewer, not declared polished from passing tests.

## 7. Efficient execution and progress contract

Use docs/frontend-test-workflow.md maintained runner from apps/web. Select --file (and --pattern when appropriate), concurrency1, per-test180s; no whole suite after every small change. Never assert.equal(DOMnode,null) or compare DOM objects directly: safe Boolean assertions avoid prior huge diagnostic allocations. No weakening tests/omitting original scenarios. Batch edits, run relevant checks once, investigate actual failure then rerun affected checks only. No unnecessary dependency installation.

Worker maintains .local/waterfall-progress.md after meaningful milestones with current phase, completed/pending, command timings/exit, blocker and next action. Per-phase .local/waterfall-phase-N-handoff.md reports concise actual evidence, never expected results as pass. Codex checks worker status/log tail approximately every10min if still running (not repeated detailed source reads); intervenes for stuck command, scope drift, repeated tests or actual issue. Each phase stops for review; no simultaneous worker turns, no multiple source editors. All work authorized through phase3 but next phase starts only after review. Do not stop for routine design choices already covered here.
