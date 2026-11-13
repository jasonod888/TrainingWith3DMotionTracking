# Existing repository review: correcting piano transcription against source audio

Date: 12 November 2026  
Scope: repository discovery, source inspection and isolated velocity-inference experiments.
No application integration, production profile change or automatic-policy activation.

## Conclusion

Existing reusable implementations cover significant parts of this task. The earlier
plan was too oriented toward developing custom estimators before evaluating these
components. In particular, do not start another velocity-estimation implementation
without benchmarking Score-Informed AMT/VeloEst first.

I did not verify a single commercially cleared, production-ready repository that
accepts arbitrary initial piano notes plus original audio, corrects pitches/timing/
releases/velocities/pedals, matches the piano/room sound and demonstrates perceptual
indistinguishability. That is a bounded search conclusion, not proof none exists.

The useful distinction is between (a) ready pretrained components, (b) real but narrow
correction code, (c) research transcribers with internal refinement, and (d) sound
synthesis/editing models. They can reduce the custom work considerably, but they are
not interchangeable.

## 1. Best immediate reuse candidate: Score-Informed AMT / VeloEst

[Score-Informed AMT](https://github.com/zhanh-he/score-informed-amt) accepts audio and
aligned MIDI and supplies a pretrained velocity model plus inference code. Its code
has an MIT license. It does not recover missing pitches or repair timing; the supplied
events condition its velocity estimates. "Score-informed" here does not require the
user to upload sheet music: our transcription can supply the note events.

The related [Diff-SFProxy repository](https://github.com/zhanh-he/sfproxy-velocity-estimation)
has a simpler comparison CLI and bundled piano/adapted checkpoints. Inspection of
`scripts/infer_compare.py` confirms that it reads audio and MIDI, predicts velocities
and writes modified MIDI while preserving note timing. Root documentation states
CC BY 4.0; `score_hpt/LICENSE` is MIT. Pin the exact components and retain notices.
The inference path does not need to train the differentiable backend or install a
SoundFont. Optional rendered examples have extra dependencies.

**Assessment:** ready to test as a component; successfully executed here. Prefer the
base VeloEst checkpoint as the first benchmark, not an assumption that the adapted
checkpoint must be better. This can replace custom velocity-estimator research if
broader independent tests confirm its value. Existing identity/qualification/rollback
controls still belong around the component.

Pinned source revisions:

- Score-Informed AMT: `22b4db68389b9825ba88b197a93929a9e7be4847`.
- Diff-SFProxy: `c4440429ca674b57ac885e3ce25ea7661d06cf9a`.
- Base VeloEst weights SHA-256:
  `8cede73af4481661c51d7b409939489f32b208d6e971d833aac4a6e7eed438aa`.
- Piano-adapted weights SHA-256:
  `d22e589b2c46b6efd4fbd307c5130b5f083abedda543fdeb50f117b1bb230343`.

## 2. What was actually run

Only research folders were used. Existing application environments were not modified;
missing packages were installed into `.local/repo-research/runtime-deps/`.

The inference smoke run used Python 3.12, existing PyTorch 2.8.0, isolated torchaudio
2.8.0 and nnAudio 0.3.3, existing music-analysis packages, and CPU inference. This
differs from the upstream pinned Python 3.11/PyTorch 2.2.2 environment, so it establishes
local feasibility, not supported portability across every installation.

### User's original retained excerpt

- Exact retained analysis audio: 14.677 seconds.
- Input: current 34-note proposal converted/exported to MIDI, not a verified score.
- Base VeloEst and piano-adapted inference both completed and returned 34-note MIDI.
- Independent parsing confirmed all pitches, onsets and note endings remained unchanged.
- No verified velocities exist for this excerpt, so no velocity-accuracy claim is made.
- No realistic reconstruction audio was rendered or perceptually assessed in this run.

Artifacts: `.local/repo-research/velocity-clip-result/{summary.json,notes.csv,veloest.mid,diffsfproxy.mid}`.

### One independent public-reference probe

Used the first 20 seconds of the original Vienna recording
`Chopin_op38_p01.wav`, with the corrected captured-performance MIDI from the pinned
Vienna release. The MIDI was withheld from Basic Pitch, which transcribed only audio.
The velocity models received the resulting AI notes, not the reference notes.

Exact-pitch, one-to-one onset matching within 50 ms produced 93 matched notes from
114 reference notes and 108 detections. Thus there were also 21 missing and 15 extra
notes; velocity refinement did not fix these.

| Method | Mean absolute velocity error, MIDI units | Matched notes within 8 units | Improved / worsened versus Basic Pitch |
|---|---:|---:|---:|
| Current Basic Pitch piano decoder | 38.37 | 4 / 93 | Baseline |
| Base VeloEst | **9.03** | **43 / 93** | **90 / 3** |
| Piano-adapted Diff-SFProxy | 33.59 | 14 / 93 | 50 / 43 |

Base VeloEst moved two previously within-tolerance values outside the 8-unit tolerance;
the adapted checkpoint did so for three. Neither result satisfies the existing
zero-measured-damage qualification rule. Improved average error does not establish
95% correct final velocities, calibration to every piano, or better complete sound.
This is one development excerpt and cannot establish cross-domain generalization.

The comparison includes no onset alignment correction, no tuning of the checkpoints
on this example and no use of verified reference velocities as model inputs. The
reference is used only for scoring. MIDI round-trip checks confirmed timing and
pitches were preserved by both inference outputs.

Artifacts: `.local/repo-research/vienna-probe-evaluation.json`,
`velocity-vienna-result/`, `vienna-probe.mid`, `vienna-probe.wav` and cached raw predictions.
This example is now inspected development data and must not become untouched holdout.

## 3. Other close matches: what the code really does

### MIDI-grep — actual render/compare/revise loop

[Repository](https://github.com/dygy/MIDI-grep), revision
`f476cdb9366dabf424f839763b74b4b5a6897cb7`.

The current `scripts/python/ai_improver.py` contains iterative rendering, audio comparison,
LLM-driven Strudel revision and best-candidate tracking. README declares MIT. This is
the closest inspected workflow to the proposed feedback loop. Its output and renderer
are Strudel-oriented; it is not a validated piano-performance MIDI corrector. Search
snippets describe removed renderers, so use the pinned current code. Do not interpret
its similarity score as a probability of identical sound. **Reuse design/components
selectively; do not adopt it wholesale for faithful piano reconstruction.** Not run here.

### Stemforge — direct audio-informed note cleanup

[Repository](https://github.com/TheAgencyMGE/stemforge), revision
`96dac00656a16bf2a648056709f8dc0c90c26d41`.

`backend/stemforge/pipeline/refine.py` merges fragmented same-pitch sustains using CQT
attack evidence; other logic addresses bass octaves and cross-source duplicates.
The piano path is narrow cleanup, not general missing-note, velocity, pedal or sound
optimization. Documentation states MIT for its code and separates model terms. Its
reconstruction report even records failed render-fidelity engine selection. **Useful
reference for a targeted heuristic; not a complete reconstruction solution.** Source
inspected, pipeline not run here.

### D3RM — learned audio-conditioned piano-roll refinement

[Repository](https://github.com/hanshounsu/d3rm) and
[paper](https://arxiv.org/abs/2501.05068), revision
`8f7f2f6dc7ea612ce956695d15c203368dd982e5`.

The model iteratively denoises piano-roll states conditioned on an acoustic encoder.
That is genuine transcription refinement, but not a generic MIDI-in/audio-in repair
API for arbitrary Basic Pitch results, and it does not implement a renderer-matching
loop. README declares MIT and links pretrained models. The supplied setup uses old
NATTEN and dataset-oriented Lightning configuration; custom-file inference needs
adaptation. Its supplied configuration has `use_vel: False`; do not infer complete
expression/pedal support merely because a MIDI helper accepts those fields.
**Benchmark as a replacement transcription pipeline; not the first drop-in choice.**
Not executed here.

### audio2llm — comparison infrastructure, not a correcting optimizer

[Repository](https://github.com/IMNMV/audio2llm), revision
`def73f7d69c4a6b3f60f8db5b51e4f8861410301`, MIT.

It provides intended-versus-heard note comparisons and an analysis interface for
agents, using transcription of rendered audio. An external agent must make changes.
Re-transcribing through Basic Pitch is not independent ground truth. **Potential
reporting/interface reuse; not an automatic piano repair engine.** Documentation and
file inventory inspected; not executed here.

### Tsumugi — pretrained transcription plus separate velocity model

[Repository](https://github.com/anime-song/tsumugi), revision
`eba1c7d05e4d6a53cc4e8916d742d9623a3fdc38`, MIT code.

It offers audio transcription and post-estimation of velocities. Its "instrument
refinement" module reassigns instrument classes, not wrong piano pitches or the
complete performance. **A broader model comparison candidate, not evidence that
our requested correction loop is already solved.** Code/docs inspected, not run.
Record actual checkpoint/dependency terms before any production integration.

### Differentiable Dictionary Search

[Repository](https://github.com/CPJKU/DDS), revision
`11d70263ab87dd6b43fc9201c2397a8412959cd0`.

Optimization-based spectral decomposition is relevant to audio attribution. The
provided workflow is model training and frame-level evaluation, not polished MIDI
repair. It uses the unusual CRAPL license and a research environment. **Method
reference, lower priority than runnable pretrained velocity components.** Not run.

## 4. Sound matching: reusable but different task

[TokenSynth](https://github.com/KyungsuKim42/tokensynth) is particularly relevant to
the final timbre goal: it supplies a package, pretrained loading and an example
conditioning MIDI synthesis on an audio-derived timbre embedding. Code is MIT; it
also depends on pretrained DAC/CLAP components. Its example outputs 16 kHz audio.
It generates sound rather than correcting the supplied notes. **Evaluate as an
optional timbre-conditioned renderer, checking note adherence, pedal/dynamics,
codec fidelity, costs and exact checkpoint/dependency terms.** Not installed/run here.

[SpanSynth-Edit](https://mimbres.github.io/spansynth-edit/) uses MIDI and contextual
audio to guide synthesis/editing. [MIDI-VALLE](https://github.com/tangjjbetsy/MIDI-VALLE)
conditions piano synthesis on audio/MIDI context.
[P-MUSE](https://p-muse.github.io/) demonstrates reference-conditioned instrumental
synthesis. These are relevant sound-model research routes, not verified all-attribute
note-correction packages. No production readiness or commercial rights conclusion
is inferred from their demos. Do not make a generated audio clip sound convincing
at the expense of adherence to the editable note representation.

## 5. Search hits deliberately rejected as exact matches

- [Piano Sheet Music Transcriber](https://github.com/pengczhang/Piano_sheetmusic_transcription)
  describes the desired verification/refinement loop, but its implemented/next-steps
  sections distinguish the baseline transcription/export from the planned loop.
  A matching project goal is not evidence the repair system exists.
- [HearSay](https://github.com/Batuhanalperen/hear-say) wraps separation/transcription
  and minimal artifact filtering; it is not the requested full correction loop.
- [musiccleaner](https://github.com/Rapitzo/musiccleaner) changes waveform timing/
  amplitude and applies generic cleanup. Those operations can conflict with preserving
  the original performance; do not use "humanization" as faithful reconstruction.
- [PianoKontext](https://github.com/realfolkcode/pianokontext) generates expressive
  audio from deadpan material; expressive generation is different from recovering
  the precise original performance.

## 6. Revised development recommendation

1. **Reuse velocity first.** Add an isolated candidate adapter around base VeloEst,
   compare it with the current decoder and piano-specific model outputs, and evaluate
   fresh whole-performance references. Avoid developing another spectral-to-velocity
   mapping unless the existing models fail a documented requirement.
2. **Choose a stronger piano transcription baseline before extending repair logic.**
   Benchmark existing Transkun/ByteDance candidates, with D3RM as a higher-integration
   alternative. This attacks missing/extra notes and timing at their source.
3. **Reuse narrow audio checks only where needed.** Stemforge demonstrates concrete
   cleanup logic, but its parameters/evidence do not establish safety on our clips.
   Preserve raw events and qualify repeated-note handling independently.
4. **Use existing renderers and comparison libraries.** MIDI-grep demonstrates the
   orchestration pattern; its full application and code-generation policy need not
   become dependencies. Build only the piano-specific integration, candidate constraints,
   deterministic scoring and audit/rollback that existing code does not provide.
5. **Benchmark timbre-conditioned synthesis alongside the sample-based route.**
   TokenSynth is a usable prototype candidate. Do not promise sound identity from a
   generic piano sample bank or a neural timbre embedding without listening evidence.
6. **Preserve the acceptance gates.** None of these repositories eliminates the need
   to test complete-system natural-error improvement, damage, playback semantics,
   licensing, resource costs and audible fidelity in our product.

The immediate recommendation is **component reuse plus a small comparative prototype**,
not implementation of every research algorithm in the earlier plan. A working velocity
component is now demonstrated on local inputs. The remaining all-attribute reconstruction
and exact-source-sound gap is still real and must be measured, not assumed away.

## 7. Reproduction and review evidence

The inspected repository inventories, revisions, licenses and source snippets are in
`.local/repo-research/`. Two checkpoint hashes were verified before inference.
The public inference entry used was:

```text
scripts/infer_compare.py --audio <recording.wav> --midi <detected-notes.mid> --out <research-folder> --device cpu
```

The user's original clip and public probe were processed locally. No audio was sent
to another service, no LLM API was invoked, and no production note corrections were
applied. Only VeloEst/Diff-SFProxy inference was executed; the other repository
assessments are explicitly source/document review, not claimed end-to-end tests.
