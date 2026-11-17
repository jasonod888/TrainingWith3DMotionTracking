# Piano correction workspace — developer implementation plan

Status: proposed UX and engineering specification; no implementation authorised by this document.
Prepared: 13 November 2026.
Execution companion: [Phased delivery and review gates](piano-correction-workspace-phases.md). That document controls phase boundaries and handoffs; this document controls UX and musical behaviour. No phase has been approved merely by writing these plans.
Destination: the piano branch of `?page=music-review&id=…`, replacing the current “Edit proposed notes” forms.

## 1. Purpose and outcome

An instructor must be able to compare a transcription with the original recording, find an incorrect note, correct it visually, and save a consistent reference. The current interface presents up to 50 individual note forms per page and compresses the entire recording into a small preview. This makes note identification, timing correction and musical review unnecessarily difficult.

Replace that interaction with three connected views of one musical document:

1. Piano keyboard at the top.
2. Horizontally scrollable, zoomable piano roll in the middle.
3. Horizontally scrollable sheet-music strip below it, with treble and bass staves together.

The original video remains visible beside the workspace. A shared selection, playback position and edit history connect everything. Editing any note through any supported surface updates the other views and the saved performance.

Correction layout is deliberately continuous. After finalisation, the same document is rendered as formatted sheet music with wrapped systems and pages. These are two presentations of one document, not separately maintained note copies.

## 2. Confirmed requirements and proposed defaults

Confirmed with the product owner:

- Keyboard above the piano roll; sheet music below the roll.
- Both roll and sheet music scroll horizontally in correction mode.
- The whole recording must not be squeezed into the editing viewport.
- Shared playhead lines, corresponding note highlights and synchronised navigation.
- Editing through the roll, staff and keyboard.
- Staff pitch dragging, written duration buttons, sharps/flats/naturals.
- Keyboard-assisted replacement of a selected note, with selection reflected elsewhere.
- Finalised sheet music receives a conventional formatted presentation.

Defaults specified below are implementation proposals: Select mode on entry, follow playback on, 10-second initial roll window, free timing by default, desktop inspector on the right, mobile inspector in a bottom sheet, and explicit “Replace pitch” / “Add note” keyboard actions. Adjust through product review without changing the fundamental shared-document behaviour.

## 3. Existing implementation and integration boundaries

Paths are relative to the repository root.

| Existing component | Current role | Required treatment |
| --- | --- | --- |
| `apps/web/src/music/MusicDraftReview.tsx` | Draft load, verification, current note forms, source video, playback offset, review finalisation | Host the unified correction workspace for piano; retain existing ownership and review rules |
| `apps/web/src/music/DraftNotePreview.tsx` | Whole-clip roll and animated keyboard | Retain useful overview/rendering logic; avoid a duplicate independent editor or playback clock |
| `apps/web/src/music/notation/NotationEditor.tsx` | Reviewed-lesson editor with local selection/history/video | Refactor into reusable editing surfaces and a shared controller; do not embed a second video |
| `apps/web/src/music/notation/PianoRoll.tsx` | Fixed-size roll; pointer editing | Add time viewport, virtualisation, precise per-note operations and corrected drag semantics |
| `apps/web/src/music/notation/SheetMusic.tsx` | Custom SVG score | Add continuous systems, note dragging, playhead geometry and horizontal viewport |
| `apps/web/src/music/notation/KeyboardEditor.tsx` | Keyboard audition and note editing | Add explicit interaction modes and occurrence selection |
| `packages/music-notation` | Performance/notation mapping, edits, score generation, MusicXML | Extend shared semantics rather than maintaining a second musical model |
| `apps/web/src/music/MusicLessonEditor.tsx` | Reviewed piano editing, saves notation with new revision | Reuse the workspace after draft integration; preserve immutable revision behaviour |
| `apps/web/src/music/usePianoSourcePlayer.ts` | Source-video/piano-audio synchronisation | Reuse as playback authority |
| `apps/api/music_review.py` | Initial draft finalisation | Extend validation/persistence for notation and alignment; currently its review request does not include notation |
| `apps/api/music_notation.py` and `apps/api/music_edit.py` | Existing notation validation and reviewed revision save | Reuse integrity checks and persistence conventions |

