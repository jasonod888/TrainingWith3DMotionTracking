# Piano MIDI: setup pilot and next scoring phases

Updated 9 November 2026. **Local unscored feedback; no grades or attempt persistence.**

## Delivered: Phase 6A input setup

The existing music preview can show a **Keyboard check · unscored** panel when
`MUSIC_MIDI_SETUP_ENABLED=true`. The setting defaults to **false** and is independent
of music processing. This continuation did not enable it in any deployment. Guitar and
movement destinations do not gain keyboard controls.

Watching never requests an input device. Only **Connect a keyboard** calls
`requestMIDIAccess({sysex:false})`. The learner then chooses one input. The panel echoes
pressed keys, sounding notes including sustain, and note attacks. It does not synthesize
sound, judge correctness, store raw MIDI or send a progress/attempt request. Use the
keyboard's own sound.

`packages/music-engine/midi.ts` normalizes note-on, velocity-zero release, note-off,
repeated attacks, per-channel sustain, and all-notes/all-sound-off. Pressed keys and
pedal-held sound remain separate. Unselected inputs cannot affect state. Device changes,
disconnect, page hiding and leaving the lesson clear notes and close the selected port.
Late permission results after exit do not attach listeners or open ports. Permission
denial and unavailable Web MIDI leave the guide usable.

The pilot is not learner practice completion. It may be enabled for internal tests on a
watch-only reference without upgrading that reference's assessment policy. A connection
or played note must never be treated as consent to start a scored attempt.

## Delivered: Phase 6B timed practice controls

A reviewed piano lesson now offers a **Timed practice** panel next to the guide:

- practice range: the whole lesson (continuous) or one teaching section;
- count-in: off, 2 or 4 beats at 0.5 s per beat;
- repeats: 1, 2, 3 or 5 runs, with a 1.5 s rest between runs;
- speed presets: 0.5×, 0.75×, 1× and 1.25× (wall time scales; reviewed source time does not);
- a visible count-in, "Run N of M", rest countdown and an unscored completion summary.

The controller is pure (`apps/web/src/music/music-practice.ts`) and tested without a DOM or
browser. Seeks, section changes, Play, leaving the lesson and choosing a different keyboard
input stop practice and reset it. Watching still requests no device. MIDI is optional:
`MidiKeyboardCheck` exposes normalized snapshots to the guide, and note attacks are counted
only while a run is playing. No note is judged, stored or sent anywhere.

Limitations for the next slice: attacks are counted, not timestamped or matched; the
practice clock is a monotonic wall clock with the video paused, so 6C must map input
timestamps to that same timeline and compensate measured latency before any feedback.

## Delivered: Phase 6C gated local feedback

Feedback is produced only for an **explicitly MIDI-enabled piano rubric**:

1. the reviewed assessment uses supported `piano-midi-v1`, `notes`, `midi` input and exactly the implemented `pitch`/`timing` dimensions;
2. the reviewed reference is loaded and bound to its reviewed hash;
3. the learner has explicitly started practice and selected one input whose port has opened successfully;
4. the repeat is fully observed — seek, stop, hidden page or input replacement discards it.

Each repeat gets its own run clock (`wallStartMs`, reviewed range, speed, timing offset).
Attacks use `MIDIMessageEvent.timeStamp`, so simultaneous chord notes are individual
events, and are converted to reviewed source time with the optional personal alignment estimate. Matching
reuses `matchOnsets`: one-to-one, exact pitch, required notes first, optional notes can
absorb input but never create missing-note corrections, edge notes unassessed.

The UI offers eight visual alignment pulses. At least four distinct pulses need taps;
chords/double taps contribute only one sample per pulse. `calibrateLatency` filters
offsets to 0–300 ms and returns the median. This is a personal timing estimate including
human reaction/anticipation, not a hardware-latency measurement. Feedback stays
approximate even after alignment. Without an estimate the offset is 0. Switching inputs,
hiding/leaving the page or changing the reference cancels calibration and its pending
completion timer. Input replacement/reference changes clear the estimate. Practice and
alignment cannot run together.

The feedback contract (`apps/web/src/music/music-feedback.ts`) reports per repeat: matched,
missing, extra and unassessed counts plus corrected note names and early/late/on-time
direction. It has no score, percentage or grade, and it is never uploaded, persisted or
turned into an attempt.

Limits: only piano lessons with an explicit MIDI rubric are eligible; no latency
qualification on physical hardware; feedback remains approximate after visual alignment.
The calibration UI now has browser coverage for eight pulses, duplicate-tap suppression
and input-change cancellation. No score or persistent attempt is produced.

## Delivered: instructor assessment policy and observation coverage

The owner review screen now includes an **Assessment** choice:

- **Watch only** (default): no corrections are produced.
- **MIDI note feedback (unscored)**: the saved review carries `assessment: notes`,
  `input_modes: [midi]`, dimensions `pitch` and `timing`, and rubric `piano-midi-v1`.

