# Music guide and player

5 November 2026. Reviewed music lessons now open a guide with instructor playback. This
does not enable music processing, sharing, scoring or MIDI input, and no model is involved.

## What a learner sees

The existing private music preview destination (also reached from the conversion card and
Studio preview) now renders `MusicLessonHome` as a player:

- the retained instructor video with its original audio, or an explicit "video unavailable"
  panel and a timer-only guide;
- Play/Pause, a position slider labelled **Lesson position**, elapsed/total time, and
  **Seek to section** buttons that seek to each teaching section;
- an animated piano keyboard (white and black keys) or a guitar fretboard (standard
  tuning E2–E4, frets 0–12, lowest-fret position);
- the notes currently sounding, named (`C4`, `E4`, …) and their current reviewed passage;
- reference details and an explicit statement that no camera, microphone or MIDI access
  was requested.

Optional notes are drawn like other notes. The guide has no scoring, no microphone or MIDI
input, no practice mode and no persistence.

## Reference reader

`apps/web/src/music/music-reference.ts` validates the reviewed reference at runtime before
anything is drawn (version 1, piano/guitar, positive duration, unique note ids, pitches
0–127, note ends inside the clip, passages ordered and inside the clip, review evidence
shape). Invalid documents produce a readable error instead of a partial guide. The same
module holds the pure timing and geometry helpers (`activeEvents`, `currentSpan`,
`pianoGeometry`, `guitarPosition`), so the guide's maths is tested without a DOM.

Timing is driven by `video.currentTime` when a video is present, otherwise by a
`requestAnimationFrame` clock started from Play. Section buttons seek the video and clock
together. The reviewed reference is bounded at 20,000 notes and 500 passages by both the
server contract and the reader.

## Verification

| Check | Result |
| --- | --- |
| `apps/web/tests/music-reference.test.mjs` | **5 passed**: valid/invalid documents, active-note windows, piano geometry, guitar positions |
| `scripts/verify_music_guide.py` | **Passed**: video loads, keys follow reviewed timing, section seek, playback, no device requests, phone + desktop screenshots |
| `scripts/verify_music_screen.py` | **Passed** for piano and guitar: guide renders, no page errors or camera/microphone/MIDI requests |
| `scripts/verify_summary_discovery.py` | Still **passes** with a reviewed music reference and lazy loading |
| Web suite | **253 passed**; TypeScript, production build and bundle check pass |

Screenshots: `test-results/music-guide-phone.png`, `test-results/music-guide-desktop.png`,
`test-results/music-fixture-phone.png`, `test-results/music-fixture-desktop.png`.

## Limits

- No scoring or microphone input. An explicitly gated MIDI setup pilot is documented below.
- Guitar positions use standard tuning only; capo and alternate tunings are shown as
  metadata, not applied to the fretboard.
- The whole reference is fetched and held in memory (bounded); there is no offline cache.
- The instructor video is the retained private asset; if an old draft lost its source, the
  guide falls back to timer-only playback.


## Review continuation: timing, truthfulness and opt-in setup

The player now verifies reference bytes/length against the immutable manifest hash,
requires complete review evidence, and binds duration/instrument settings to the lesson.
On a lesson change the old reference is removed before the next one can draw. Failed
video playback switches to the usable timer guide; playback can restart from the end,
pauses when hidden, and cancels its frame work/pauses old media on exit. Video time is
sampled each animation frame rather than relying on coarse `timeupdate` events. Attack
highlights do not begin early, and teaching-section state is independent of passage spans.
Piano black-key width/position scale with white-key units, including compact ranges.

Guitar positions remain illustrative. Capo/alternate tuning suppress unsupported markers
while leaving pitches and video usable. Simultaneous lowest-fret positions that conflict
on a string are not drawn; the UI explains that reviewed fingering is needed. Tuning/capo
remain visible as metadata. This is not an instructor hand/finger reconstruction.

A disabled-by-default `MUSIC_MIDI_SETUP_ENABLED` pilot can show a piano keyboard check.
It is unscored and never opens a port on preview. See `docs/piano-midi-practice.md`.
Normal preview's no-device-request behavior is unchanged.

Latest checks: 257 web tests passed, TypeScript/build/bundle checks passed, extended guide
browser checks and virtual-MIDI lifecycle checks passed. These supplement the earlier
verification record above; they do not certify physical hardware or model accuracy.