The existing editor is custom React/SVG, not an embedded RiffScore/Smoosic editor. Those libraries were evaluated previously. `react-piano` is installed for instrument display; it does not supply the complete editing workflow. No renderer-library migration is required by this plan.

Existing reports describe earlier fixture-based tests. Re-qualify current code and the actual approximately 209.6-second, 1,338-note example before acceptance. Do not claim those earlier reports prove this new workflow.

## 4. Exact desktop screen arrangement

### 4.1 Page shell

Keep the application header and navigation. Inside the content area:

1. A compact title row: back action, lesson title, “Unsaved changes” / “Saved” status, and “Finish review”.
2. One workspace toolbar.
3. Main workspace: left editing column and right reference/inspector column.
4. Compact overview/navigation strip.
5. Collapsible lesson settings, teaching sections and advanced diagnostics below the workspace.

Use available content width, with a maximum around 1,600 CSS pixels. At 1,440 × 900, aim to show keyboard, roll and both staves together. The editor controls should not require scrolling through dozens of note forms. General settings can remain below the main workspace.

### 4.2 Workspace proportions

| Area | Proposed desktop dimensions and contents |
| --- | --- |
| Toolbar | 44–48 px high; Play/Pause, time, playback speed, Select/Add, Undo/Redo, Follow playback, Zoom |
| Left editing column | Flexible width; minimum approximately 560 px at full desktop layout |
| Keyboard | Approximately 90–110 px keys plus a 32 px context/action row; fit 88 keys when readable, with an octave-range control for closer inspection |
| Piano roll | Approximately 190–220 px including a seconds ruler; pitch labels fixed on the left; horizontal time scroll |
| Sheet strip | Approximately 220–260 px, including both staves and a measure ruler; horizontal scroll; pinned clef/key context |
| Right column | 280–320 px; video at top, selected-note inspector below |
| Overview | Approximately 40–48 px; whole-clip density and draggable visible-range window |

These are CSS-pixel design targets, not hard heights that clip controls on short windows. At short desktop heights, reduce optional descriptions and allow vertical workspace scrolling. Avoid making a tall editor sticky beneath the global header; it can otherwise hide most of the editable area. Pin only the compact transport bar when needed, below the existing shell header height and below its stacking order.

### 4.3 Control grouping

Primary toolbar, left to right:

- Play/Pause; elapsed / total time; playback speed (0.5×, 0.75×, 1×).
- Select (default) and Add note.
- Undo and Redo, with shortcuts in tooltips.
- Follow playback toggle, initially on.
- Zoom out, zoom in and a current-window label such as “10 s visible”.

Second, compact editing row:

- Whole, half, quarter, eighth, sixteenth, dotted toggle; unsupported values disabled or omitted accurately.
- Sharp, flat, natural.
- Audition, Replace pitch, Delete.
- Snap: Off, 1/4, 1/8, 1/16. Snap controls timing placement; written-duration buttons control score rhythm.

Selected-note-specific actions remain disabled with a tooltip when there is no selection. Show pitch/time in the keyboard context row, e.g. “C♯4 · 12.340 s · Note 146”. Do not display internal IDs.

Video column:

- One reference video with native controls and contained aspect ratio.
- Audio source: Original / Piano; volume.
- “Sync & loop” disclosure, initially closed.
- Inspector for the current note, or “Select a note in either view to edit it.”

Audio source changes do not change the displayed time or selection. Unavailable piano audio has one concise explanation, not multiple repeated notices.

## 5. Visual language and interaction states

Keep the app’s existing neutral background and green palette. Use colour plus outlines/icons/labels so colour is never the sole signal.