The server validates the policy: MIDI feedback is piano-only, requires `midi` input,
the two implemented dimensions and the supported rubric; watch-only refuses input modes
and dimensions. The policy is stored in the reviewed manifest and in the review audit
record (`MusicReview.document.assessment`), and it is part of the idempotency fingerprint.
Saving still does not publish, score or persist attempts.

Feedback now reports **observation coverage** per repeat: matched, missing, extra,
assessed/total notes and the coverage fraction. Notes near a section edge without a
complete tolerance window are `unassessed`; they never become corrections. Optional notes
still never produce missing-note corrections. The Phase 6D readiness foundation
(`packages/music-engine/scoring-readiness.ts`) remains unused for grading: the editor does
not pretend that a saved policy is physically qualified or scoreable.

Limits: the policy is chosen during review; editing an already reviewed policy is not
implemented, readiness thresholds are not enforced in the editor, and no physical-keyboard
qualification has been run. Scores, grades and attempts remain disabled.

## Remaining implementation phases

| Slice | Work and acceptance |
| --- | --- |
| 6B: music practice controller | **Delivered 5 November 2026**: count-in, whole-lesson/section practice, four speed presets, repeat and clean reset; MIDI input remains optional and unscored. |
| 6C: opt-in local feedback | **Delivered 5 November 2026**: explicit gate, per-repeat timestamped capture, latency calibration and one-to-one corrections; unscored and local. Physical-device latency and coverage thresholds remain. |
| 6D: trustworthy scoring | **Partly delivered 9 November 2026**: instructor assessment-policy choice, per-repeat observation coverage and edge-note handling. Physical-device qualification, enforced thresholds and false-correction measurements remain. |
| 6E: persistence and rollout | Add a separately versioned, bounded music-attempt contract tied to reference hash, revision and rubric. Reuse the account/history destination without changing pose-attempt payloads. Avoid stable device identifiers and raw performance uploads by default. Qualify browsers/devices and gated deployment before a learner rollout. |

These slices can proceed while PostgreSQL and model/device qualification run. None of the
virtual-input tests qualifies real MIDI hardware, input latency, phone Safari support,
musical technique or model accuracy. Microphone assessment remains a separate future path.

## Test evidence

- MIDI engine tests cover attacks, releases, channel isolation, sustain, resets and invalid
  messages. No browser dependency is required for those tests.
- `scripts/verify_music_midi.py` uses virtual ports and verifies no access on preview,
  explicit permission, selected-input isolation, sustain, device switching/disconnect,
  hidden-page/exit cleanup, denied and late permission, unsupported browsers and no media,
  progress or attempt requests. It is not hardware qualification.
- `scripts/verify_music_review.py` covers choosing the MIDI policy, save retry with the same policy and private preview; the server tests cover policy validation and publishing refusal.
- `scripts/verify_music_feedback.py` covers matching and missing corrections per repeat for a MIDI rubric, the approximate-delay notice, and watch-only lessons staying ungraded with no persistence calls.
- `scripts/verify_music_practice.py` covers count-in, section practice, repeats, completion and clean reset on seek, plus attack counting with a virtual keyboard; no media or attempt requests.
- Guide browser checks also cover failed-video fallback, replay after end, hidden-page
  pause, old-reference removal during a delayed lesson switch, and a tampered-reference
  refusal. Normal preview remains device-free with the pilot off.
- The project-authored symbolic corpus in `packages/lesson-schema/fixtures/music-corpus`
  supplies repeatable scale, repeated-attack, chord, optional-note, guitar and silence
  cases. It contains no real recordings or model output.

No new model/runtime dependency was installed, and music processing, sharing and scoring
remain disabled.


## Follow-up review of bbf45bb and Phase 6C foundation

The timed-practice slice can proceed. Corrected phase-boundary time loss by carrying
frame overshoot through count-in, playing and rest, including multiple transitions in
one update. Practice stops on page hiding/pagehide even without MIDI. Native video
transport is unavailable during practice; a native play event resets practice rather
than starting a second clock. Rest holds at the range start and completion ends at the
range end. The UI explains the silent guide and fixed visual 120 BPM count-in; this is
not an inferred tempo. Without a selected keyboard, completion says no input was
measured. Keyboard counts describe MIDI attacks, not musical correctness. Snapshot
callbacks run per input event, outside batched React rendering, with resets forwarded.

`packages/music-engine/onsets.ts` begins **6C as pure, unused analysis helpers**:

- Map a monotonic MIDI event timestamp onto one repeat's source clock, subtracting
  measured observation latency in wall milliseconds before applying playback speed.
  Reject invalid clocks; timestamps outside that repeat are excluded.
- Match distinct attacks one-to-one by exact pitch and source-time tolerance. Required
  notes take priority over optional notes. Missing optional notes produce no corrections.
