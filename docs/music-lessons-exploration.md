# Piano and guitar lesson pipeline exploration

Prepared 4 November 2026. Status: feasibility review and proposed implementation; no model has been benchmarked on this platform yet.

Implementation sequencing and the shared instructor/learner experience are specified in the [Multi discipline implementation plan](multi-discipline-implementation-plan.md).

Commercial licensing update: see [Commercial licensing review](model-commercial-licensing.md), which supersedes the preliminary license assessments below. Basic Pitch is the default commercial baseline; Transkun's bundled MIT distribution is a qualified piano candidate. PitchPlease, AutoTab v2, ByteDance's external checkpoint, and MT3's external checkpoints remain outside the production selection until their identified artifact permissions are established. Guitar-Transcription's separate weights repository explicitly declares MIT.

## Recommendation

Add piano and guitar as lesson types alongside full-body lessons. Reuse upload infrastructure, access controls, immutable lesson revisions, sections, looping, and attempt boundaries. Add a music reference representation, instrument renderer, and event-based assessment engine.

Use audio to draft the instructor's note timeline, then require instructor review of assessed passages. Generate keyboard or fretboard animation directly from the approved events. Use browser MIDI or microphone observations to assess the learner. Hand tracking can become a separate, optional technique feature after note and rhythm coaching works.

The practical first product is piano key animation with MIDI feedback, followed by microphone feedback for restricted exercises and beginner guitar lessons. Guitar chord guides are feasible early; recovering the instructor's exact string positions or finger movements is a separate problem.

This extends the existing `requirement/Guitar_Piano_Interactive_Lessons_Technical_Design.docx`. That document explicitly did not assume codebase access. This review adds findings from the current checkout and evaluates the supplied audio-first model shortlist. It recommends moving mandatory hand and instrument calibration out of the initial product.

## Findings in the current checkout

| Existing component | Finding | Required music change |
| --- | --- | --- |
| `apps/web/src/CreateLesson.tsx` and `prepareClip.ts` | Local trimming creates a 15 fps video with `audio: {discard: true}`. The UI explicitly says audio is removed. | Select lesson type before preparation. Preserve audio for music, validate the resulting audio track, and support a suitable export fallback if the browser cannot encode it. Audio already removed from old uploads cannot be recovered. |
| `scripts/saas_worker.py` | Accepts the local `sam-3d-body-v1` route and builds a preview with FFmpeg `-an`. | Dispatch music jobs to their own worker; preserve synchronized audio and video. Do not send them through body reconstruction. |
| `apps/api/processing.py`, `database.py`, `conversions.py` | Pipeline versions and worker credentials already exist, but routing and asset lists assume body conversion. | Make routing and worker eligibility depend on lesson type and pipeline version. Update lease, completion, and asset validation together. |
| `apps/api/contracts.py` and `packages/lesson-schema/` | Manifest v1 requires a skeletal animation, landmarks, metric axes, and standing reference time. | Introduce a versioned discriminated contract for body and music. Music must not need dummy GLBs or body coordinates. |
| `packages/learning-engine/playback.ts` and `practice-session.ts` | Sections, loops, speed controls, countdowns, and attempt boundaries are useful shared infrastructure. | Reuse controls and lifecycle; provide an audio-aware clock for music and a separate event evaluator. |
| `packages/learning-engine/competition-session.ts` | Aggregates reliable feedback into time bins. | Music results must aggregate reference events and attacks, with uncertainty and coverage. Time-bin motion scoring is not a music rubric. |
| `apps/web/src/lesson-clock.ts` | Snaps time to reconstructed frames, normally 15 fps. | Preserve continuous audio/MIDI timestamps. A 66.7 ms frame is too coarse to be the timing unit for music assessment. |
| `apps/web/src/InstructorVideo.tsx` | Instructor video is always muted and follows the movement player. | Add audible demonstration mode and music-specific synchronization. Avoid repeated seeks during musical playback; test pitch-preserving slowdown. |
| `apps/api/lessons.py` and `permissions.py` | Imports, asset delivery, public manifests, and trimming enumerate body-specific assets or animation offsets. | Add music asset discovery, revision-safe edits, time mapping, and release visibility. Private extracted audio must follow private source-video rules. |