| State | Treatment |
| --- | --- |
| Ordinary roll note | Muted green with a subtle velocity-dependent fill; legible against pitch rows |
| Selected note | Strong blue outline/fill accent in roll and score; matching outlined keyboard key |
| Currently sounding note | Green active highlight in roll/score/key |
| Selected and sounding | Selection outline remains around the sounding fill |
| Playhead | Thin orange vertical line, same colour in both views, with a visible ruler handle |
| Hover/focus | Outline and pitch/time tooltip; keyboard-focus ring distinct from selection |
| Drag preview | Ghost note, target guide and numeric tooltip; original remains faintly visible |
| Invalid placement | Invalid icon and explanation; commit disabled; no silent loss of other notes |
| Pending pitch replacement | Persistent “Choose a replacement key for C4” banner plus Cancel |

Keep action targets at least 44 px where practical. Dense notes can have expanded invisible hit areas, but ambiguous hits must open a small candidate picker rather than arbitrarily selecting a neighbour.

## 6. User journey

### 6.1 Open and inspect

1. Load the working draft, accepted verification corrections, playback settings and saved notation/alignment if present.
2. Construct notation once when absent; preserve original performance seconds.
3. Start paused at zero, Select mode active, no note selected, Follow playback on.
4. Show approximately 10 seconds in the roll. Fit the corresponding musical region into the score viewport while keeping noteheads readable; allow different view widths when necessary.
5. Play: the video advances both playheads, sounding-note highlights and the keyboard.
6. Click a note: pause playback, select that occurrence, reveal it in both views, seek to its actual onset and populate the inspector.

Playback and selection are separate states. Playing does not continuously replace the user's selection with the currently sounding note. A selected note may remain selected while later notes play.

### 6.2 Correct a wrong pitch through the roll

1. Click the note rectangle to select it.
2. Drag vertically. After a 5 CSS-pixel threshold, lock to pitch movement; horizontal jitter must not move its onset.
3. Preview semitone pitch steps and show the candidate name. Audition changes at a bounded rate.
4. Release to commit one edit. All views update; onset, recorded length and other chord notes remain unchanged.
5. Escape or pointer cancellation restores the original document without an undo entry.

For timing movement use the explicit Move time action/handle in the inspector or a horizontal drag that locks after the threshold. The first dominant axis locks the gesture; do not apply pitch and time changes together accidentally. The on-screen handles provide a discoverable alternative to modifier keys.

### 6.3 Correct pitch through the sheet strip

1. Click a notehead, not a chord’s shared stem, to select one note.
2. Drag up/down through staff lines and spaces; each line/space is a diatonic step.
3. Respect key signature and explicit accidental rules when deriving pitch. Show the resulting pitch name before release.
4. Release commits pitch and spelling to the linked performance note and notation note.
5. Sharp/flat/natural buttons alter the selected note at its letter/octave and update its sounding pitch where appropriate.

Expose “Respell C♯ as D♭” separately from applying an accidental. Enharmonic respelling changes notation without changing sounding pitch. A black piano key alone must not decide the user's preferred spelling.

Horizontal staff dragging is not a required v1 timing gesture: non-linear engraved spacing and quantisation make that ambiguous. Use the piano roll/inspector for exact recorded start; expose beat position explicitly for score-only placement.

### 6.4 Replace pitch through the keyboard

Preferred path:

1. Select a note in the roll or score. Its keyboard key is outlined.
2. Press “Replace pitch”. The target occurrence stays fixed; other editing actions are temporarily disabled.
3. Click a new key to audition and commit the new pitch. Preserve ID, start, recorded duration, velocity and unrelated chord members.
4. Exit replacement mode, retain selection on the edited note and update both views.
5. Cancel/Escape exits without changing anything. Clicking the original key exits as a no-op, with no history entry.

Keyboard-first selection:

- In Select mode, clicking a key with exactly one note sounding at the playhead selects that occurrence, pauses and reveals it. It does not change pitch.
- If multiple occurrences of that pitch overlap, show a picker containing onset and duration; choose before editing.
- If no occurrence is sounding, audition only and show “No C4 note at this position. Select a note in the roll, or use Add note.” Do not silently choose an arbitrary nearby occurrence.
- Clicking a pitch repeated elsewhere in the clip must never edit every occurrence.