- Exclude notes whose full tolerance window is outside the fully observed range; nearby
  input is unassessed rather than reported as a false extra. The helper returns pairs,
  signed timing differences, missing/extra IDs and an unassessed count, never a score.
- Duration and pedal are not inferred from attacks. Existing MIDI normalization keeps
  physical key state separate from pedal-held sound.

These helpers are **not connected to the practice UI** and do not constitute rubric
feedback, real timestamp capture, latency measurement or hardware qualification. Callers
must first bind an exact reviewed reference/revision and an explicitly MIDI-enabled,
versioned rubric; authorize feedback with an explicit learner action; collect bounded
per-repeat MIDI timestamps in the same clock domain; and discard interrupted evidence.
The current watch-only reference remains ungraded. Generic teaching spans are not
assessment coverage. A next slice can implement that contract and capture/calibration
flow behind a default-off feedback gate, then connect the matcher. No persistence or
body-practice contract change is required for that slice.

Verification for this continuation: 267 web tests; TypeScript/build and bundle check;
practice, MIDI lifecycle and guide Playwright scripts. The practice script additionally
checks hiding without a keyboard and three synchronous attacks (no React batching loss).
No API/schema change, model selection, deployment, commit or push was performed.


## 9 November continuation: feedback corrections and 6D readiness foundation

Reviewed `de094a9`; continued development is supported. Run timing now starts at the
practice action (including count-in off), and repeat clocks account for transition
overshoot instead of starting late at a rendering frame. A frame gap over 250 ms aborts
analysis instead of manufacturing missing notes from a stalled timeline. Input is bounded
to 20,000 valid attacks per repeat. Unknown rubric versions or unsupported dimensions
cannot reuse fixed note-feedback tolerances.

`packages/music-engine/scoring-readiness.ts` is an **unused, pure Phase 6D foundation**.
It returns readiness reasons and observed coverage, never a grade. Its policy binds an
exact reference hash/revision/rubric, explicitly reviewed assessment spans, allowed
speeds, minimum required notes, maximum polyphony and a coverage threshold. Coverage
uses interval unions, so overlapping samples/passages cannot inflate evidence. Empty
assessment coverage, interrupted runs, visual-only alignment, unqualified policy and
identity/exercise-limit mismatches all refuse readiness.

The caller must derive note/polyphony counts and observation intervals from verified
reference and run evidence; the helper does not certify supplied data or qualification
flags. Test thresholds and qualified flags are synthetic fixtures, not approved production
policies. No policy was qualified, authored through the instructor UI or connected to a
score. Existing teaching spans must not be substituted for assessment spans.

Next: add the separately versioned instructor assessment-policy contract/editor and
collect actual input-observation coverage. Choose and validate exercise thresholds and
timing evidence with physical keyboards, then connect the readiness checks behind a
scoring gate. The bounded persistence contract can be designed alongside this work;
no saved grade should precede evidence qualification.

Verification: **276 web tests**, TypeScript/production build and bundle checks pass.
Feedback browser coverage includes calibration and cancellation; practice, MIDI lifecycle
and guide regression checks pass. No server/schema changes; Python tests were not rerun
(previous reported result: 292 passed, 13 skipped). Processing/sharing/scoring stay
disabled. Changes in this continuation are local and uncommitted; nothing was pushed.


## Review of 97c73a3 and initial Phase 6E persistence

The instructor policy authoring and reference-note counts support continuing. Fixed the
server's acceptance of pitch-only/timing-only policies: supported `piano-midi-v1` now
requires exactly both dimensions. Guitar cannot select the piano-only MIDI option in
the review UI; each newly loaded review resets to Watch only. Save retries retain edits
and policy, and a changed policy for a finalised draft is refused.

The previous "coverage" display was reference-window eligibility, not observation
coverage. The guide now says **notes eligible for comparison**, with an explanation.
No actual input-coverage threshold or physical-device qualification is implied. The
readiness helper remains a separate foundation; teaching spans are not qualified
assessment spans. Policy re-editing after review remains follow-on work.

Added the **default-off Phase 6E backend foundation** for bounded, client-reported,
unscored summary history. It has its own contract/table and 5,000-account allowance,
exact reference/revision/policy binding, idempotent UUIDs and private read/delete paths.
It refuses raw MIDI and grades. The pose endpoint now refuses music revisions. No
client save/history UI or automatic upload was added. See `music-history.md` for the
contract, migration 0020, limits and next client-integration work. Unscored history can
progress alongside physical qualification; scoring remains disabled.


Verification of the 97c73a3 continuation: full configured Python suite **296 passed,
13 skipped**; latest complete-only history checks **3 passed**; web suite **277 passed**.
TypeScript/production build and bundle check pass. Browser checks for instructor review
(including guitar policy availability), local feedback/reference-window wording and the
movement feed pass. All three lesson-schema artifacts are current. Migration SQL renders
through 0020; no PostgreSQL migration or physical-device qualification was performed.
No commit, push, deployed flag change or automatic learner upload was performed.
