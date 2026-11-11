# Piano transcription verification: developer brief

Status: proposed development, not implemented. Research and scope agreed in discussion on 11 November 2026. This document specifies an investigation and staged delivery; it does not claim that the proposed verifier has been validated on our recordings.

## Objective and reason

Improve piano transcription by checking the detected notes against the original audio, identifying disagreements, and proposing evidence-backed corrections. Basic Pitch remains the initial detector. The new stage must distinguish a suspicious passage from a sufficiently supported edit, and must be able to leave a passage unresolved.

The current decoder improves attack selection, but it cannot ensure that every quiet chord note was found, every detected pitch is real, or every repetition and onset is correct. Lowering a threshold globally can recover notes while introducing many additional detections. Instead, investigate local alternatives where the audio and draft disagree.

Expected benefits are fewer duplicate or unsupported attacks, better local onset timing, recovery of some missing notes, and clearer evidence for instructor review. These are goals to measure, not guaranteed outcomes. A masked quiet note may be impossible to distinguish from the surrounding notes.

## Integration point

Proposed processing sequence:

1. Existing media validation and audio extraction.
2. Existing Basic Pitch inference and selected decoder.
3. **New piano-only audio verification stage**, using that exact audio, decoded proposal, and retained model activations.
4. Owner review, with linked score, piano roll, keyboard, and source playback.
5. Existing reviewed revision and release workflow.

Initially run step 3 in diagnostic mode. Preserve the current proposal unchanged and store a separate report and optional alternative proposal. Do not replace existing reviews or shared releases. Once qualified, supported edits may form a new proposed draft while retaining an accessible original and complete change history. Owner acceptance must continue through the existing review workflow.

Use the same extracted audio and time origin as inference. Record the media/analysis identity so a report cannot be applied to a different trim or revision. Keep performed note times separate from written score values. The verifier must not quantize expressive timing to make the sheet look tidy.

## Development work packages

### 1. Reproducible evidence extraction

Build a reusable analysis component producing multi-resolution spectral features, harmonic pitch evidence, broadband onset novelty, pitch-specific onset evidence, and decay/activity envelopes. Use multiple time resolutions because low-pitch discrimination and sharp attack timing have different requirements.

Retain the full harmonic structure rather than reducing everything to the loudest frequency. Account for tuning differences. Treat Basic Pitch onset/frame activations as supporting evidence, not calibrated probabilities or ground truth. Detect unusable or unsuitable audio and report uncertainty instead of forcing a result.

### 2. Draft-informed audio decomposition

Prototype a constrained non-negative least-squares/NMF verifier, starting with fixed piano templates and evaluating adaptation to the recording. Model attack and sustain/decay separately; compare static templates with spectro-temporal or convolutional templates if needed.

The draft narrows the search but is a soft constraint. Allow candidate pitches absent from the draft, otherwise missing pitches cannot be discovered. Include background/noise and modelling-error components so unexplained sound is not always assigned to an extra note. Avoid letting an overly flexible background component absorb genuine quiet notes.

Adaptation must be bounded and tested: a template learned from a wrong or overlapping draft event can reinforce the error. Where available, use reliable isolated passages; otherwise keep template mismatch visible as uncertainty. Compare alternatives under consistent modelling conditions.

Do not use raw waveform subtraction against the current audition synthesizer. Differences in piano timbre, phase, room acoustics, tuning, pedal and synthesis can dominate that comparison. Spectral reconstruction is itself approximate, so residual energy alone is not proof of a missing note.

### 3. Disagreement detection and candidate generation

Implement these checks with distinct issue types and evidence:

| Check | Evidence to examine | Candidate correction | Required caution |
| --- | --- | --- | --- |
| Unmatched attack | Original audio has attack evidence without a nearby proposed onset | Investigate candidate pitches; otherwise flag timestamp only | Broadband novelty does not identify pitch and may be noise |
| Missing chord pitch | Coherent harmonics persist beyond what the current chord explains | Add a candidate pitch and compare the entire chord | Overlapping harmonics and masking can make the result ambiguous |
| Early/late onset | Pitch-specific attack lies near the proposed start | Shift that onset within a bounded local search | Preserve real arpeggiation; do not move every chord note to one attack |
| Missed repetition | A sustained pitch has evidence of another pitch-specific attack | Split into repeated strikes with separately estimated levels | Another note or resonance may create a misleading peak |
| Duplicate/fragmented event | Several proposed strikes but only one supported attack and continuous decay | Merge or remove a duplicate | Quiet repetitions must not be deleted merely because weak |
| Unsupported/wrong pitch | Existing note contributes little unique evidence, or another pitch better explains the passage | Keep/delete/substitute comparisons | Absence of clear evidence is not proof that a quiet note is absent |
| Suspected octave error | Competing lower-pitch, upper-pitch, and both-pitches explanations | Jointly compare those alternatives | Preserve real octave doubling; never apply blanket octave suppression |
| Audible-duration mismatch | Pitch activity or decay disagrees with the proposed end | Suggest an audible-boundary adjustment where supported | Audible decay is not physical key release or written duration |
| Relative intensity mismatch | Estimated note contribution differs from proposed dynamics | Suggest relative level adjustment | Loudness is not a direct measurement of key pressure or MIDI velocity |
| Timeline/boundary fault | Consistent offset, out-of-range events or media identity mismatch | Diagnose pipeline/timeline problem first | Do not conceal alignment faults by changing individual notes |

Timing, duplicate and repetition checks are the first correction targets. Pitch insertion/substitution and intensity refinement require separate qualification. Pedal/key-release inference and score rhythm recognition are outside the first automatic correction scope.

### 4. Local hypothesis comparison

For each suspicious region, include neighboring attacks and ringing notes. Evaluate the unchanged hypothesis alongside bounded onset shifts, deletion, insertion, substitution, merge and split alternatives. Evaluate overlapping notes jointly so harmonics are not counted as independent evidence for several pitches.

Rank alternatives using audio explanation quality, attack/pitch support, and penalties for unnecessary notes and unsupported changes. Tune the balance on development data. A lower reconstruction error alone is insufficient: extra notes and flexible parameters can improve a fit without being correct. Test whether conclusions survive reasonable template and nuisance-parameter variation.

If alternatives are too close, mark the issue ambiguous. Do not invent confidence percentages from raw residual differences or neural activations. Calibrate any confidence display against labeled held-out recordings, by issue type. Limits on search windows, candidate counts, change penalties and acceptance margins must be versioned and selected from evidence, not tuned solely on the user's example clip.

An optional independent piano model may propose or corroborate difficult candidates. Different thresholds on Basic Pitch do not provide independent evidence. Two models agreeing is useful but still not ground truth. Keep any companion model optional and record its version and licensing requirements.

### 5. Report, provenance and review interface

Define a versioned report containing source audio hash, proposal/revision hash, detector/decoder/verifier versions, settings, template identity, runtime and analysis status. Each issue must contain its type, time range, affected event IDs, original events, alternatives, supporting/contradicting measurements, ambiguity status and plain-language reason.

Use statuses such as flagged, suggested, accepted, rejected and unresolved. Preserve the original proposal and an explicit edit list; reject application to a changed revision. Make analysis reproducible from retained inputs within the existing retention policy. Keep analysis artifacts owner-only under existing access controls.

In owner review, selecting an issue should seek the original video/audio and highlight linked score/roll/keyboard notes. Provide short source playback, original-proposal audition and proposed-change audition with context. Support accepting or rejecting individual suggestions and undo/redo. Clearly distinguish a timestamp-only warning from a proposed pitch. Do not present a synthesized timbre mismatch as a note error.

Run verification in a bounded background worker, behind a piano-specific feature flag and separate verifier profile. A timeout or failure must preserve the usable baseline draft and disclose that verification was unavailable. Cancellation and retries must not duplicate edits or publish a lesson.

## Validation and selection

Create a benchmark with real piano performances and synchronized reference MIDI, including repeated strikes, soft notes beneath loud chords, genuine octaves, arpeggiation, ornaments, sustained notes, pedal, noise and different instruments/rooms. Record whether reference offsets represent key release or audible activity; do not mix these targets. Use generated fixtures for controlled regressions, but not as the only evidence of generalization.