### 6.5 Add a note

1. Activate Add note. Show an insertion cursor; no mutation yet.
2. Click the roll at a time/pitch, or click a score position then choose a key. Clicking a key directly uses the current playhead as the insertion time.
3. Show a ghost with pitch, start and proposed recorded length/written value. Quarter is the initial written value; preserve the user's last choice during the session.
4. “Insert” or Enter commits; Cancel/Escape discards the ghost.
5. The inserted note is selected across views; return to Select mode to avoid accidental repeated insertion.

Adding at a chord position adds a note. It does not replace the chord. Same-pitch/same-onset duplication presents a warning and offers to select the existing note; no silent duplicate.

### 6.6 Change timing, recorded length or written duration

| Action | Default effect | Explicitly unaffected |
| --- | --- | --- |
| Horizontal roll drag / Start field | Exact recorded onset of the selected occurrence; score alignment/placement updates consistently | Other notes, video, recorded length |
| Roll right-edge resize / Recorded length field | Recorded duration, free in seconds unless snap enabled | Written value and following notes |
| Whole/half/quarter/etc. | Written duration; rests/tied segments regenerated as necessary | Actual onset, recorded duration and video |
| Written beat-position control | Score position and corresponding alignment metadata | Recorded onset unless a separate “Move recording timing too” action is explicitly chosen |
| Sharp/flat/natural or pitch replacement | Selected sounding pitch plus spelling | Time, length, velocity |
| Enharmonic respell | Spelling/glyph only | Sounding pitch, time and audio-preview validity |

Do not reuse a beat-snapped move operation for free recorded-time movement. Example: changing 12.347 s to 12.357 s with Snap Off must retain that 10 ms adjustment, not round it to a sixteenth note.

If changing one chord member's written duration would require an independent voice, split its notation event and allocate an available voice. The current model supports two voices per staff. If neither can represent the result, show “This change needs another voice” and leave the document intact; never overwrite neighbouring notes to make room.

Select a tied segment to show its logical note and all linked segments. v1 pitch replacement/deletion applies to the logical note and its linked segments, with “Entire tied note” shown in the inspector. Editing one segment independently requires an explicit Split tie action; do not imply it is supported until implemented.

### 6.7 Delete and recover

- Delete removes the selected occurrence/logical note and its linked notation segments only.
- Fill score gaps with generated rests; do not shift later recorded notes.
- Undo/Redo spans all three views and all document edits. A completed drag is one step.
- Selection, viewport and playhead movement do not mark the document dirty or enter musical undo history.
- Deleting a selected note clears its selection; keyboard and inspector must not retain a stale reference.

## 7. Scrolling, zoom and navigation

### 7.1 Time viewport

The piano roll maps source seconds to pixels at a chosen pixels-per-second scale. Its content width grows with recording length; the viewport does not shrink the whole clip. Initial visible duration: 10 seconds. Permit approximately 2–60-second windows subject to screen width and accessible controls. “Fit clip” is an explicit overview option, not the editing default.

The score is one continuous horizontal grand-staff system with engraved measure widths. Treble and bass always scroll together. Render the visible measures plus a buffer; do not mount hundreds of full SVG measures unnecessarily.

### 7.2 Linked scrolling

- Scrolling the roll identifies the source time at its left content boundary and requests the corresponding score region.
- Scrolling the score identifies the score beat at its left content boundary and requests the corresponding source-time region.
- Align the counterpart to the same leading musical position; widths and scroll distances can differ.
- Scrolling either view does not seek the video. Clicking/scrubbing the ruler does.
- Keep an origin token (`roll`, `score`, `overview`, `playback`) to prevent reciprocal scroll loops.
- A manual scroll turns Follow playback off and reveals a “Return to playhead” action. Both views continue showing their correct playhead, even if offscreen; show an edge indicator when useful.
- Re-enabling Follow or pressing Return to playhead reveals the current position in both views.
- Zoom is anchored at the playhead if visible, otherwise the centre of the current viewport. Keep that musical anchor stable during zoom.
- The overview window represents the roll's visible seconds. Dragging it pans both views and seeks the source playback with them, preserving the playhead's position inside the window; clicking its background seeks exactly to the clicked source time and recentres the viewport.

