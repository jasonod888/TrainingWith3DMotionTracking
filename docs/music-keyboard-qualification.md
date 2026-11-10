# Physical-keyboard qualification (protocol)

10 November 2026. **Not executed.** This environment has no physical MIDI keyboard, so no
hardware, browser/OS or latency qualification is claimed. This protocol defines what must
be run before any scored rollout; it is not evidence of a pass.

## Why it is separate

Virtual ports and mocked Web MIDI verify code paths, not hardware. Physical qualification
must distinguish real input delivery, personal timing alignment, reference-note eligibility,
actual input-observation continuity and false corrections on the browsers and devices learners actually use.

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
3. Run **Estimate timing alignment** (visual alignment). Record that this estimates personal
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
- Timing direction agrees with independently labelled input onsets for controlled
  early/on-time/late trials. Human taps changing direction across takes are diagnostic
  observations, not proof that the device or algorithm is wrong.
- Fully observed takes report the expected eligible/total notes; edge notes remain
  unassessed.
- Disconnect, hidden page and device replacement never produce a saved scored result.
- Latency figures have an independent method and uncertainty if a hardware-latency
  threshold is required. A round-trip loopback includes the output path; do not label it
  input-only latency unless that path has been measured and removed. The visual estimate
  cannot supply hardware-latency evidence.

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


## Review corrections and evidence requirements

- Feature-detect Web MIDI on each exact browser/OS/device combination first. If absent,
  record **unsupported** and verify the guide/fallback without device access. Do not
  record a successful fallback as hardware or scored-practice qualification. Browser
  names in the matrix are targets to check, not compatibility guarantees.
- Record USB-MIDI transport and adapters/hubs separately from connector shape (USB-C).
  Include channel/split/layer settings; otherwise duplicate channel attacks can look
  like an algorithm error. MIDI alone cannot establish fingering, posture or technique.
- Use independent ground truth for correctness: a rights-cleared reviewed note sequence,
  annotated actual attacks/releases and a common clock or measured clock mapping. Keep
  human-performance trials separate from controlled/device-generated timing trials.
  Correct and deliberately wrong/early/late/omitted/extra cases are all required.
- Record actual observed intervals/dropouts independently. The displayed **eligible of
  total** is reference-window eligibility and cannot demonstrate continuous observation.
  A connected port and absent error message alone do not prove delivery of every event.
- Report false missing/extra/timing corrections with their denominators and exercised
  note counts, speeds, chord spread and repeat counts. Three subjective takes are a
  smoke test, not evidence sufficient to accept a false-correction threshold. Do not
  select production thresholds from these proposed checks without reviewing results.
- Interruption checks apply to the affected repeat. A previously completed, explicitly
  saved summary may remain in history; it is not an invalid partial repeat or a grade.
- The current app has no qualified diagnostic export for capture-versus-delivery timing.
  External synchronized measurement or a separately reviewed local diagnostic harness
  is required for that part of qualification. This Markdown procedure is a manual
  protocol, not an automated hardware test.

Raw recordings, MIDI traces and device identifiers remain local/consented and outside the
repository. `test-results` is ignored scratch output, not the durable qualification
record. Once real tests run, retain a reviewed, sanitized aggregate record under
`docs/qualification/` with the exact app commit, reference hash/revision, rubric, source
fixture rights, browser/OS versions, anonymized device category, measurement method,
uncertainty, sample counts, interruptions, support result, proposed threshold and explicit
approval status. Do not add a passed result until hardware evidence exists.

**Status: blocked on 10 November 2026.** No physical MIDI instrument is attached to this
host; the recorded Windows inventory identified only software MIDI endpoints. The
headed/headless Chromium request was denied permission, so successful input enumeration
was not completed (rather than proving an empty enumerated device list). The protocol was therefore not
executed. Evidence: [`qualification/music-keyboard-2026-11-10-blocked.json`](qualification/music-keyboard-2026-11-10-blocked.json).
No latency, coverage, false-correction or device-matrix result is recorded. Database
concurrency/recovery tests are independent and cannot qualify MIDI hardware, model
accuracy or a scoring rubric.


### Review of b70656c

The blocked hardware attempt is an honest non-qualification result. Keep hardware
inventory, API availability, permission grant and successful input enumeration as
separate fields; denied access is not an empty enumeration. The recorded probe's empty
fallback array is retained as raw reported output, while `inputs: null` and
`enumeration_completed: false` express the supported conclusion. No new probe was run
for this wording correction.

Proceed with unscored pilot development, history and model benchmarking in parallel.
A first physical-keyboard smoke test can use one available keyboard/browser before the
larger device matrix; it is evidence for that combination only, not universal or scored
qualification. A transcription artifact still requires its own code/weights commercial
licence evidence and real acoustic benchmark before processing is enabled. Broader
production load and operational recovery remain rollout work, not a blanket stop on
private unscored development. No scoring, model or deployment gate was enabled here.
