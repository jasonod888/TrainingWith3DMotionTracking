# Piano review — final reachable control inventory

Route: **Piano review** (`page=music-review`, piano mode), focused shell. This is the
actual post-redesign home of each existing capability. It is an inventory, not a new
proposal.

## Waterfall guide

- Live falling guide above the keys, driven by the existing source clock and recorded
  occurrence intervals; no dedicated player or second clock.
- Click a guide block to select/pause through the existing note selection and open the
  contextual editor. Selected/sounding blocks use the existing blue/green language.
- Guide shows recorded start/length; held notes clip at the strike line; understated cue
  when upcoming notes fall outside the visible key range.
- No waterfall drag/resize, chord labels, inferred hands or reorder UI.

## Compact height-limited views

- Automatically active only when available height is <=560 px, including short desktop/
  zoomed windows.
- Visible accessible **Guide** / **Sheet** switch in the dock:
  - Guide = waterfall + keyboard.
  - Sheet = score, shared horizontal scrollbar, then keyboard.
  - Editing roll and the non-selected visual module are hidden; roll open preference is
    retained.
- Preference stored locally under `piano-review-compact-view-v1`, guarded against
  unavailable/invalid storage. Default Guide.
- Switching does not reset source time/play state, selection, edits, history, follow,
  roll preference, keyboard modes or the single video element.
- Place mode temporarily enters a dedicated compact `place` stage: waterfall, score and
  keyboard hide, the real editing roll fills the usable stage height, and Insert/Cancel
  live in a bounded non-overlapping inline panel (internal scroll at extreme heights).
  It returns to the chosen Guide/Sheet view without changing remembered roll state.

## Header and global route

- Back — returns to the library; warns when there are unsaved changes.
- Display-only title — underscores cleaned for display; the saved/source title is not
  mutated.
- Truthful status — private draft / unsaved / saved / read-only, with detail tooltip.
- Undo / Redo — desktop header; mobile also in the note editor and Settings → view.
- Settings — tabbed drawer.
- More — More drawer (and mobile “More actions” in Settings → view).
- Return to correction — only in formatted preview.
- Review and save — header Save opens the modal; confirmation, dirty, read-only,
  conflict and server rules are unchanged.
- Notice strip — read-only, save/error/conflict, recovery, verification and mode
  notices stay outside hidden preferences.

## Playback dock

- Play/Pause — strong primary control; one source clock. `aria-keyshortcuts="Space"`,
  title includes Space, and Settings → Playback & view documents it.
- **Space** — when the visible workspace is focused on a noninteractive background or
  music surface, plain Space toggles the same transport once and prevents page scroll.
  Repeats, modifiers, IME/composing, already-prevented events, inputs/contenteditable,
  links/buttons/role buttons/sliders, focused piano keys, native video, menus and modal
  review keep their native behavior. Focus/target outside the workspace, other app
  chrome and hidden/inactive workspace are explicitly ignored. Listener is removed on
  unmount.
- **Hands** — Settings → Playback & view shows blue Left, amber Right, grey-green
  Unknown and the model/baseline status, with an explicit Refresh estimate control.
  Estimates are applied as derived colours only; opening the lesson does not mark it
  dirty. The note editor exposes Left/Right/Unknown manual overrides and Auto reset.
  Manual overrides (including manual Unknown) are locked and undoable. A normal reviewed
  save materialises current estimates into the saved notation; model results are accepted
  only for the matching performance fingerprint and a failed request leaves the
  canonical baseline usable.
- Note-density overview — click seek, draggable visible window, keyboard range slider;
  endpoint labels removed because dock times own mm:ss.
- Elapsed / total time — mm:ss.
- Playback speed — compact visible value and accessible name.
- Original / Piano source audio — both buttons are always present. Original remains the
  safe default. In browsers with Web Audio, Piano defaults to the **Live grand piano**
  synthesizer, using Kong performance notes, velocity, sustain-pedal spans and audible
  string decay; when a verified WAV exists the Sound drawer also offers
  **Live grand piano / Rendered WAV**. JSDOM/no-Web-Audio hosts retain the verified WAV
  path. Live Piano mutes the video while active and restores its prior mute state on
  Original; it follows the single source clock and rate and never free-runs when paused,
  seeking, ended or stalled.