### 7.3 Auto-follow

Use edge-based follow: once playback reaches approximately 75% of a view, scroll it so the cursor returns near 25%. Avoid scrolling every frame while it remains comfortably visible. Each view uses its own geometry but the same temporal anchor. Disable smooth scroll animation while scrubbing or dragging; minimise motion under reduced-motion preferences.

## 8. Synchronisation and musical alignment

### 8.1 One source clock

The existing video element is the authoritative source clock, including when the verified piano audio track is selected. `usePianoSourcePlayer` remains responsible for keeping that audio aligned. There must be one video, one transport controller and one source time.

Use `requestVideoFrameCallback` where suitable, with requestAnimationFrame/media-event fallback. Observe play, pause, seek, rate change, ended and source replacement. While paused, redraw on seek and edits; do not run an idle animation loop.

Each visual frame derives:

- Piano-roll playhead x from current source seconds.
- Sheet playhead x from source-time-to-score-position mapping and the score's actual layout geometry.
- Active note IDs from effective onset/duration intervals.
- Active piano pitches from those active IDs.

Selection highlights derive from selection state, not the playback clock. Update the small visual layers without rerendering every editing control at video-frame frequency.

### 8.2 Offset convention

Define one conversion boundary:

`effective source onset = stored performance onset + sync_offset_seconds`.

The roll and video-following highlights use effective onset. Dragging a note to source time `t` stores `t - sync_offset_seconds`. Saving must not bake the offset into every note and then apply it again on reload. Clamp display intervals at source bounds while retaining valid underlying note data according to the shared contract. Validate any attempted edits that would produce unsupported negative stored onsets rather than silently changing the whole sync offset.

Both source playback and note timing controls must use the same documented convention. Global sync is a distinct persisted playback setting; editing one note does not adjust it. Saving a sync change does not imply that unsaved note edits were saved.

### 8.3 Seconds are not beats

The current notation model uses ticks (`ppq = 480`) and a single tempo. The recording may contain rubato, arpeggiated chords or pauses. A constant `seconds × BPM` conversion is an initial estimate, not proof of musical alignment.

Introduce a versioned alignment layer relating source time to score ticks. Minimum behaviour:

- Stable links from performance IDs to logical notation note IDs remain authoritative for corresponding-note selection and active highlights.
- Use an explicit monotonic source-time/score-tick map for the continuous score playhead, with increasing anchor pairs and piecewise interpolation between them.
- Start with the existing tempo conversion when no better alignment exists, mark it as estimated, and allow manual beat/measure alignment anchors in an advanced control.
- “Align beat to video”: pause/seek, choose a score beat, set an anchor, preview alignment and commit through undo history. Reject anchors that reverse time or score order. Persist anchors with notation/alignment versioning.
- Duplicate score positions for chord members are grouped into one anchor. Do not create a non-monotonic map by blindly turning every expressive note onset into an anchor.
- Record individual note timing deviations from the mapped score position; retain exact performance timing. A timing correction must not warp the global tempo map automatically.
- In untimed explanation passages, hold the score cursor at the last mapped position and resume at the next mapped passage. Show the passage state rather than inventing beats through spoken explanation.

A single score line cannot pass through every notehead at its exact sounding instant when an engraved chord's notes are played at slightly different times. The line shows the continuous mapped musical position; the actual noteheads/roll notes/keys light at their true onset. This is the defined behaviour, not a synchronisation bug. If mapping is estimated, display “Score alignment estimated” with an alignment action.

Clicking a note seeks to its linked actual onset, never a rounded tempo-derived approximation. Clicking empty score/ruler space uses the inverse alignment map; an unmapped gap offers the nearest valid passage boundary.

