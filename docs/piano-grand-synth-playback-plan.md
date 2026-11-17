# Grand Piano Live Playback, Audio Switch & Touch-Responsive Velocity Plan

## Goal and Authorization

Enable users in the Piano Review workspace (`page=music-review`) to switch between **Original** video audio and **Piano** (live-synthesized grand piano note playback driven by the recorded/edited performance occurrences and their velocity data), with an upgraded **Option A (pure Web Audio acoustic grand piano synthesis)** engine and touch-responsive key audition.

- Preserve all existing uncommitted work (including the completed piano hand-assignment changes) and checkpoint `91c7d1604d714af45a0d918e64c6dc7630e0ee60`.
- Leave all changes uncommitted; do not commit, push, deploy, or install external dependencies.

---

## 1. Current Architecture & Identified Gaps

1. **Hidden / Disabled `Piano` Switch (`PianoWorkspaceHarness.tsx`):**
   - Currently, the `Original | Piano` toggle in `.ws-audio` (bottom playback dock) and the Sound drawer only renders the `Piano` button when `previewAsset` (`draft.piano_preview` server WAV) is non-null, and disables/exits `Piano` mode whenever `previewStale` becomes `true` after any note edit.
   - For drafts without a pre-rendered WAV (or after editing any note), users have no way to switch playback from the original video audio to the piano notes.
2. **Hardcoded Velocity on Note Preview (`PianoWorkspaceHarness.tsx`):**
   - `audition(pitches, seconds)` hardcodes `velocity = 0.7` (`audioRef.current.play(pitches, ..., 0.7)`), ignoring `selected.velocity` when previewing a note from the Note Editor or mobile peek.
3. **Audio Graph Node Leak (`notation-audio.ts`):**
   - `NotationAudio.play()` creates a new `DynamicsCompressorNode` on every call and connects it to `this.master` without ever disconnecting it, duplicating compression stages and leaking Web Audio nodes over time.
4. **Register-Blind Filter Cutoff & Flat Tone (`piano-audition.ts` & `music-velocity.ts`):**
   - `schedulePianoVoice` sets a low-pass filter to `velocityCutoff(velocity)` (`650 Hz` base) regardless of `pitch`. For high notes (`C6–C8`, `1046–4186 Hz`), a soft velocity muffles the fundamental frequency itself.
   - A single static oscillator with no hammer transient, no register-scaled harmonic profile, and no soundboard/unison warmth sounds like a flat electronic test tone rather than a grand piano.
5. **Non-Responsive Key Clicks (`KeyboardEditor.tsx`):**
   - Clicking/tapping keys on the keyboard calls `onKey(key.pitch, false)` with no velocity information.

---

## 2. Product & Technical Requirements

### A. Always-Available `Original | Piano` Switch & Live Note Playback
1. **Dock & Sound Drawer Switch:**
   - Render both `Original` and `Piano` buttons in the `.ws-audio` playback dock group and the Sound drawer (`data-ws-section="sound"`).
   - **Compatibility with Verified WAV Preview (`previewAsset`):**
     - When `previewAsset` is present and actively verifying (`!preview.url && !preview.error`), keep `Piano` disabled with the `"Verifying piano audio…"` status (preserving `workspace-piano-integration.test.tsx` acceptance 1).
     - When `previewAsset` is verified and `!previewStale`, `usePianoSourcePlayer` may drive the verified `<audio>` element as before (and if `<audio>` playback fails with a media error, fall back to `Original` per acceptance 2–4).
     - **Live Grand Piano Synthesis Mode:** Whenever `previewAsset` is absent (`null`) OR `previewStale` is `true` (notes were edited in the workspace), `Piano` is **enabled** and drives live Web Audio grand-piano synthesis directly from `document.performance`!
     - Update the Sound drawer hint (`data-preview-state`) to clearly explain when `Piano` is using live synthesized grand piano notes (e.g., when no pre-rendered WAV exists or after note edits).
2. **Source-Clocked Live Note Scheduler:**
   - The `<video>` element (or `clockRef` when no video URL exists) remains the **single master clock**. Live piano synthesis must never free-run its own independent timer when transport is paused, stalled, or seeking.
   - When `audioMode === 'piano'` in live-synth mode:
     - Mute the `<video>` element (`video.muted = true`) while preserving and restoring the user's prior `muted` state when switching back to `Original` or unmounting.
     - Schedule/trigger notes from `document.performance` as the master clock crosses each note's shifted onset (`shiftOnset(note.onset, offsetSeconds)`), scaling audible duration by `playbackRate` (`0.5×`, `0.75×`, `1×`).
     - Support mid-note start/seek: when playback starts or seeks into the middle of an active note (`start < sourceTime < end`), schedule that voice with `elapsed` set to the note's elapsed time so it enters smoothly at its decayed sustain level without a harsh re-strike.
     - Each occurrence (`note.id`) is triggered at most once per continuous playback pass; seeking, pausing, changing `playbackRate` or `offsetSeconds`, switching to `Original`, or unmounting immediately stops active scheduled voices and resets the active-voice tracker.
     - Editing notes (`document.performance`) while in `Piano` mode immediately reflects the updated pitch, onset, duration, and `velocity` on subsequent or rescheduled notes.

