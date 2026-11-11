# Piano notation and timing model

11 November 2026. This is the shared document behind the editable staff, piano roll and
keyboard. The implementation is [`packages/music-notation`](../packages/music-notation)
and the owner surface is [`apps/web/src/music/notation`](../apps/web/src/music/notation).

## Why a second document

Basic Pitch's output is a performance description: pitch, onset in seconds, duration in
seconds and an approximate velocity. A score needs musical decisions that seconds alone
cannot answer:

- a 0.5 s note can be a quarter at 120 BPM or an eighth at 60 BPM;
- a held note may need to be written as tied notes across a barline;
- simultaneous attacks may be a chord, a voice, or two hands;
- the same sounding pitch can be spelled differently in different keys.

The notation document sits beside the performance instead of replacing it. The original
seconds remain in `performance`; `events` and `segments` are the editable interpretation.

## Document shape

```text
NotationDocument
  notation_version: 1
  subject: 'piano'
  duration: seconds of the reviewed clip
  ppq: 480
  tempo: { bpm, beat_unit: 4, mode: 'notation', source: 'estimated' | 'instructor' }
  time_signature: { numerator, denominator }
  key_signature: 'C' | 'G' | ... | 'C#m'
  staff_split_pitch: MIDI split used for new notes (default 60)
  measures: [{ id, index, start, duration }]
  events: [NotationEvent]          editable rhythmic events
  segments: [NotationSegment]      derived render/export slices
  ties: [{ id, from_segment_note_id, to_segment_note_id, pitch }]
  performance: [PerformanceNote]   exact Basic Pitch/authoring values
  performance_map: { performance id -> logical notation note id }
  created_from: 'performance' | 'saved'
```

`NotationEvent` is the editable source:

```text
{ id, staff: 'treble' | 'bass', voice: 1 | 2, start, duration,
  notes: [{ id, pitch, spelling, accidental, performance_ids }],
  rest, source: 'performance' | 'inserted' | 'rest' }
```

`start` and `duration` are ticks at PPQ 480. The editor grid is a sixteenth note
(`120` ticks); every edit is snapped to it. A chord is one event with multiple notes.
Each note has its own stable ID and performance links, so selecting one pitch in a chord
does not select the whole chord.

`segments` is derived. A logical event is split at barlines and into engraveable values
(whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, dotted
sixteenth, sixteenth). Each slice gets its own note IDs and tie flags. A note that crosses
a barline therefore appears as two tie-connected notation notes in the document, while
still mapping back to the same performance event.

## Performance-to-score interpretation

`buildNotation(performance, options)`:

1. **Tempo.** If the instructor has not supplied a BPM, estimate from the median positive
   onset interval, interpret that interval as an eighth note, and clamp to 60–180 BPM
   (rounded to 5). The result is a starting point, not an analysis claim.
2. **Quantize.** Convert seconds to ticks with `60 / (bpm * 480)` and snap to the
   sixteenth grid. Durations shorter than a grid step are rounded up.
3. **Staff default.** Notes at or above `staff_split_pitch` go to treble, below to bass.
   This is only a default; every event can be moved.
4. **Chords.** Notes with the same staff, start and duration become one event. Duplicate
   pitches keep the strongest velocity.
5. **Voices.** At most two voices per staff. A voice is free when its last event ends at or
   before the new start. If both are busy, an identical-start group is merged into the
   existing chord; otherwise the earlier event is shortened to make room.
6. **Measures.** Measure length is `480 * 4 * numerator / denominator`. The document
   extends with full measures when an edit needs capacity, up to 512 measures.
7. **Rests.** Every voice that owns events is filled to each measure boundary with
   generated rest segments. Rests are not fake performance notes.
8. **Ties.** Every segment except the last of a logical event receives `tie_to`; the next
   receives `tie_from`. The `ties` array is rebuilt from these flags.

This is deliberately conservative. It does not infer tuplets, slurs, articulation,
handedness, or a key from audio.

## Timing policy

| Edit | Effect on notation | Effect on performance | Effect on video alignment |
| --- | --- | --- | --- |
| Change pitch | Respells the selected note; tied slices follow the logical note | Linked performance pitch changes | No change |
| Change written duration | New written length on the grid, split at barlines and into tied values | Linked performance duration becomes `ticks * 60 / (bpm * 480)`; the onset is unchanged | No change to onset |
| Change start in the roll | Event start is snapped to the grid | Linked performance onsets move | Intentional timing edit; the selected note now plays at a different source time |
| Change tempo | Re-labels the beat grid and changes notation playback seconds | Onsets and durations are untouched | No change; “play from this note” still uses the performance seconds |
| Change performance length (inspector) | Written value stays; sustain detail changes in the roll | Linked performance duration changes | Onset unchanged |
| Change time signature | Rebuilds measure boundaries; events keep their ticks | No change | No change |
| Change key | Respells every pitch | No change | No change |
| Change staff/voice/spelling | No timing change | No change | No change |
| Tie to next | Merges the next same-pitch event into the selected one | The absorbed attack is removed; the remaining event gets the summed length | The surviving onset is unchanged |
| Delete rest | Removes the explicit rest and pulls later events in that voice earlier | Later linked onsets move earlier | Intentional timing edit |