### 8.4 Shared selection and chord identity

Keep selection as stable IDs: performance occurrence, logical note, optional tied segment, event, staff and voice. Do not select notes by pitch or array index. Some logical notes can map to multiple performance IDs; show that scope explicitly and require an occurrence choice for exact performance-time changes.

Pitch/velocity/time/recorded-length edits default to the selected performance occurrence. When an existing logical notation note maps several occurrences that would diverge after the edit, split the mapping/event as necessary, or reject with an explanation. Do not modify several repetitions implicitly.

Notation-only rhythm actions operate on the selected logical note/event with clear scope. Shared stems and chords must not turn a single-note correction into an entire-chord timing change.

## 9. State and edit architecture

Suggested controller boundary: `PianoCorrectionWorkspace` with reusable `KeyboardSurface`, `PerformanceRoll`, `ContinuousScore`, `SelectionInspector`, `TransportBar` and `ClipOverview`. Names are proposals, not a requirement to duplicate existing components.

| State | Authority / persistence |
| --- | --- |
| Performance notes, score events/segments, stable links | One controlled working document; persisted together |
| Alignment anchors, tempo/key/time signature | Versioned document metadata; persisted |
| Source time, playing/rate | Existing source media controller; session state |
| Sync offset/audio mode/volume | Existing playback settings/preferences, preserving current persistence rules |
| Selected IDs, insertion ghost, replacement target | Workspace session state |
| Scroll origins, zoom, follow flag | Viewport controller; optional per-user preference, not musical data |
| Undo/redo | One command history for document edits; bounded/checkpointed for large clips |
| Dirty/confirmation/errors | Host review workflow |

All mutations go through typed commands such as `SelectOccurrence`, `ReplacePitch`, `MovePerformanceOnset`, `SetRecordedDuration`, `SetWrittenDuration`, `ApplyAccidental`, `RespellPitch`, `InsertNote`, `DeleteNote` and `SetAlignmentAnchor`. Selection is a controller action, not a persisted edit command.

For every musical command: validate scope and bounds, prepare one atomic next document, update mappings/derived segments, commit one history entry, reset review confirmation, flag dirty, refresh affected views and determine audio-preview validity. On failure preserve the old document and show an actionable error.

Do not rebuild the entire score from raw performance after every edit: that can discard corrected spelling, rhythm, voices and alignment. Recompute affected measures/derived geometry with stable logical IDs.

## 10. Save, verification and audio behaviour

### 10.1 Initial review save

Extend the existing draft review contract to include optional validated notation and alignment metadata. Validate that linked pitches, timing identities and performance content agree with the submitted events; reject dangling mappings and unsupported versions. Use the server's existing notation integrity checks where possible.

Preserve accepted verification decisions, state-token validation, request identity, retry/idempotency behaviour, source hashes and ownership. A visual editor must not bypass those checks. If manual editing contradicts an accepted suggestion, show the conflict and offer to clear that decision before finalisation; do not silently submit an impossible combination.

“Finish review” opens an in-page review summary with lesson title, teaching sections, assessment settings and the required confirmation. “Save reviewed reference” performs existing private finalisation. Saving is not publishing or updating a shared release.

On failure retain edits and selection, show the error and permit retry with the same intended save identity. A stale-draft conflict requires a clear recovery flow; do not silently reload and discard local work.

### 10.2 Durability before finalisation

Do not label state “Saved” unless persisted successfully. The current finalisation endpoint is not a working-draft autosave endpoint.

Add a versioned local recovery checkpoint containing draft/source identity, working document, alignment and the verification token. Restore only when identities match; offer Restore/Discard on re-entry. Show “Recovered on this device” rather than implying server persistence. Clear recovery after confirmed finalisation. Existing navigation guards must cover unsaved workspace edits. Account changes must not expose another account's recovery data. Cross-device draft autosave is a separate backend feature.

### 10.3 Piano audio and auditions

