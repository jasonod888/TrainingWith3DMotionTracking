# Editable sheet music: verification

11 November 2026. Evidence for the notation model, editor, persistence and export. This
records what was actually run. It does not qualify physical iOS/Android devices, every
notation edge case, or production deployment.

## What was built

- **Shared notation core:** [`packages/music-notation`](../packages/music-notation) —
  performance-to-score interpretation, measures, ties, voices, staffs, rests, edit
  semantics, strict reader, MusicXML export.
- **Owner editor:** [`apps/web/src/music/notation`](../apps/web/src/music/notation) —
  linked grand-staff editor, piano roll, keyboard, video, inspector, shared undo/redo,
  phone measure view.
- **Persistence:** optional `notation` on the reviewed reference, saved with the existing
  immutable `music-revision` flow and server-side integrity checks.
- **Representative fixture:**
  [`packages/music-notation/fixtures/representative-piano.json`](../packages/music-notation/fixtures/representative-piano.json)
  (two measures, both staves, an E4/G4 chord, an independent held B4 voice, a barline tie).
- **Existing Basic Pitch lesson fixture:**
  [`packages/music-notation/fixtures/basic-pitch-piano.json`](../packages/music-notation/fixtures/basic-pitch-piano.json)
  (the 12 s, 59-note test transcription rendered as 6 measures, both staves, both voices,
  18 ties).

## Automated checks

| Check | Result |
| --- | --- |
| Notation core (`tests/music-engine/notation.test.ts`) | **9 passed** |
| Editor interaction (`apps/web/tests/notation-editor.test.tsx`) | **3 passed**: chord-note selection, duration, undo/redo, add/delete, phone tabs |
| Full web suite (`npm test`, `apps/web`) | **306 passed** (includes the 9 notation-core tests) |
| Full API suite (`pytest tests/api -q`) | **267 passed** |
| TypeScript (`tsc --noEmit`) | Passed |
| Production build (`npm run build`) | Passed |
| Bundle budget (`scripts/check_web_bundle.mjs`) | Passed: initial **132,653** gzip; music shell **16,266** of 16,384; piano additional **7,848**; guitar **17,002** |
| Lazy editor chunk | `MusicLessonEditor` **77.84 kB raw / 24.41 kB gzip** (plus its CSS); not in the learner music shell |

The core tests cover: both staves, chords, two voices, generated rests, barline ties,
changing one chord pitch, quarter→half→whole with overwrite and a barline tie, performance
cleanup when material is overwritten, performance sustain independent of written value,
add/delete note, add/delete rest, tie merge, staff move for one chord note, tempo isolation
from performance, strict save/parse round-trip and MusicXML content.

## Browser evidence

All three scripts run the real built UI with mocked API documents in Chromium. They are
not device certification.

### `scripts/verify_music_edit.py`

Viewport **390×844**, `has_touch=True`, `is_mobile=True`. **Passed.**

- touch-tapped a C4 notehead on the phone score;
- changed written duration with the Half button and undid it;
- changed pitch through the on-screen keyboard;
- added and deleted a note in a gap using the piano roll to seek;
- saved a new revision and asserted the POST contained the notation document;
- reopened the saved reference and asserted the half-note duration survived;
- downloaded MusicXML and checked the XML declaration, `score-partwise`, both staves and
  `<backup>`;
- no camera/MIDI requests, no page errors.

Screenshots: `test-results/music-notation-phone.png`,
`test-results/music-notation-desktop.png` (ignored local artifacts).

### `scripts/verify_music_notation_view.py`

Viewport **390×844** touch, then **1280×1000** desktop. **Passed.**

- representative fixture renders **7 notes, 1 tie, 2 measures**, both staves;
- measure navigation exposes the bass G2 in measure 2;
- tapped the E4 inside the E4/G4 chord, saw both chord-note buttons, selected G4;
- changed only that chord pitch to A4 through the keyboard; E4 remained;
- selected note highlighted in the piano roll and keyboard;
- quarter → half → whole: written length changed to 4 beats and the score gained the
  expected additional barline ties;
- undo twice restored 7 notes / 1 tie;
- “Play from selected note” moved the source `<video>` currentTime to the performance
  onset (≥0.45 s for a note at 0.5 s);
- all three views visible together on desktop;
- no page errors.

Screenshots: `test-results/music-notation-passage-phone.png`,
`test-results/music-notation-passage-desktop.png`.

### `scripts/verify_music_notation_basic_pitch.py`

Viewport **390×844** touch, then **1280×1000** desktop. **Passed.**