Overwrite policy: increasing a written duration overwrites later events in the **same
staff and voice** inside the new span. Their performance notes are removed at the same
time so the roll cannot show a ghost note. Earlier material is shortened at the new start.
Other voices and the other staff are untouched. A written value may extend beyond the
clip's final measure, but the linked performance duration is clipped to the clip end so a
save cannot claim a source note after the video stops.

Tempo is a notation/playback control, not a video alignment control. The source video is
always indexed by the reviewed performance seconds. This is why a tempo change is safe for
“check this against the recording” work.

## Selection and shared undo

`EditorSelection` carries `event_id`, optional `note_id`, staff, voice, measure, linked
performance IDs, and (for rests/gaps) start/duration. The editor keeps one history stack
of `{document, selection}` snapshots:

- score click/keyboard selection, roll selection, and keyboard pitch highlights all read
  the same selection;
- every mutation goes through one `change(next)` callback, so the three views cannot
  diverge;
- undo/redo restores both the document and the selection; `Ctrl/Cmd+Z` and
  `Ctrl/Cmd+Shift+Z`/`Ctrl+Y` are supported outside form fields;
- a changed selection is not itself a document edit and does not create an undo entry.

The history is an in-memory editor stack, not a server revision history. Saving creates a
new immutable lesson revision through the existing `music-revision` endpoint.

## Persistence and validation

The notation object is saved inside the reviewed reference JSON as `notation` (an optional
field; older references remain valid). The save body repeats the performance events, and
the server checks that:

- the notation is piano, version 1, PPQ 480, and the same duration as the clip;
- measures are contiguous and use the declared time signature;
- event IDs and note IDs are unique; events are on the sixteenth grid and inside the last
  measure; voices do not overlap; chords do not repeat a pitch;
- `notation.performance` matches the reviewed event IDs, onsets, pitches, durations,
  velocities and optional flags exactly;
- the notation does not exceed the 20,000-event, 512-measure or 40,000-note limits.

The browser reader (`parseNotationDocument`) is stricter about spelling and rebuilds
`segments`/`ties` from the logical events. Stored derived data is never trusted.

The reference still carries its SHA-256 digest; the editor verifies the digest before
opening it. A save creates a new reference file and a new lesson revision, preserving the
release/update shared-version semantics already used by the review editor.

## Editing operations

Implemented in `packages/music-notation/edit.ts`:

- `changePitch`, `respellAccidental`, `setVelocity`;
- `changeDuration`, `moveEvent`, `changeStaff`, `changeNoteStaff`;
- `insertNote` (creates a chord note when the rhythmic slot is identical), `insertRest`;
- `deleteNote`, `deleteEvent`, `deleteRest` (closes the gap by pulling later material
  earlier);
- `tieToNext`, `untieLast` (splits the last written value off);
- `setTempo`, `setTimeSignature`, `setKeySignature`.

The editor's ♯ and ♭ buttons raise/lower the selected note by a semitone (so a white key
gets the expected accidental); ♮ respells only when the sounding pitch has a natural
spelling. The inspector also offers ± semitone and ± octave step controls for touch and
keyboard users who do not want to drag.

All mutations clone the document, apply the change, call `refreshNotation`, and return a
new document. Callers never mutate React state in place.

## MusicXML

`toMusicXML()` exports a MusicXML 4.0 partwise grand-staff part:

- `<divisions>480</divisions>`, key, time, staves and clefs;
- each staff as staff 1/2; voice numbers inside the staff; `<backup>` between voice
  streams and between staves;
- chords via `<chord/>`, rests, dotted values, accidentals, and ties via both `<tie>` and
  `<tied>`;
- a metronome mark and `<sound tempo>`.

The importer is intentionally not part of this slice. The exporter is validated against
the independent RiffScore importer; see the verification report. RiffScore keeps only the
first voice on a staff and warns, which is the candidate's limitation, not a malformed
export.

## Unsupported notation and known losses

- No tuplets, grace notes, slurs, articulations, dynamics, lyrics, pedals, repeats, voltas,
  fermatas, or ornamentation.
- One time signature and one key for the whole score; no mid-score changes.
- No pickup/anacrusis measure; the score starts at measure 1 with a full measure.
- At most two voices per staff; more simultaneous material is shortened or merged.
- No cross-staff beams or automatic beaming/engraving rules; eighth/sixteenth flags are
  drawn individually.
- No chord symbols in the notation document (the reference's guitar chord field remains
  separate and is not used for piano).
- Accidentals are printed whenever the sounding alteration differs from the key; repeated
  accidentals inside a measure are not suppressed, so courtesy marks may appear.
- MusicXML import is not implemented; only export.
- MusicXML loses the visual layout, the editor's selection/history, and any unsupported
  notation. RiffScore additionally drops the second voice on import.
- The BPM is an estimate unless the instructor changes it. It is not a claim about the
  performance's true tempo.
- The grand staff is always shown; there is no single-staff or multi-part mode.