Original recording remains available. Performance-changing edits invalidate any rendered piano asset whose identity no longer matches. Fall back to Original and show “Notes changed. Piano preview needs updating.” Do not play stale piano audio as if it represented the edits.

Local single-note audition provides immediate feedback for pitch changes. It is a preview, not a regenerated full recording. Spelling-only/engraving-only edits do not invalidate audio if performance is unchanged. Stop audition on cancel, seek, lesson change and disposal to prevent stuck voices. Starting source playback stops audition.

## 11. Responsive and accessible behaviour

- At widths below approximately 1,100 px, move video/inspector below or into a compact side drawer; keep the three editing surfaces full width.
- On phones, preserve order: compact transport, keyboard, roll, continuous grand staff. Each timeline scrolls horizontally inside its container; the page must not acquire horizontal overflow.
- Mobile video opens from a persistent Reference button into a dismissible panel; the same video element/clock must be retained rather than starting a second player.
- Inspector opens as a bottom sheet that does not hide the selected note unnecessarily.
- Use explicit touch edit handles or a selected-note edit action so horizontal timeline swiping does not immediately drag notes. Panning is the default on empty space. Preserve browser vertical scrolling outside active edit gestures.
- Keyboard navigation: Tab to surfaces/actions; arrows navigate notes; Enter selects; Delete deletes only when the workspace has focus; Escape cancels; Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo. Ignore global shortcuts while typing into text/numeric fields.
- Offer pitch-step and numeric time/length controls as alternatives to dragging. Provide accessible note labels containing pitch, time, staff/measure and selected state.
- Live regions announce completed actions and errors, not every animation frame or pointer movement.
- Pin appropriate pitch/staff context during scrolling. Preserve usable contrast, focus rings, reduced motion and meaningful empty states.

## 12. Final score presentation

“Preview formatted score” switches to a read-only engraved presentation of the same document: wrapped grand-staff systems, sensible measure spacing, titles, tempo/key/time signature, page breaks and ties across systems. “Return to correction” restores editing selection and viewport. This preview may be inspected before finalisation.

Finalising does not make the lesson permanently uneditable: later owner edits continue through the existing new-revision workflow. Never generate a second independent note dataset for printing. MusicXML export already exists; PDF/print pagination is a distinct renderer deliverable and must not be claimed until layout is implemented and inspected. Show estimated rhythm/alignment issues before presenting the score as instructor-approved.

## 13. Implementation sequence

The following is an architectural summary. Use the companion phased-delivery document for the actual developer sequence and mandatory review gates. In particular, persistence is established before exposing correction edits as the normal review workflow.

| Phase | Work | Exit condition |
| --- | --- | --- |
| 1. Baseline and semantics | Run existing notation/review tests; inspect the real long example; document ID mappings, destructive overwrite paths and offset conversion | Baseline evidence and safe command contracts agreed |
| 2. Shared controller | Extract video-independent editor surfaces, shared selection/history, precise occurrence edits; no duplicate clock | Pitch edit/undo in any surface updates one document |
| 3. Continuous views | Time viewport, score-strip virtualisation, zoom, overview, scroll linking and playhead geometry | Long recording remains readable; no full-clip squeeze or scroll feedback loop |
| 4. Alignment | Versioned map, inverse seeking, estimated state and beat anchors; expressive timing and explanation passages | Both cursors represent one source moment; exact note activation retained |
| 5. Interaction UX | Staff drag, keyboard replacement/insertion, inspector, per-note chord behaviour and touch handling | User journeys in section 6 pass without unintended edits |
| 6. Host and save integration | Replace piano note forms; persist notation/alignment; verification conflicts, recovery and audio invalidation | Save/reload preserves corrections and all integrity rules |
| 7. Final score and qualification | Formatted preview, reviewed-editor reuse, accessibility, performance and actual-device tests | Acceptance matrix passed with recorded evidence |

Keep guitar behaviour intact; this plan specifies piano correction. Remove the redundant piano form list only when equivalent editing and save coverage is demonstrated. A hidden second editable note array is not an acceptable fallback.

