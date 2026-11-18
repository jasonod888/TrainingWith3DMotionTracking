# Unified Music Engine / Guitar implementation review

Reviewed 18 November 2026 against the supplied “Unified Music Engine & Guitar Architecture / UX Plan.” Baseline HEAD: `fc4e33a`, including the current tracked modifications and new guitar files in the working tree. This is a review, with no implementation fixes applied.

The shared architecture is substantially implemented. The four tuning catalogues, capo math, optional notation fields, setup correction command, setup-aware position helpers, document patches, editor controls, save payload handling, and normal chord recovery wiring exist. The remaining problems are primarily correctness and integration gaps. This report identifies **11 actionable findings**, followed by smaller contract differences, unresolved product decisions, and verification limits.

Priority: P1 = significant risk of losing authored work; P2 = functional correctness or incomplete integration; P3 = presentation/accessibility or smaller requirement gap. Findings distinguish executed reproductions from conclusions based on traced code.

## 1. [P1] A temporary invalid chord edit can invalidate recovery for the entire workspace

**References:** [chord editing](../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx#L3141), [checkpoint writing](../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx#L1505), [chord validation](../apps/web/src/music/workspace/recovery.ts#L46), [whole-checkpoint rejection](../apps/web/src/music/workspace/recovery.ts#L182).

The chord-name input writes every keystroke directly into `guitarChords`, including the empty string while replacing a name. After 600 ms, autosave writes that state. `writeRecovery` does not validate it, but `readRecovery` rejects the entire checkpoint when a chord name is empty. That discards access to otherwise valid unsaved notation, setup, sections, and other workspace edits as well as the chord edit.

**Reproduction:** edit a chord, clear its name, wait longer than 600 ms, and reload. A direct storage probe confirmed that the written checkpoint is rejected with “invalid guitar chords.” The input-to-autosave path was traced in source.

The same boundary is reachable by adding more than 100 shapes: the Add shape handler has no limit, whereas recovery and the API cap the array at 100.

**Required change:** keep incomplete input in a separate draft value, or prevent invalid chord state from replacing the last recoverable checkpoint. Enforce the 100-shape limit in the authoring controls. Keep the requested strict reader validation, but ensure ordinary editing cannot poison its input.

**Missing verification:** recovery after replacing a chord name, clearing a name, attempting a 101st chord, and crashing while notation and chords both have unsaved changes.

## 2. [P2] Stale-checkpoint restoration bypasses the new chord validator

**References:** [revision comparison](../apps/web/src/music/workspace/recovery.ts#L134), [peekRecovery](../apps/web/src/music/workspace/recovery.ts#L189), [stale offer](../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx#L1498), [stale restore](../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx#L1948).

`readRecovery` returns early on a base-revision mismatch, before validating `guitarChords`. The UI then obtains the same checkpoint using `peekRecovery`, whose checks do not validate chords. `restoreStaleCheckpoint` parses the notation but passes `staleCheckpoint.guitarChords` straight into React state.

Consequently, the normal recovery path rejects malformed chords, while the stale recovery path accepts them. Bad chord objects can then reach renderers that assume `frets` is an array, causing a rendering exception, or leave the workspace unable to save.

**Executed reproduction:** a checkpoint with an empty chord name was rejected at its current revision; changing only the requested base revision caused the stale response, and `peekRecovery()` returned that invalid chord unchanged.

**Required change:** share structural validation between normal and stale reads. Explicit stale approval should relax the revision requirement only, while retaining chord and other structural checks.

## 3. [P2] An unplayable pitch is rendered as a valid open first string in TAB

**References:** [setup remapping](../packages/music-notation/correction.ts#L887), [TAB position fallback](../apps/web/src/music/workspace/ContinuousScore.tsx#L169), [fallback positions in the editor](../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx#L581).

Changing setup can make a note unplayable. The command deliberately preserves its sounding pitch and sets string/fret to `null`, which is an understandable representation. However, `ContinuousScore.stringFor` replaces a failed resolution with `{string: 1, fret: 0}`. The score therefore teaches a specific playable position for a pitch that position does not produce.

**Executed reproduction:** standard-tuning E2 / MIDI 40, then capo 2. The command leaves MIDI 40 unpositioned. Rendering the TAB nevertheless produced:

```html
<text data-string="1" data-fret="0" aria-label="String 1, fret 0, eighth">0</text>
```

Under that setup, open string 1 sounds MIDI 66, not 40. The practice fretboard filters the same note out, so the surfaces also disagree. The editor's lookahead and strum inputs have similar invented-position fallbacks.

**Required change:** propagate an unresolved/unplayable result to all displays; show a clear unresolved marker or warning instead of inventing a position. Decide whether setup changes with unplayable notes remain allowed.

## 4. [P2] Finger assignment does not use one consistent hand position for a chord

**References:** [finger assignment](../packages/music-notation/guitar.ts#L197), especially the sort and prefix window at lines 200–218.

Notes sort by onset and then ID. Each note receives a finger based only on the prefix processed so far. Later members of the same simultaneous chord cannot affect earlier assignments. This differs from the planned minimum positive fret across the active chord/phrase window.

**Executed reproduction:** three simultaneous valid notes:

| ID | String | Fret | Pitch | Expected finger from base fret 3 | Actual |
| --- | --- | --- | --- | --- | --- |
| a | 1 | 6 | 70 | 4 | 1 |
| b | 2 | 5 | 64 | 3 | 1 |
| c | 3 | 3 | 58 | 1 | 1 |

Renaming the same notes so the lowest fret sorts first produces the expected assignments. Musical fingering therefore changes when unrelated identifiers change.

The window also uses onset alone and has no note-duration field. In an executed probe, a fret-5 note held for four seconds was excluded when a fret-9 note began at second 2; both were assigned Index. Conversely, previously released notes remain influential for up to 1.5 seconds. The fixed seconds window is an implementation choice not specified in the plan and does not consistently represent the currently held chord.

**Required change:** define chord/phrase membership, calculate its base position before assigning its members, and account for overlapping durations when the window represents active notes. Preserve identical assignments under ID renaming or input reordering.

## 5. [P2] Malformed tuning values escape backend validation as TypeError

**References:** [backend tuning validation](../apps/api/music_notation.py#L95), [review exception handling](../apps/api/music_review.py#L129), [revision exception handling](../apps/api/music_edit.py#L109).

The server performs `tuning not in GUITAR_TUNINGS` without first checking that tuning is a string. A JSON array or object is unhashable and raises `TypeError`. Both save routes catch `ValueError` around notation validation, so these malformed values escape the intended 422 refusal path and can become server errors.

**Executed reproduction:** `_validate_guitar_setup({'guitar_tuning': []})` and the equivalent object value both raised `TypeError`; an unknown string correctly raised `ValueError`. The HTTP outcome is inferred from the route exception handling; API integration tests could not run locally.

The server also treats explicit `null` tuning/capo as missing, while the TypeScript parser rejects explicit `null`. A reference accepted by the backend can consequently be refused by the frontend.

**Required change:** validate types before dictionary lookup and align missing/null semantics across readers. Test arrays, objects, booleans, nulls, unknown strings, fractional capos, and capo bounds through both save routes.

## 6. [P2] The practice “Roll” omits the new finger-colored six-string TimeRoll and playback-follow wiring

**References:** [practice guitar stage](../apps/web/src/music/workspace/PianoPracticeWorkspace.tsx#L240), [practice Roll branch](../apps/web/src/music/workspace/PianoPracticeWorkspace.tsx#L265), [stage choice](../apps/web/src/music/workspace/PianoPracticeWorkspace.tsx#L323), [score reveal/follow effects](../apps/web/src/music/workspace/ContinuousScore.tsx#L217).

The editor renders the updated `TimeRoll`. Practice's “Roll” branch renders only `ContinuousScore` in TAB mode. There are no finger-colored time bars in that practice branch, despite the plan describing setup-aware roll presentation in editor and practice.

That TAB invocation also supplies `reveal={null}` and `playheadTick={null}`, with no timeline layout, cursor, scroll target, or clock. Active IDs highlight notes, but the score receives no playback-follow instruction. On a long piece, notes can progress beyond the visible measures without the strip following them.

**Evidence:** traced component wiring; the runtime tests do not cover long, alternate-tuning playback with a visible roll.

**Required change:** expose the shared six-string TimeRoll in practice and wire its existing timeline/clock integration, or explicitly revise the intended UX. If TAB remains, pass the shared cursor and follow state as well.

## 7. [P2] Editor and practice hide valid notes above fret 15

**References:** [editor fretboard invocation](../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx#L2324), [practice invocation](../apps/web/src/music/workspace/PianoPracticeWorkspace.tsx#L246), [renderer fret limit](../apps/web/src/music/renderers/GuitarNeckGuide.tsx#L46).

The math, schema, editor fret inputs, and setup remapping support frets 0–24. Both workspace callers hardcode `fretCount={15}`. The third-party renderer filters dots beyond its configured fret count, so a valid authored or remapped high-fret note disappears from the neck.

**Executed reproduction:** rendering a valid string-1 fret-20 marker with the workspace's 15-fret setting produced no corresponding dot or note label in the SVG.

**Required change:** render 24 frets, adapt the visible range to active/selected notes, or provide a usable position window that covers every supported fret.

## 8. [P2] Saved setup is not consumed by the Watch guide or lesson setup metadata

**References:** [save body](../apps/web/src/music/workspace/save-payload.ts#L114), [revision instrument retention](../apps/api/music_edit.py#L85), [reference reader](../apps/web/src/music/music-reference.ts#L50), [Watch loading](../apps/web/src/music/MusicLessonHome.tsx#L126), [Watch guide](../apps/web/src/music/renderers/InstrumentGuideStage.tsx#L16), [standard-only fallback](../apps/web/src/music/renderers/guide-view-model.ts#L11).

The new editor stores setup in notation and strips top-level event positions for nonstandard setup. Saving retains the old `instrument` object. Watch reads the top-level performance through `parseMusicReference` without requesting notation; its guide computes fallback positions using standard tuning, and the enhanced neck is invoked without tuning/capo.

Thus, a lesson saved with Drop D/capo can reopen correctly in the unified editor and practice workspace while Watch shows standard-tuning fallback positions and old setup metadata. If the existing instrument metadata itself says nonstandard tuning/capo, the legacy guide instead declines to draw it.

**Evidence:** traced the save, backend retention, Watch reader, and renderer call chain. This is a cross-surface integration gap beyond the plan's specifically named editor/practice files, but it is exposed by the planned save representation.

**Required change:** establish one authoritative setup and make Watch consume it, including notation positions when top-level positions are intentionally absent. Keep any duplicated instrument metadata synchronized.

## 9. [P2] Active and selected roll bars lose their finger colors

**References:** [roll styling](../apps/web/src/music/workspace/TimeRoll.tsx#L447), [finger CSS](../apps/web/src/music/workspace/workspace.css#L331), [active/selected CSS](../apps/web/src/music/workspace/workspace.css#L355).

The finger fill is applied only when a note is neither selected nor active. Finger-colored strokes also exclude both states. Playback therefore changes active bars to generic green, and selection replaces the finger color with the selection treatment. The fretboard retains the assigned finger color, so the two surfaces stop matching at the moment the player needs the instruction.

**Evidence:** direct styling conditions and CSS rules. `data-finger` remains present but does not preserve the visible color.

**Required change:** keep the finger fill or a clearly visible finger-colored element through active/selected states; communicate activity and selection using an outline, halo, thickness, or another independent treatment.

## 10. [P3] TimeRoll labels and tooltips omit the finger indicator

**References:** [bar accessibility label and title](../apps/web/src/music/workspace/TimeRoll.tsx#L459), [fret text](../apps/web/src/music/workspace/TimeRoll.tsx#L470).

The plan explicitly requires finger indicators in bar labels/tooltips. Current visible text contains the fret only, the title contains pitch/onset/duration, and the accessible name contains string/fret/onset. None identifies Index, Middle, Ring, Pinky, or Open. Internal `data-finger` attributes do not communicate that information to users.

**Required change:** include the finger number/name in the tooltip and accessible name, and use a compact visible indicator where space permits. Include the open-string case explicitly.

## 11. [P3] TimeRoll and ContinuousScore have no visible capo badge

**References:** [TimeRoll setup](../apps/web/src/music/workspace/TimeRoll.tsx#L107), [TimeRoll data attributes](../apps/web/src/music/workspace/TimeRoll.tsx#L409), [score data attributes](../apps/web/src/music/workspace/ContinuousScore.tsx#L383), [score context labels](../apps/web/src/music/workspace/ContinuousScore.tsx#L549).

Both components receive capo and use it for position math, but expose it only as internal data. Their visible labels show the underlying tuning's string names without a “Capo 2” badge. The neck caption and editor input do communicate capo elsewhere, so the information is not globally absent; it is absent from the two specified score/roll surfaces.

**Executed reproduction:** the capo-2 score's visible text contained TAB, frets, and standard string names, but no capo information.

**Required change:** add a visible capo badge beside the roll/score setup labels, including in practice layouts where the neck caption may be outside the current view.

## Smaller plan differences and decisions to resolve

- The plan names `GUITAR_FINGER_META` with a `short` field (`O`, `1`–`4`). Implementation exports `GUITAR_FINGER_PALETTE` with `finger`, `label`, and `color`, without `short`. Colors are correct. This is a contract difference rather than a standalone runtime bug unless another consumer expects the specified API.
- Capo is a bounded numeric input rather than the requested 0–12 selector. The range is validated, so this is a UX difference, not missing capo support.
- Nonstandard top-level event positions are serialized as `null`, rather than literally omitted. The API permits null positions and notation preserves the exact values, so this meets the compatibility purpose of the plan.
- The plan does not decide whether existing saved chord diagrams should preserve their shape or sounding harmony when setup changes. The implementation leaves shapes and names untouched. Retuning can therefore make a previously named shape sound a different chord; this needs a documented rule and possibly a review warning, rather than an assumed automatic rewrite.
- The plan does not specify a policy for simultaneous notes remapping onto the same string. Remapping resolves notes independently. A future chord-aware solver or explicit conflict warning would be needed if physical chord playability is required; this is not claimed as a missing explicit requirement.
- Null positions for unplayable notes are intentionally covered by the current guitar test. The issue in finding 3 is their misleading rendering, not the mere existence of null positions.

## Requirements that are present

| Requirement | Review result |
| --- | --- |
| One shared notation/correction engine | Present; guitar extends existing types/build/correction paths. |
| Shared practice runtime, shell, and audio | Present; guitar uses the existing practice workspace/runtime and synthesis hook. |
| Four tuning pitch tables | Values match the plan. |
| Capo-aware open pitch and position helpers | Present with standard/no-capo defaults. |
| Optional document and build settings | Present. |
| Setup command preserves sounding pitches | Present; unreachable positions become null. |
| Setup changes participate in patch undo/redo | Present; focused test passes. |
| Nonstandard save representation | Present; exact positions remain in notation. |
| Editor setup controls and setup prop wiring | Present. |
| Finger palette, neck legend, data attributes | Present, with the correctness/presentation gaps above. |
| Chord-only changes trigger debounced recovery | Present: `dirty` includes `chordsDirty`, and chords affect the workspace signature/dependencies. |
| Normal recovery validates chords and restores them | Present; stale path and invalid authoring-state gaps described above. |
| Older checkpoints may omit guitarChords | Reader permits absence; restore defaults to an empty array. |

## Verification performed and limitations

1. **TypeScript:** `apps/web/node_modules/.bin/tsc.cmd --noEmit` passed.
2. **Focused guitar tests:** `guitar-notation.test.mjs` and `guitar-surfaces.test.tsx`: **20 passed**.
3. **Broader relevant tests:** `workspace-state.test.tsx`, `music-reference.test.mjs`, `music-practice-runtime.test.tsx`, and `tests/music-engine/correction-commands.test.ts`: **63 passed, 1 failed**.
4. The failing runtime test was rerun separately: **2 passed, 1 failed**. `music-practice-runtime.test.tsx:168` expects a `1.25×` speed choice; the practice capability list currently contains `0.25, 0.5, 0.75, 1`. This is a failing verification contract; this review does not establish whether the test or intended speed policy should change. Canvas-not-implemented and React act warnings were also emitted.
5. API edit/review tests were attempted but failed during collection because the selected `.venv` lacks `fastapi`. Backend helper probes ran successfully because that module can be imported independently. No claim is made that API integration passed.
6. Executed additional in-memory probes for chord assignment under ID renaming, sustained-note assignment, setup/save/reopen behavior, malformed backend tuning types, invalid/stale recovery reads, unplayable TAB rendering, and high-fret neck rendering.
7. No live browser/audio acceptance session or full repository test suite was run. Render probes used JSDOM and the installed renderer. Existing tests passing is not proof of the uncovered interaction paths.

The focused tests predominantly check successful examples, data attributes, and simple sequential finger assignments. They do not establish correctness for a whole chord, active/selected finger colors, long practice following, high frets, transient invalid chord editing, stale recovery validation, Watch propagation, or malformed backend setup types. Those are the most useful regression cases to add when implementing the fixes.
