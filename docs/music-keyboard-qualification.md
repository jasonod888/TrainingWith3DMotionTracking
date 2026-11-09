# Physical-keyboard qualification (protocol)

10 November 2026. **Not executed.** This environment has no physical MIDI keyboard, so no
hardware, browser/OS or latency qualification is claimed. This protocol defines what must
be run before any scored rollout; it is not evidence of a pass.

## Why it is separate

Virtual ports and mocked Web MIDI verify code paths, not hardware. Physical qualification
must measure real input delivery, personal timing alignment, observation eligibility and
false corrections on the browsers and devices learners actually use.

## Prerequisites

- A reviewed piano lesson with the supported `piano-midi-v1` notes policy (`midi` input,
  `pitch` and `timing` dimensions) and a fully reviewed reference.
- MIDI setup enabled locally only (`MUSIC_MIDI_SETUP_ENABLED=true`); history may stay off.
- Vite dev server and a signed-in test account.
- Physical keyboards covering: 61-key and 88-key, USB-MIDI and USB-C, at least one with a
  sustain pedal; desktop Chrome/Edge, Android Chrome and iPad Safari where available.
- A way to record the device, OS, browser version, connection and keyboard firmware.

## Procedure per device

1. Open the reviewed lesson and confirm the guide plays and the reference loads.
2. Connect the keyboard, select its input, and confirm presses echo. Watching alone must
   not request MIDI access.
3. Run **Measure input delay** (visual alignment). Record that this estimates personal
   alignment/reaction time, not hardware latency.
4. Play three takes of one short section at 1× with a 2-beat count-in, then one take at
   0.75×. Do not seek, hide the page or disconnect during a take.
5. Record, per take: matched, missing, extra, eligible/total notes, alignment estimate,
   whether any correction looks musically wrong, and any missed disconnect.
6. Repeat with the sustain pedal, a repeated-note passage, a chord, and an intentionally
   disconnected keyboard (the take must be discarded, not marked wrong).
7. Repeat one take with the page hidden mid-run; it must be discarded.

## Proposed pass criteria (not yet accepted)

- Every interrupted run is discarded, never graded.
- No false missing-note corrections on correctly played chord/repeated-note takes.
- After visual alignment, timing direction is stable across the three takes (no take
  flips early/late for the same passage).
- Fully observed takes report the expected eligible/total notes; edge notes remain
  unassessed.
- Disconnect, hidden page and device replacement never produce a saved scored result.
- Latency figures are obtained independently (e.g., a loopback/DAW measurement) if a
  hardware-latency threshold is required; the in-app visual estimate cannot supply it.

These thresholds need a product decision and must not be inferred from virtual tests.

## Evidence

Record results in `test-results/keyboard-qualification-<date>.json` with fields:
device, OS, browser version, connection, firmware, keyboard layout, section, speed,
alignment estimate, per-take counts, interruption result and operator notes. Keep raw
recordings out of the repository.

## Status

**Not run.** No physical device is attached to this environment. Until this protocol is
executed and accepted, scoring and grades remain disabled; unscored local feedback and
explicit unscored history may continue.
