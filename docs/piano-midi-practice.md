# Piano MIDI: setup pilot and next scoring phases

5 November 2026. **Setup only; no grading or attempt persistence.**

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

1. the lesson's reviewed assessment is `notes` and lists `midi` input;
2. the reviewed reference is loaded and bound to its reviewed hash;
3. the learner has explicitly started practice and selected one connected input;
4. the repeat is fully observed — seek, stop, hidden page or input replacement discards it.

Each repeat gets its own run clock (`wallStartMs`, reviewed range, speed, measured latency).
Attacks use `MIDIMessageEvent.timeStamp`, so simultaneous chord notes are individual
events, and are converted to reviewed source time with the measured input delay. Matching
reuses `matchOnsets`: one-to-one, exact pitch, required notes first, optional notes can
absorb input but never create missing-note corrections, edge notes unassessed.

`calibrateLatency` starts an eight-pulse visual calibration; at least four taps are
required and the clamped median (0–300 ms) becomes the session's measured delay. Without a
measurement, feedback still appears but is labelled approximate; timing corrections use
the unmeasured value 0.

The feedback contract (`apps/web/src/music/music-feedback.ts`) reports per repeat: matched,
missing, extra and unassessed counts plus corrected note names and early/late/on-time
direction. It has no score, percentage or grade, and it is never uploaded, persisted or
turned into an attempt.

Limits: only piano lessons with an explicit MIDI rubric are eligible; no latency
qualification on physical hardware; feedback remains approximate until calibrated; the
calibration UI is not yet exercised end-to-end in a browser check (its maths is unit
tested).

## Remaining implementation phases

| Slice | Work and acceptance |
| --- | --- |
| 6B: music practice controller | **Delivered 5 November 2026**: count-in, whole-lesson/section practice, four speed presets, repeat and clean reset; MIDI input remains optional and unscored. |
| 6C: opt-in local feedback | **Delivered 5 November 2026**: explicit gate, per-repeat timestamped capture, latency calibration and one-to-one corrections; unscored and local. Physical-device latency and coverage thresholds remain. |
| 6D: trustworthy scoring | Review assessable spans and exercise-specific limits before scoring. Current generic passage spans are not proof of assessability. Disconnects, hidden pages, seeks and dropped observations invalidate affected evidence rather than marking the learner wrong. Establish coverage/false-correction thresholds on physical keyboards. Watch-only manifests stay unscored. |
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