Add controlled deletion, insertion, pitch/octave substitution, onset shift, split and merge corruptions to known references to measure each check's sensitivity and damage rate. Separately evaluate natural errors from the actual detector; artificial corruptions alone are insufficient. Split by recording/piece and piano where practical, keeping final recordings unseen during tuning. Manually audit alignment and ambiguous labels.

Compare at least: the current decoder; decoder plus verifier; an independent piano-specific model; and, if useful, a combined approach. Complex post-processing is justified only if its quality/runtime tradeoff beats simpler options.

Report per error type: flag precision/recall; suggested-edit correctness; number of genuine errors fixed; number of originally correct events damaged; remaining missing/extra/wrong notes; onset error; appropriately defined offset error; abstention/coverage; runtime and memory. Use one-to-one pitch/onset matching and report duration separately. Measure change outcomes as well as overall F1 so gains cannot hide harmful edits. Conduct source-versus-proposal listening review on representative difficult passages.

Before automatic corrections, establish and document acceptable precision and damage limits on development data, then verify them on the untouched evaluation set. Publish the sample sizes and uncertainty. No universal improvement claim is warranted from the existing short example or one sample bank.

## Delivery sequence and acceptance

1. **Benchmark and diagnostic prototype:** deliver reproducible analysis, issue reports and comparisons; proposals remain unchanged.
2. **Owner suggestions:** integrate issue selection, contextual playback, accept/reject, undo and provenance. Verify save/reopen and stale-revision rejection.
3. **Qualified corrections:** enable only error types that meet the agreed held-out quality/damage limits. Keep ambiguous cases for review and retain rollback.
4. **Separate later investigations:** pedal/key-release estimation, relative dynamics and written-rhythm inference. Each needs its own targets and evaluation.

Completion requires a versioned report/schema, bounded verifier worker, feature flag and fallback, candidate comparison implementation, review integration, reproducible benchmark and documented measured results. Tests must protect real repetitions, octaves and expressive timing, and verify that existing reviews/releases are never silently rewritten.

## Research basis and reusable components

- [Wang, Ewert and Dixon: identifying missing and extra piano notes (2017)](https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2017/WangEwertDixon-TASLP2017.pdf): recording-adapted spectro-temporal dictionary learning and soft constraints. Evaluation on seven beginner pieces supports feasibility, not universal reliability. Our AI draft is weaker prior information than their score.
- [FMP: NMF-based spectrogram factorization](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C8/C8S3_NMFSpecFac.html): executable reference material for harmonic, activation and onset constraints. [Score-informed NMF implementation](https://github.com/matangover/score-informed-nmf) is another reference, not a complete transcription-error corrector.
- [PianoTranscriber (2018)](https://www.vocaltractlab.de/publications/steiner-2018-essv.pdf): analysis-by-synthesis and original/reconstructed onset comparison; explicitly distinguishes identifying a missing onset from assigning its pitch.
- [Miron et al.: note refinement (2015)](https://archives.ismir.net/ismir2015/paper/000099.pdf): local note-boundary refinement using audio-derived activations; does not establish arbitrary missing-note recovery.
- [Cogliati et al.: convolutional sparse coding (2016)](https://brendt.wohlberg.net/publications/cogliati-2016-context.html): demonstrates a context-dependent route requiring samples of the specific piano/environment; arbitrary uploads lack this assumption.
- [Sync Toolbox](https://github.com/groupmm/synctoolbox): alignment reference. Avoid unrestricted time warping when testing timing errors against the same source audio.
- [D3RM paper](https://arxiv.org/html/2501.05068v1) and [code](https://github.com/hanshounsu/d3rm): learned audio-conditioned refinement, not a drop-in Basic Pitch post-processing function.
- [Robust piano transcription research (2024)](https://arxiv.org/abs/2402.01424): acoustic generalization motivates evaluation across pianos and recording conditions.
- [Note-value recognition research](https://arxiv.org/abs/1703.08144) and [key-hold versus audible-activity research](https://arxiv.org/abs/2608.03419): support treating written rhythm and pedal-obscured key release as distinct tasks.
