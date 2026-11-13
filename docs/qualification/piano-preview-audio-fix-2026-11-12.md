# Piano preview duration fix — 12 November 2026

The user reported that long notes remained highlighted in the roll/keyboard after their sound seemed to stop. Native browser offline rendering reproduced the fault: a six-second C4 at intensity 0.6 was **56.24 dB below its early level at 5.4 seconds**, although its displayed event was still active.

The old envelope decayed to 45% after about 0.4 seconds and then exponentially faded almost to zero over the remaining displayed duration. A range starting mid-note also applied an extremely short decay constant to its initial amplitude, making carried notes nearly silent.

## Change

- `piano-audition.ts` supplies one shared voice/envelope for proposal playback, finding-range auditions and notation auditions. It retains an initial attack/decay followed by a soft held tail and a short final release at the represented duration.
- Mid-note ranges keep elapsed envelope state, with no new full-strength attack. Cropped endings fade at the range boundary. Short notes are not expanded to a 60 ms minimum by the proposal/range player.
- The proposal playhead uses `AudioContext.currentTime`, so suspension and scheduling time do not let the visual clock run ahead of audio.
- Editing the proposal stops the queued old audio. Stop/unmount closes the context and cancels pending playback startup. Ready/stopped previews no longer illuminate an onset-zero note as though it were playing; explicit edit selection remains separate.

This is an approximate synthetic duration audition, not a sampled/calibrated piano or a change to inferred pitches, velocities, durations or correction policy.

## Verification

- **320 web tests passed**, including six new envelope/scheduling regressions.
- Production TypeScript/Vite build passes. Vite retains the existing large-chunk warning.
- `scripts/verify_piano_audition.py` passed using the actual preview component and native Chromium Web Audio. At 5.5 seconds the six-second note was still highlighted and its audio RMS was approximately **0.00640**. After the note ended, the key was unlit and RMS was **0**.
- Suspending the audio context freezes the displayed clock. Changing the proposal stops old audio. Long/short notes, chords, soft/loud response and mid-note clipped ranges passed native offline-render checks; sampled outputs stayed below clipping.
- The six-second range audition's late level is now **11.97 dB below its early level**, rather than 56.24 dB, and becomes silent after its end. This validates audibility/timing, not acoustic fidelity to the source performance.

Receipts: `.local/piano-audition-fix/before.json`, `after.json`, `browser-verification.json`, `web-tests.log` and `web-build.log`. No transcription model or backend schema was changed. Changes are uncommitted.