## 14. Acceptance and verification matrix

| Scenario | Required result |
| --- | --- |
| Open actual long example | Keyboard, roll and continuous score are usable; approximately 10 seconds shown initially; video appears once |
| Play/pause/seek/rate change | Both cursor positions, active notes and keys derive from the same source clock; no independent drift |
| Timing tolerance | Target at most one displayed frame of visual-clock disagreement; evaluate timestamp/position mapping, accounting for frame rate and background-tab throttling |
| Select one repeated C4 | Exactly that occurrence is selected/edited; other C4s untouched |
| Select one chord member | Its pitch/time/recorded length can change without moving the rest of the chord |
| Keyboard replacement | Explicit target and pending state; new key updates both views; Cancel is a no-op |
| Staff drag | Diatonic staff movement and accidental/key rules produce expected pitch; undo restores pitch and spelling |
| Free timing | A 10 ms edit survives save/reload without beat snapping or double offset |
| Written versus recorded duration | Quarter-to-half does not stretch recorded duration; roll resize does not silently rewrite written value |
| Ties and multi-mapping | Scope shown; linked segments update consistently; occurrence edits split/reject explicitly when needed |
| Sharp/flat and respelling | Applying an accidental and enharmonic respelling have distinct, tested effects |
| Manual pan | Both views reveal the corresponding region; video does not seek; Follow switches off |
| Scrub ruler / select note | Both cursors and video seek correctly; note selection uses actual onset |
| Rubato/arpeggiation | Alignment remains monotonic; actual notes activate at exact times even when engraved chord shares one x |
| Explanation passage | Cursor holds/resumes honestly; no invented beat progression |
| Offset ± and boundary notes | One offset application; no cumulative shift after edits/reload; invalid edits explained |
| Written overlap/third voice | No silent overwrite or deleted performance; valid split or explicit rejection |
| Delete/undo/redo/cancel | IDs/mappings consistent; one drag is one history action; navigation is not dirty |
| Audio preview stale | Original fallback, clear message, no stale rendered notes presented as edited audio |
| Save retry/conflict | Edits retained; current verification rules enforced; no duplicate finalisation |
| Recovery/account switch | Matching draft recovers correctly; stale/wrong-account recovery never merged |
| Formatted preview | Same musical data, wrapped systems; returning restores editing context |
| Accessibility and touch | Drag alternatives work; timeline swipe and note editing are distinguishable; no horizontal page overflow |

Use unit tests for commands, mapping, alignment, offset conversion and inverse seeking. Add integration tests for shared selection/history and draft save payloads. Use browser tests for pointer capture, cancel, independent scroll containers, zoom, transport and save/reopen. Include physical-device checks for touch; emulation alone is not device qualification.

Performance fixtures: real ~1,338-note clip, empty clip, repeated same-pitch notes, dense chords, long sustained notes, ties across barlines, rubato and spoken gaps. Also test the supported event/measure limits (currently 20,000 performance events and 512 measures) and reject over-limit input clearly. Proposed desktop target: responsive pointer previews within one frame at normal refresh rates and edit commits within 100 ms for the real example; measure on named hardware/browser and report results, not assumptions.

## 15. Developer delivery checklist

- Working correction workspace in draft review and reusable reviewed-lesson editor integration.
- Documented performance/notation/alignment version and migration behaviour.
- One source clock, one document authority, one history and stable occurrence selection.
- Safe per-note commands; no hidden event-wide overwrite during occurrence corrections.
- Persisted notation/alignment with existing review/revision integrity and private-save behaviour.
- Recovery, stale-audio handling and verification-conflict UX.
- Desktop, narrow-screen and touch evidence for the actual long transcription.
- Read-only formatted score preview and accurate export labels.
- Test results, screenshots and known limitations recorded with the delivery.

Do not treat an attractive keyboard/roll rendering alone as completion. The acceptance outcome is a correction made through any supported view, reflected everywhere, saved consistently and reopened without changing its meaning or timing.
