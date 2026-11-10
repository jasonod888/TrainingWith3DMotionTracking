# Reviewed guitar positions and chord authoring

10 November 2026. Instructors can now save explicit string/fret positions per note and
reviewed chord shapes; the guide renders those choices instead of inferred fingering.

## Data contract

- Each music note event may carry `string` (1 = high E … 6 = low E) and `fret` (0–24).
  They must appear together and must match the note pitch in standard tuning
  `E2 A2 D3 G3 B3 E4`; a mismatch is rejected (422). Omitting both keeps the old fallback.
- A reviewed reference may carry up to 100 `guitar_chords`, each with a unique id, name,
  start time, six frets ordered **low E to high E** (`-1` muted, `0` open, `1–24` fretted)
  and a base position. The draft/review/edit contracts validate bounds and uniqueness.
- The edit endpoint persists both into the new immutable reference; the manifest and
  learner release rules are unchanged.

## Authoring during draft review and later editing

Guitar positions and chords can now be authored in the **initial draft review**, not only
after the lesson is saved: the review form has the same string/fret and chord controls and
sends them with the reviewed reference. The post-review **Edit lesson** path remains for
later changes; both create immutable revisions and preserve the shared release.

For guitar lessons, the reviewed-lesson editor adds:

- per-note **String** and **Fret** controls; choosing a position sets the pitch to the
  standard-tuning value, and changing the pitch clears an inherited position;
- **Reviewed chord shapes** with name, start, base position and six fret fields, plus
  add/remove;
- the existing title, notes, passages, sections and watch/MIDI policy editing.

Saving still creates a new revision; learners keep the current shared release until
**Update shared version**. Piano lessons do not show these controls.

## Guide

- `guitarGuide` prefers an explicit reviewed position for each active note; notes without
  one use the previous illustrative lowest-fret fallback. When any reviewed position is
  present, the notice says markers are the instructor's reviewed choices.
- A lazy `GuitarChordCards` panel renders hand-built SVG diagrams for reviewed chords,
  highlights the chord active at the current guide time and labels the string order. No
  vendor chord database, sample assets or chord-inference claim is involved. SVGuitar is
  still not imported by the application.
- The chord panel is a lazy chunk, keeping the music-screen static closure within budget.

## Verification

| Check | Result |
| --- | --- |
| `tests/api/test_music_edit.py` | Positions/chords persist; pitch/position mismatch rejected |
| `apps/web/tests/music-reference.test.mjs` | Position/chord parsing, duplicate/bounds rejection, explicit guide preference |
| `scripts/verify_guitar_authoring.py` | Post-review editor saves string/fret and a C chord; preview renders marker and chord card; no device requests |
| `scripts/verify_guitar_review.py` | Initial draft review saves position/chord; chord panel renders, is keyboard-focusable and phone/desktop layouts do not overflow |
| `tests/api/test_music_review.py` | Draft review persists positions/chords; invalid fret window rejected |
| Web suite | **289 passed**; TypeScript/build pass; music screen 16,075 B gzip (within 16,384) |
| Full API suite | **326 passed, 13 skipped** |

## Limits

- Standard tuning only; capo, alternate tunings and left-handed positions remain
  unsupported and are refused/hidden rather than guessed.
- Chord shapes are reviewed display data, not strum/voicing assessment; no scoring.
- No chord inference, microphone/guitar assessment or public/group music release.
- Positions are authored after review through the editor; the initial review screen does
  not yet expose them.


## Review fixes in this slice

- **Validation:** sounding frets must fit the four-fret window at the chord's base
  position, in addition to bounds/uniqueness/pitch checks.
- **Fret display:** the SVG diagram uses that window and shows the base position; invalid
  windows are rejected rather than silently clipped.
- **Mixed markers:** explicit reviewed positions win; only conflicting fallback markers are
  hidden, with an honest notice. Fallback-only conflicts remain fully hidden as before.
- **Feedback order:** corrections now carry their reviewed/performance time and sort by it,
  not by error seconds (which floated missing/extra entries unpredictably).
- **Accessibility/responsive:** the chord strip is keyboard-focusable, cards carry ARIA
  labels, and phone/desktop checks assert no page overflow.