- Resume follow when manual browsing suspended; direction indicator.
- Video — bounded drawer preview; one persistent media element.
- Sound — always-available Original/Piano options, verified-WAV or live-grand-piano
  explanation, and verification/unavailable status. Live synthesis never free-runs when
  paused, seeking, ended or stalled; it follows the single source clock and rate.

## Keyboard

- Desktop/laptop with at least ~960 px available instrument width uses the fixed
  standard **A0–C8, MIDI 21–108** instrument: exactly 88 keys (52 white, 36 black).
  Range is independent of song/selection. Range buttons are hidden; a readable opaque
  range badge in the playback dock states `A0–C8 · 88 keys` without covering keys or
  guide notes.
- Narrow/mobile/tablet/compact landscape uses a bounded window of the same complete
  A0–C8 instrument (24/36/48 semitones for 25/37/49 visible keys). Previous/Next range
  controls pan by an octave within 21–108, disable at hard endpoints, and never seek,
  stop playback, change selection or edit history. Range label states the visible
  portion; A0 and C8 are both reachable. The narrow portion label is also the
  contrast-backed dock badge, never over the keybed.
- Labels use actual HTML type, show octave Cs plus both A0/C8 endpoints, and give middle
  C (C4/MIDI 60) a subtle dot. Keyboard and waterfall share the exact same range owner
  and lane geometry.
- Previous/Next range controls replace octave up/down in the focused workspace;
  standalone KeyboardEditor keeps compatible octave defaults unless a controlled range
  is supplied.
- Visible keys audition; selection and sounding states are distinct. Pointer/key strike
  position and meaningful pointer pressure set touch velocity (soft upper edge, louder
  front edge); keyboard activation uses 0.7. Sounding keys use the shared hand palette.
- Note Editor Preview/Audition passes the selected occurrence's recorded/edited velocity
  to the shared grand-piano voice.
- Explicit Choose on keyboard / Replace mode suppresses the editor so every visible key
  and both range controls are physically usable; visible Cancel instruction;
  commit/Cancel/Escape restore the editor.
- Mobile uses a reduced visible range with bounded panning; labels stay readable within
  the panel budget.

## Piano roll and staff

- Roll disclosure; closed by default.
- Add note menu — insert at playhead, insert into chord, place on roll. Rest insertion
  is explicitly unsupported.
- Note selection, drag/resize direct edits, snap, ghost/duplicate checks, shared
  timeline scroll, seek and activity highlighting.
- Continuous grand staff — selection/sounding/cursor distinction, note selection,
  sheet drag, shared scroll and seek.
- Formatted preview remains read-only and reachable from More.

## Note editor

- Compact mobile peek: note name/location, Preview, Edit note.
- Simple layer (all devices): Preview, Choose on keyboard, ± semitone, common written
  note values, Loudness, Timing & more.
- Advanced Timing & more: exact recorded start/length, spelling, written position and
  ticks, written-value scope, played-note/chord/tied scopes, Replace pitch and
  ♯/♭/♮, scoped Delete/Audition/Reveal.
- Mobile expanded editor includes Undo/Redo.
- Close/Escape returns focus to the selected note; committed edits are never reverted.

## Settings tabs and sections

- **Playback & view** — Follow playback, mobile Undo/Redo/More actions/speed, zoom,
  source-clock position, estimated/anchored alignment state.
- **Editing** — snap, sync offset, change counts, add controls.
- **Lesson** — teaching sections, assessment, verification findings, passages.
- **Advanced timing** — anchors (use current, tick, preview, apply), anchor undo/redo/
  reset/remove.
- **More** — formatted preview, history, reopen saved, MusicXML, reference download.
- Sound and Video open their own bounded sections; the drawer is nonmodal for the dock
  (aria-modal=false), and only one surface is open at a time.

## Recovery, errors and unsupported

- Local recovery offer/stale checkpoint, save failures/conflicts, read-only notice,
  verification attention and audio-unavailable states remain actionable.
- No publishing, sharing, autosave or second clock/media path.
- Rest insertion and ambiguous written-note ownership are explicitly explained rather
  than silently approximated.