- opens `packages/music-notation/fixtures/basic-pitch-piano.json`, derived from the
  existing 12 s Basic Pitch draft;
- asserts **6 measures, 59 notes, 18 ties**, both staves and the dense two-voice material;
- measures 1–2 are treble material, measure 3 is selected through the measure control;
- a note in measure 3 receives focus and is selected with Enter (keyboard path), and the
  inspector reports measure **3 / 6**;
- the piano roll and keyboard show the selection on desktop; score, roll and keyboard are
  visible together;
- no page errors.

Screenshots: `test-results/music-notation-basic-pitch-phone.png`,
`test-results/music-notation-basic-pitch-desktop.png`.

## MusicXML interchange

`toMusicXML()` output was imported by **RiffScore `1.0.0-alpha.18`** (pinned commit
`2d1d673…`), an independent notation editor:

- Simple two-staff passage: `ok: true`, **zero warnings**.
- Representative passage with a second voice on the treble staff: `ok: true`, with the
  expected warning: “Staff 1 has more than one voice; only voice 1 was imported (the editor
  holds one voice per staff).”

That is a real import, not an XML well-formedness check. The second-voice loss is
RiffScore's documented model limit. Our own importer is not implemented.

## Persistence evidence

- `tests/api/test_music_edit.py::test_edit_persists_notation_and_refuses_a_mismatched_performance`
  saves notation with the new revision, asserts the stored reference and performance
  velocity, then refuses a notation document whose performance pitch disagrees with the
  reviewed events with **422**.
- The browser test saves, reopens and verifies the half-note duration and MusicXML export.
- The reference SHA-256 is still verified before the editor opens it. Saving still creates
  a new immutable revision and does not update the shared release.

## Acceptance map

| # | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Both piano staves, chords, independent rhythms | Existing Basic Pitch draft renders 6 measures / 59 notes / 18 ties, both staves and both voices; `verify_music_notation_basic_pitch.py`; core test asserts treble/bass and two voices; RiffScore import sees both staves | Delivered for two voices per staff |
| 2 | Select/change one pitch in a chord | Browser tap E4/G4 → G4 → A4; E4 remains; core test | Delivered |
| 3 | Quarter → half → whole, capacity/rests/ties | Browser half→whole with “4.00 beats” and 3 ties; core test asserts barline split and overwrite | Delivered with documented overwrite policy |
| 4 | Add/delete notes and rests | Core add/delete note and rest-close-gap; browser add/delete note; toolbar Add rest / Delete rest | Delivered; deleting a rest closes the gap |
| 5 | Linked roll and keyboard after edit | Browser asserts one selected roll note and one selected key; all views share one document/selection | Delivered |
| 6 | Play from selected note at the source time | Browser asserts video currentTime ≥ 0.45 s for a 0.5 s note | Delivered |
| 7 | Undo/redo across views | React test does Half → Undo → Redo → Undo; one shared history | Delivered |
| 8 | Save/reopen without losing notation, timing or velocity | API test and browser save/reopen; velocity preserved in reference and notation | Delivered |
| 9 | MusicXML opens in another editor | RiffScore import, zero warnings on single-voice; warning on second voice | Delivered with documented multi-voice loss |
| 10 | Mouse/touch on agreed desktop, iOS and Android | Desktop Chromium and 390×844 touch Chromium emulation only | **Partial** — no physical iOS/Android, Safari or Firefox evidence |

## Limitations and unverified areas

- **No physical-device matrix.** The phone check is Chromium emulation with touch, not an
  iPhone, iPad or Android handset. Drag gestures, virtual-keyboard behaviour, browser
  chrome and safe-area insets on real devices remain unverified.
- **No screen-reader or switch-input session.** Note controls have names and focus, but
  assistive-technology usability was not tested.
- **No audio listening test.** Audition is headless; the check only verifies that it does
  not throw and that the video seeks.
- **No long-lesson or dense-score stress test.** Limits are enforced (512 measures,
  20,000 events, 40,000 notes), but a full-length lesson was not rendered or edited.
- **No real transcription round-trip.** The fixture is hand-built from Basic Pitch-style
  events. A real draft through the worker/review path with notation was not run.
- **No MIDI import, tuplets, slurs, dynamics, lyrics, repeats, pickups or mid-score
  key/time changes.** See [`music-notation-model.md`](music-notation-model.md).
- **MusicXML import is absent.** Export is one-way.
- **The 16,384-byte music-shell budget has only 118 gzip bytes of headroom** after this
  slice. The notation editor itself is lazy, but any further static growth in the learner
  music shell would fail the current cap.
- No commit, push, deployment or feature-flag change was made.