These findings support reusing the platform, but adding a lesson selector alone would not produce a working music pipeline. Existing in-progress body changes were left untouched.

## Model shortlist and what has been verified

Repository documentation was checked on 4 November 2026. The recommendations below are engineering judgments, not comparative benchmark results. Repository code licenses do not by themselves settle every checkpoint, dataset, or dependency's terms.

| Candidate | Verified role and limitation | Proposed decision |
| --- | --- | --- |
| [Spotify Basic Pitch](https://github.com/spotify/basic-pitch) | Polyphonic audio-to-MIDI with pitch bends; instrument agnostic, works best with one instrument at a time. Apache 2.0 code. | Baseline for uploaded guitar audio; compare on piano too. Keep it on an isolated instructor worker initially. |
| [Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts) | Official browser-capable implementation; processes audio windows and resamples to 22,050 Hz. | Useful alternative and offline browser experiment. Window processing alone does not establish acceptable live coaching latency. |
| [Transkun](https://github.com/Yujia-Yan/Transkun) | Piano audio-to-MIDI; CLI, CUDA option, MIT repository license. Its shipped checkpoint does not extend note lengths by sustain-pedal duration. | Primary piano authoring candidate. Compare against Basic Pitch and teacher annotations; keep key release separate from audible sustain. |
| [PitchPlease](https://github.com/markusstrasser/pitchplease) | Current README describes streaming trained models, AudioWorklet/WASM, and MIT licensing. Reports a 545 KB piano model, frame-level F1 of .729 for piano and .818 for guitar, with median onset-detection latencies of 40/33 ms. Evaluation uses 25 piano and 20 guitar excerpts; phone testing is not established. Repository tagline still describes an older non-ML detector. | First live microphone candidate. Pin and inspect the actual release and weights. These are author-reported figures, not whole-lesson accuracy or measured microphone-to-feedback latency on our devices. |
| [AutoTab v2](https://github.com/chessfromthefuture/autotabv2) | GuitarSet-trained framewise string/fret prediction with shipped weights. README says onset detection is absent; held notes can appear as repeated frets. No clear license was established in this review. | Research only until rights, event decoding, and generalization are validated. Do not use as the default source of graded guitar timing. |
| [Guitar-Transcription](https://github.com/ErenReyhanlioglu/Guitar-Transcription) | GuitarSet-trained multitask audio-to-tablature repository with pretrained checkpoints. | Compare as a guitar position-suggestion candidate, independently of pitch transcription. Pin weights and verify their terms. |
| [ByteDance piano transcription](https://github.com/bytedance/piano_transcription) | Piano transcription repository; archived 8 December 2025. | Offline comparison candidate if needed; budget maintenance work before adoption. |
| [Magenta MT3](https://github.com/magenta/mt3) | Multi-instrument transcription on T5X, with pretrained inference examples. | Defer: more deployment complexity than the initial solo-instrument scope needs. |

Riff and unofficial Rust ports from the supplied notes are secondary implementation references. They were not independently evaluated here and are not dependencies of the proposed first version.

For compatible digital keyboards, [Web MIDI](https://www.w3.org/TR/webmidi/) exposes device messages directly. It is an input path, not a transcription model or MIDI-file parser. Capability detection and device permission are required; microphone mode remains a separate fallback. Digital note messages provide evidence of played keys, not finger identity or acoustic sound quality.

## Instructor experience

1. Choose Full body, Piano, or Guitar, then upload and trim the video. Music preparation keeps the audio. Optionally attach MIDI or enter a chord sequence; neither is required for ordinary upload.
2. Confirm the demonstrated instrument and, for guitar, tuning, capo, and handedness. A close-up camera is needed only for future visual technique assessment.
3. Mark the passages intended for practice. Suggest passages automatically where helpful, but let the teacher exclude speech, pauses, background music, and discussion over playing. Silent segments must not silently become scored rests.
4. Transcribe playing passages on the backend. Preserve raw output, model identity, hashes, and the exact source-time mapping. For long passages, handle chunk overlap and merge sustained notes and duplicate detections at boundaries.
5. Show the real video beside a piano roll/keyboard or guitar guide. The teacher corrects notes, attacks, duration, section boundaries, and guitar shapes, then selects the assessment focus.
6. Publish an immutable reviewed reference. Inferred events are drafts until approved for grading. Low-quality passages can remain demonstration-only.

Transcription creates pitches and times, not necessarily readable sheet music. Beat estimation, quantization, meter, notation spelling, and engraving need their own editing and rendering work. Preserve expressive source timing even if a quantized practice score is added later. Imported MIDI also needs alignment to the video; file time zero is not proof of synchronization.

## Animation approach

Piano: drive a procedural 2D or Three.js keyboard from note-on/off events. Add falling notes, upcoming-note cues, phrase loops, and optional teacher-entered left/right-hand colors. Separate key-down animation from sustain resonance. This requires no reconstruction model and fits the existing Three.js stack.

Guitar: begin with a chord diagram, highlighted strings/frets, tab cursor, and attack cues. A pitch can occur on several strings, so a generic note timeline is insufficient to reproduce the teacher's actual fingering. Use reviewed chord shapes or proposed playable positions with explicit uncertainty. Record actual sounding pitches separately from displayed fret labels, with a defined tuning/capo convention.

Animated hands are a later feature. Procedural hand poses based on approved fingering can illustrate one valid way to play; they must not be presented as recovered instructor motion. Faithful finger animation needs additional visual inference, instrument geometry, occlusion handling, and validation. A rotatable virtual instrument also does not create new real-video camera views.

## Learner experience and feedback

Offer three modes: watch the instructor with synchronized animation; play along at a chosen tempo; and practice at the learner's own pace. For microphone practice, a watch-then-play loop is a useful default because the instructor's audio can otherwise be mistaken for the learner.

The learner chooses MIDI or microphone. A camera is optional for the first version. Capture music with noise suppression, automatic gain, and echo cancellation disabled where supported; inspect actual device behavior. Recommend headphones for play-along practice. Speaker playback, metronome bleed, clipping, and background music should reduce assessment confidence rather than generate confident errors.

Normalize incoming observations into note/attack events with capture timestamps, detection availability timestamps, pitch confidence where available, and input provenance. A detector's active-note frames are not themselves a sequence of new attacks: repeated-note exercises need validated re-articulation detection. Do not invent per-note probabilities for adapters that do not expose them.

Use two separate alignment policies:

- Fixed tempo: map reference events through count-in, playback speed, and calibrated input delay. Match each observation at most once, handle chord attack spread, and score early/late attacks within an explicit tolerance.
- Own pace: use bounded online sequence alignment to follow the learner without requiring instructor timestamps. Permit recovery after skipped or repeated notes. Report sequence correctness separately from rhythm; unlimited time warping would hide timing mistakes.

Distinguish missing/extra notes, pitch correctness, attack timing, duration, and assessable coverage. MIDI key release and pedal state differ from microphone decay estimates. Chord identity is not proof of a particular voicing, every sounding string, fret position, or strum direction. Uncertain detection produces “could not assess,” with coverage shown separately from the score.

Use event time for scoring and the audio clock for scheduling; use display frames only to draw animation. Calibrate the mapping between AudioContext, monotonic MIDI timestamps, and media time. Reset pending notes, matcher state, and clock anchors on seek, loop, input loss, or tempo change. Measure full capture-to-feedback latency, including buffers and decoding, separately from onset localization error. Mobile backgrounding must pause or invalidate an attempt.

## Proposed contract and implementation boundaries

Introduce an explicitly versioned body/music manifest union, with old v1 manifests interpreted as body lessons. Deploy readers that accept both before enabling music creation. Update Python, TypeScript, JSON Schema, fixtures, and permission views together. Existing strict v1 validation forbids arbitrary new fields.

The shared envelope contains IDs, title, duration, sections, source media, and revision metadata. Music adds instrument configuration, approved reference asset, rubric version, assessed ranges, and model provenance. Body keeps skeletal animation and landmarks. Music has no standing-height calibration requirement.

The reference asset should contain:

- Continuous lesson-relative seconds, explicit mapping to source media, stable event IDs, and schema version.
- Notes with sounding MIDI pitch, onset, key release if known, sounding end if known, optional velocity, attack groups, and evidence provenance.
- Optional beat/tempo map, chord symbols, required/optional notes, and teacher-approved alternatives.
- Guitar shapes with explicit string ordering, open/muted states, tuning, capo, and whether fret numbers are relative to the capo.
- Independent optional fingering annotations, review state, detector metadata, and confidence only where meaningful.

Keep raw proposals separate from reviewed references. A correction creates a new revision and assessment identity; previous attempts stay tied to the version they used. Trimming must update ranges and mappings consistently, including notes crossing trim boundaries. Keep the current contiguous section contract; model assessable playing spans separately within sections containing explanation or silence.

Suggested new modules are `scripts/music_worker.py`, `packages/music-schema/`, `packages/music-engine/`, `apps/web/src/music/`, and a music reference editor. These paths are proposed, not implemented. Add a backend route registry so body and music workers claim only supported pipeline versions. Keep heavyweight transcription dependencies outside the existing body environment.

New assets include reviewed music JSON, optional MIDI export, waveform summary, audio-bearing preview, and thumbnail. Update completion checks, checksum validation, storage records, import/export, trimming, quota accounting, and public/private asset filters together. Keep raw learner audio on device by default; any later recording upload should be a distinct user action.

## Proof of concept and release gates

First prove the full path with a teacher-approved MIDI fixture and synchronized video: animation, editing, MIDI observation, alignment, looping, and event feedback. This separates application defects from model errors. Then replace fixture authoring with transcription adapters and compare against annotated references.

| Experiment | Reference evidence | Measurements |
| --- | --- | --- |
| Piano MIDI | Captured device events and a known exercise | Repeated notes, note-off, velocity-zero note-on, pedal, disconnects, count-in, tempo changes, seeks, and duplicate event handling |
| Instructor piano transcription | Teacher annotations; synchronized MIDI where available | Transkun versus Basic Pitch note precision/recall, onset error, release conventions, and editing time per minute |
| Live piano microphone | Simultaneous MIDI and microphone recording of the same playing | PitchPlease note/event accuracy across polyphony, pedal, repeated notes, rooms, and devices |
| Guitar melody | Annotated pitches and attacks | Basic Pitch offline and PitchPlease live; harmonics, open strings, clean electric and acoustic audio |
| Guitar chords | Teacher-labeled chord attacks and acceptable voicings | Per-chord confusion, missing-note false accusations, arpeggios, muted strings, attack spread, and playback leakage |
| Guitar position proposals | Annotated string/fret performance | AutoTab v2 or Guitar-Transcription position accuracy, correction burden, and supported tuning limits |

Use separate tuning and held-out evaluation clips. Compare live detectors against human/MIDI evidence, not another model's predictions as ground truth. Include intentional learner mistakes and uncontaminated correct performances. Report note-event and frame metrics separately, alongside uncertainty coverage and false corrections.

Test at least desktop Chrome/Edge, a representative Android phone, and iPhone Safari with animation and video running. Feature-detect MIDI, AudioWorklet, and relevant acceleration. Record startup/download cost, memory, sustained compute load, p50/p95 end-to-end latency, timestamp drift, and thermal slowdown. Browser-only inference does not imply mobile readiness.

Provisional engineering targets, to revise after the first benchmark: approved MIDI fixtures score deterministically across supported navigation; audio/video synchronization error stays within 50 ms over a short lesson; supported live exercises reach p95 feedback under 250 ms; false corrections on assessable correct events remain below 5%, while at least 80% of required events are assessable. Report per-device and per-exercise results. Abstaining on almost everything cannot satisfy the last target. Unsupported chord complexity should fall back to delayed feedback or unscored demonstration.

Recommended delivery order is shared contracts/audio preservation, then piano rendering and MIDI assessment, offline piano drafting and review, limited microphone coaching, and beginner guitar guides and assessment. Exact fingering, strum direction, expressive guitar techniques, and full hand animation require subsequent validation. There is no credible delivery-date or cost estimate until the transcription and browser spikes establish editing burden, processing throughput, and target-device coverage.

The next concrete build should therefore be one short piano lesson running end to end in the existing application, with a real video, reviewed note timeline, animated keys, and MIDI feedback. That establishes the reusable music foundation before adding harder acoustic and guitar inference.