### B. Option A: Grand Piano Acoustic Synthesis & Velocity Expression
1. **Use Recorded/Edited MIDI Velocity Everywhere:**
   - During live `Piano` transport playback, pass each occurrence's `note.velocity` (`0.0–1.0`, defaulting to `DEFAULT_VELOCITY = 0.5` when null/undefined) into the grand piano synth.
   - In `PianoWorkspaceHarness.tsx`, update `audition(pitches, seconds, velocity?)` so previewing a selected note (`selected.velocity`) in the Note Editor (both desktop and mobile peek) and auditioning during edits uses the note's actual velocity rather than a hardcoded `0.7`.
2. **Grand Piano Timbre & Velocity Modeling (`music-velocity.ts` & `piano-audition.ts`):**
   - **Pitch-Aware Filter Cutoff:** Add a pitch-aware cutoff helper (e.g. `pitchVelocityCutoff(pitch, velocity)` while keeping `velocityCutoff(velocity)` exported for backward compatibility) so filter cutoff scales with both the note's fundamental frequency $f_0 = 440 \times 2^{(pitch - 69)/12}$ and velocity. Soft high-register notes must retain their fundamental clarity, while hard strikes open up bright upper harmonics.
   - **Register-Scaled Harmonics & Decay:**
     - Bass notes (`pitch < 48`) have richer warm upper harmonics and longer decay time constants; treble notes (`pitch > 76`) have cleaner fundamental/2nd-harmonic focus and shorter, percussive decay constants.
     - Faster attack time on higher velocities (`ff` strikes speak faster than `pp` touches).
   - **Unison Detuning & Hammer Transient (Grand Piano Character):**
     - When the audio context supports full synthesis (or inside the grand piano voice builder), add subtle unison string detuning (e.g., a secondary detuned string oscillator in mid/high registers at a lower blend level) and a brief velocity-scaled hammer strike transient at `elapsed === 0` (using filtered burst or rapid pitch/filter envelope) plus warm soundboard resonance on the shared master bus in `NotationAudio`.
     - **Preserve Existing Test Contracts:** Ensure `auditionEnvelope`, `envelopeGainAt`, `velocityGain`, `velocityCutoff`, `velocityDecay`, `velocityPartials`, and `schedulePianoVoice` still satisfy all assertions in `apps/web/tests/piano-audition.test.tsx` and `apps/web/tests/music-velocity.test.mjs` (for example, `piano-audition.test.tsx` uses a minimal `fakeAudio()` mock where `schedulePianoVoice` is tested for `audio.oscillators.length` and `audio.curves[0]`; keep `schedulePianoVoice` compatible with minimal mocks or gate multi-node unison/transient layers on full `AudioContext` capability / helper so existing tests pass without weakening assertions).
3. **Fix `NotationAudio` Compressor Leak (`notation-audio.ts`):**
   - Reuse the master compressor/gain chain created in `ensure()` rather than allocating and leaking a new `DynamicsCompressorNode` on every `play()` call.
   - Add a warm acoustic body/resonance filter stage on the shared bus so chords and rapid arpeggios blend smoothly without clipping.

### C. Touch-Responsive Keyboard (`KeyboardEditor.tsx`)
1. **Pointer Velocity Derivation:**
   - When a user clicks or taps a key in `KeyboardEditor.tsx`, compute a touch velocity in `[0.25, 0.95]`:
     - Use `PointerEvent.pressure` when meaningful (`pressure > 0 && pressure !== 0.5`), or compute vertical position along the key (`(clientY - rect.top) / rect.height`, mapped so striking near the top of the key is softer `~0.35` and near the bottom front edge is louder `~0.9`).
     - Keyboard activation (`Enter` / `Space`) uses a sensible default (`0.7`).
   - Pass `velocity?: number` as an optional 3rd parameter in `onKey(pitch: number, auditionOnly: boolean, velocity?: number)` (backward-compatible with existing callers) and forward it to `audition([pitch], 0.4, velocity)` in `PianoWorkspaceHarness.tsx`.

---

## 3. Focused Validation Requirements

- Update `apps/web/tests/workspace-surfaces.test.tsx` (`R5`) to reflect that `Piano` is now available without a pre-rendered WAV preview (using live grand piano synthesis) while keeping `Original` active by default.
- Ensure `apps/web/tests/workspace-piano-integration.test.tsx`, `apps/web/tests/piano-audition.test.tsx`, `apps/web/tests/music-velocity.test.mjs`, and `apps/web/tests/piano-source-components.test.tsx` pass.
- Add focused tests covering:
  1. Switching between `Original` and `Piano` when no `piano_preview` WAV exists (and when `previewStale` is true after a note edit): mutes video in `Piano` mode, triggers live note synthesis with each note's `velocity`, and restores video audio on `Original`.
  2. Note editor `Preview` button passing the selected note's actual `velocity` to `NotationAudio.play`.
  3. Touch-responsive key velocity calculation in `KeyboardEditor` and pitch-aware velocity synthesis curves.
- Run `npx tsc --noEmit` in `apps/web` and `git diff --check`.
