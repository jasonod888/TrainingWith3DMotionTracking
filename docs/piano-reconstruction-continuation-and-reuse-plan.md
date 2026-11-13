# Piano reconstruction: continuation plan after the A0–C foundations

Date: 12 November 2026  
Status: developer handoff; implementation instructions and review findings, not a release approval.

For the per-category before/after measurement implementation, reference requirements and
the first real-clip scorecard milestone, also follow [the measurement and acceptance plan](piano-reconstruction-measurement-plan.md).

## 1. Decision: retain the foundations and integrate existing specialist components

Proceed with the developer's new modules after the targeted corrections below.
Do not replace the application with MIDI-grep, Stemforge or another end-to-end demo.
Do not build new velocity/transcription networks before evaluating the existing models.

The two approaches are complementary:

| Responsibility | Decision |
|---|---|
| Rights/provenance and artifact identity | Keep and strengthen `piano_rights.py` and the manifest |
| Performance semantics and legacy compatibility | Keep `piano_performance.py`; integrate it through versioned adapters |
| Renderer interface | Keep `piano_render.py`; implement its fidelity adapter using an external engine |
| Audio measurements and experiment reports | Keep metrics/harness after the correctness fixes; retain v1 as a historical baseline |
| Initial piano transcription | Use a released pretrained implementation; Kong author inference route is the immediately evidenced candidate, Basic Pitch remains the baseline |
| Velocity estimation | Reuse base VeloEst as a candidate; do not build another spectral calibration first |
| Realistic piano generation | Probe sfizz + Salamander; use a compatible versioned mapping or another measured engine/asset pairing |
| Source-specific correction and selection | Build only the missing constrained orchestration, evidence checks and integration |
| Review/editor/export | Integrate with the existing product and preserve manual edits and rollback |

The objective remains an editable reconstruction of the uploaded piano performance
whose playback matches the original as closely as possible. A working harness is
infrastructure, not evidence of that result.

## 2. What was independently checked

I read the five principal new modules, rights manifest and evidence note, and reran
the five new test files: **107 passed in 5.18 seconds**. I did not rerun or independently
certify the developer's entire 584-test collection in this review.

The evidence note correctly calls the additive renderer approximate and the sfizz
implementation a stub. With no existing application file changed, these additions
also do not establish worker/API/editor integration. Describe their status as
**A0/B/C foundations**, not completed data ingestion, fidelity rendering or playback.

The note's verification section still contains an earlier full-suite failure count,
which differs from the developer's later message. Update the document with a dated
run receipt including command, interpreter, dependency path, revision/worktree identity,
collected/passed/skipped counts and reasons. Preserve earlier results as history rather
than implying that the current reviewer repeated the full run.

## 3. Immediate foundation corrections before optimization

These are source-inspection findings; the first two were also reproduced directly.
They are not reasons to discard the architecture.

### P0 — render identity must include every effective audio input

`piano_performance.musical_controls()` excludes legacy duration, while
`AdditiveReferenceRenderer._release()` uses it. Changing only a legacy duration from
0.2 to 0.6 seconds produced **different audio with the same render identity**.
Changing source duration from one to two seconds also kept the identity while changing
the output from 8,000 to 16,000 frames in an 8 kHz probe.

Required change:

- Hash resolved note-off times and their estimation policy, output extent/tail policy,
  renderer binary/code identity, all instrument samples/includes, settings and effective
  controls. Hash source duration when it determines output length.
- Prefer a canonical resolved render request so identity and synthesis use the same
  inputs. Keep the complete source/performance provenance hash separately.
- Do not include unrelated notation/provenance merely to hide missing effective inputs.
- Record legacy-derived releases as estimates too; the current renderer's generic
  missing-release warning does not enumerate legacy-derived estimates.

Regression: legacy timing and source extent changes invalidate the key; identical
effective controls reuse it; notation-only changes do not alter sound identity unless
the renderer explicitly consumes notation. Different sample or engine bytes invalidate it.

### P0 — unequal comparison lengths must not hide missing audio

`metrics.compare()` truncates both signals to their common length. A two-second
reference compared with its identical one-second prefix returned **objective 0.0**,
discarding the missing second half with a warning.

Required change:

- Define a source comparison interval plus explicit renderer-latency and tail policy.
- A short candidate is padded with silence over the required interval and penalized,
  or rejected as incomplete; it cannot qualify on a matching prefix.
- Score unwanted candidate sound beyond the allowed interval separately. Intentional
  diagnostic crops require a declared interval and cannot masquerade as full coverage.
- Validate fixed latency; do not optimize it to hide timing errors.

Regression: missing final passage, shortened note/tail, late attack and extra late
notes must not achieve a perfect complete-recording score. Coverage includes scored
source time, not just note counts.

### P1 — score and identify the actual delivered audio

The harness scores float samples, then writes `render.wav` using the writer's 16-bit
default. The report's render hash identifies the float buffer, not the WAV users hear.
Writing reference fixtures at 24 bit does not resolve that delivery mismatch.

Required change:

- Preserve source PCM as available; avoid unnecessary reference re-encoding.
- Save lossless research renders at an explicit depth and record both PCM and file hashes.
- Decode the actual served/exported format and score that too; release gates use the
  delivered representation. Retain float comparison as a separate diagnostic.
- Bind codec, encoding parameters, sample count, channel count and clipping/headroom.
- Use the renderer's reported latency by default. The current harness scores its own
  `latency_samples` argument, independently of `RenderResult.latency_samples`; record
  resolved latency and any explicit override consistently.

Regression: nonzero-latency renderer, quantization/encoding change and deliberate
clipping affect the appropriate report identity and delivered-audio comparison.

### P1 — strict capabilities and qualification validity must be explicit

`used_controls()` does not consult `half_pedal` when fractional pedal values are used.
An engine declaring only binary sustain must not silently interpret continuous pedal
position as a thresholded switch on a fidelity path.

Required change:

- Declare pedal value semantics: binary switch, continuous physical position or unknown.
  Do not assume every fractional stored MIDI value is evidence of measured half-pedal.
- Check required capabilities against those semantics. Unknown or unsupported values
  require an explicitly recorded downgrade or remain unqualified.
- Separate capability support from actual evidence that its acoustic behavior is faithful.
- Emit machine-readable `diagnostic_only` / `valid_for_qualification` and reasons;
  approximate renderers, unresolved identity, ignored controls or incomplete coverage
  cannot produce qualified reconstruction edits.
- Count uncertain audible-end intervals separately from scorable measurements. Field
  presence alone is not measurement coverage.

Regression: partial/unknown pedal semantics cannot be silently accepted, and a
diagnostic render cannot acquire release approval by merely reducing an objective.

### P1 — strengthen objective identity and useful resolution

The current objective hashes weights, FFT sizes, hop and version, not the complete
measurement implementation. It also saturates and folds its pitch feature to chroma;
neither is adequate proof of exact-pitch recovery or complete stereo sound matching.

Required change:

- Bind code/dependency/preprocessing identity as well as weights/settings.
- Retain raw component distances and a development-calibrated nonsaturating ranking
  value alongside bounded display values. Version changes; do not overwrite v1 evidence.
- Add octave-aware note/pitch evidence and independent event scoring. Chroma can remain
  supplementary, but cannot certify that octaves are correct.
- Define time/frequency resolution across source sample rates rather than blindly
  applying the same FFT sample counts to every native-rate source.
- Add stereo/room measurements before sound-equivalence qualification. Until then,
  explicitly restrict the objective to supported mono diagnostic comparisons.
- Add WAV-header/resource preflight and bounded/chunked feature processing before
  loading or allocating arrays for arbitrary uploaded files.

These fixes need focused regressions and the appropriate integration suite. Do not
rewrite every feature or claim v2 is perceptually calibrated before listening evidence.

## 4. Resolve licensing by exact distribution: a usable route exists now

### Kong/ByteDance model: use the author's licensed inference route

The broad blocker in the developer's note is incomplete. The training repository's
missing license is not the only available distribution:

- The author's [piano-transcription-inference 0.0.6 package](https://pypi.org/project/piano-transcription-inference/0.0.6/)
  declares MIT for the inference code.
- Its documented pretrained release is the author's [Zenodo record 4034264](https://zenodo.org/records/4034264).
  I retrieved the [official metadata](https://zenodo.org/api/records/4034264): the
  checkpoint is licensed **CC BY 4.0**.
- The existing local `piano.pth` matches the published MD5
  `22b961b77c1878239fec963362097045`. Its locally calculated SHA-256 is
  `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141`.

Required manifest work:

1. Keep the unlicensed training-repository entry restricted; do not relabel that entire
   repository as MIT.
2. Add separate entries for the exact author inference package and exact CC BY checkpoint,
   with distribution hashes, metadata evidence, attribution and permitted uses.
3. Add separate third-party dependency entries/notices. Copying code from an unrelated
   training checkout is not part of this route.
4. Bind approved model profiles to those exact artifacts. Record transformation details
   for any later conversion/quantization; do not trust a mirror's different license label.
5. Preserve training-data provenance, but do not infer that a noncommercial dataset's
   terms automatically replace an author's separately published checkpoint grant.
   Where a particular scope genuinely remains unresolved, document that specific issue;
   do not manufacture a blanket ban from an unrelated repository's missing file.

Evidence snapshots are in `.local/repo-research/licensing/`; no runtime manifest
permissions were silently changed by this review. This route lets the model benchmark
proceed once its exact artifact entries are added through the normal reviewed workflow.

### Transkun: correct source, isolate the remaining question

Use [Yujia-Yan/Transkun](https://github.com/Yujia-Yan/Transkun), not the earlier fork link.
Upstream has MIT code; its setup explicitly packages `.pt` weights and `.conf` files,
and PyPI declares an MIT classifier. That is relevant evidence; absence of a separate
per-checkpoint license file is not by itself proof of a noncommercial prohibition.

Record the exact bundled checkpoint and review the scope of that distribution's grant.
If a separate author clarification is needed for the selected artifact, keep only that
checkpoint/use unresolved. Do not use an independently uploaded fork's license as a
substitute grant. **Do not make this question critical-path:** use Basic Pitch and the
licensed Kong route while Transkun is resolved. No messages to authors were sent.

### Velocity candidates

Add the specific base VeloEst code/checkpoint from the pinned
[Score-Informed AMT / Diff-SFProxy release](https://github.com/zhanh-he/sfproxy-velocity-estimation),
retaining the root CC BY 4.0 declaration and MIT `score_hpt` notice with exact hashes.
Treat the two pretrained piano models as separate candidates. Base VeloEst performed
better in the local probe; adaptation is not automatically an improvement.

Do not add the entire research repository or optional guitar/DDSP/training assets to
the product dependency graph when the inference path does not use them.

## 5. Remove the listening-instrument dependency cycle now

Build a provisional developer listening instrument **before** choosing the final
renderer. The rating task is independent of any particular engine and is not the later
indistinguishability study.

### Required instrument v0.1

Input: reference excerpt, anonymous candidate renders, baseline/control renders,
explicit common start/end interval, constant level/latency treatment and immutable
stimulus hashes. Use 8–15-second excerpts with enough attack and tail context.

Show synchronized reference/candidate playback, repeat/seek, randomized anonymous
candidate labels and a 0–100 similarity slider with the exact question:

> How closely does this candidate reproduce the reference performance and sound?
> Consider played notes, timing, expression, sustain and piano/room sound. Rate what
> you hear, not whether you like the interpretation.

Use a documented anchored scale:

| Score region | Listener guidance |
|---|---|
| 0 | No meaningful resemblance to this excerpt |
| 25 | Some recognizable content, with major differences |
| 50 | Clearly the same passage, but substantial audible differences |
| 75 | Close reproduction with noticeable remaining differences |
| 100 | No audible difference noticed under these listening conditions |

These are response anchors, not automatically assigned ground-truth scores. Training
examples must illustrate them without telling listeners what they must score.

Include an identically processed hidden reference, a deliberately degraded reference
and the current approximate audition. Create training anchors from separately reserved,
permissively licensed development material; preserve reference attribution. Record
an overall score plus separate optional comments for notes/timing, expression/pedal
and tone/room, confidence and equipment. Never call `100 - 100 × objective` a listener
rating or an indistinguishability probability.

Deliver a small local/internal web questionnaire, stimulus builder, manifest, seeded
randomization, rating CSV/JSON export, written instructions, consent/payment procedure
and analysis notebook with listener/excerpt clustering. Predefine attention/exclusion
rules; exclude neither unfavorable ratings nor accurate detection of defects.

Run the existing 12-listener pilot on development material. The numerical renderer
selection gate can then be measured against this fixed instrument, without requiring
the winning renderer to define the scale. Freeze subsequent changes/version before
qualification; do not transfer pilot outcomes to an advertising claim.

## 6. Probe and implement the real renderer without an all-or-nothing feature gate

Run this track alongside instrument v0.1 and Vienna preparation. It need not wait
for a confirmatory listening study.

1. Choose one pinned sfizz build/distribution; record engine binary/source/dependencies,
   build options, maintenance owner and executable behavior. Do not build a synth engine
   from scratch. Keep an alternative engine/compatible mapping route available if needed.
2. Acquire the licensed Salamander samples, mapping and every included file; hash all
   dependencies, not only the top-level SFZ. Snapshot attribution and modifications.
3. Expand includes/macros and inventory the actual mapping opcodes. Test features that
   mapping uses. ARIA extensions are a compatibility question to measure, not proof that
   sfizz must fail.
4. Separate mandatory first-domain controls from optional features. Required: correct
   pitch/attack, real velocity layers, repeated-note handling, key-release estimate
   policy, declared sustain behavior, release samples and stable rendering. Test noise,
   resonance and switching features actually present. Do not require round-robin support
   for a library with no round robins, or acoustic half-pedal support merely because an
   SFZ exposes CC64. Mark unsupported soft/sostenuto/half-pedal explicitly and restrict
   qualification accordingly.
5. Build tiny MIDI/audio feature probes: isolated soft/medium/loud strikes; same-pitch
   repeats; key release with pedal up/down; pedal lift; actual release/noise/resonance
   layers; natural/retuned switches if used; dense-polyphony truncation; deterministic
   rerenders; latency and tail handling. Retain results plus missing/ignored opcodes.
6. If the upstream mapping is incompatible, create an attributed mapping using a tested
   supported subset of the same licensed samples, and document lost features. It is a
   different render profile, not identical to the original mapping. If required fidelity
   still fails, evaluate another engine/asset pair. The VCSL/FluidSynth path remains a
   control, not an automatic fidelity fallback.
7. Replace the unconditional `SfizzRenderer.render()` refusal with a real bounded adapter
   only after core probes pass. Unsupported requests still fail or explicitly downgrade.
   Optional-feature failures must not prevent all diagnostic rendering.

Required deliverables: `renderer-selection.json`, opcode/support matrix, feature probe
suite and WAVs, exact notices, binary/sample hashes, actual renderer adapter and resource
receipts. The placeholder's static blocker strings are not a capability probe or
evidence that the six listed features fail.

## 7. Ingest Vienna correctly and preserve an untouched evaluation route

Use the data already verified in `.local/commercial-piano-data/` and the corrected
CPJKU revision recorded in the rights register. Ingest the remaining original audio
through bounded, hash-verified downloads. Do not refetch SMD/MAESTRO as dependencies.

- Join performance audio to corrected performance MIDI by stable identity. Exclude
  average/partial variants from independent-performance counts.
- Keep original native audio for listening and separate model-rate copies. Record every
  trim/latency/time mapping and verify release/controller semantics.
- The already inspected `Chopin_op38_p01` excerpt/performance is development-only.
- Split by performer for primary person-generalization claims and report overlap in
  pieces/instrument. Do not assert unseen-piano generalization from this one setup.
- Produce a feasibility table **before** fixing the split: 22 performers × four works
  does not guarantee 40 distinct edited holdout performances per category when
  performers are held out. For example, 12 held-out performers provide at most 48
  performances before ambiguity or no-edit cases. If gate denominators cannot be met,
  obtain additional cleared performances or narrow/defer that qualification. Never
  count repeated excerpts as new independent performances or weaken gates afterward.
- Independent human audible-ending annotations remain necessary for that target.
  Captured releases/controllers support their own evaluation, not all acoustic labels.

Deliver a dataset/rights/hash manifest, validation report, development/calibration/
holdout manifest and exclusion reasons. The prototype can proceed on a small
development subset while bulk ingestion and annotation finish.

## 8. Integrate pretrained models through adapters, not wholesale applications

### Initial candidate matrix

| Candidate | Comparison purpose | Output treatment |
|---|---|---|
| Current Basic Pitch/decoder | Immutable current baseline | Preserve raw predictions and legacy semantics |
| Licensed Kong author inference route | Stronger piano-specific notes, attacks, offsets, velocity and pedal candidate | Preserve native outputs; map model estimates with explicit provenance |
| Basic Pitch + base VeloEst | Isolate velocity-estimator benefit without changing notes | Pitches/timing/controllers must round-trip unchanged |
| Kong + base VeloEst | Test whether velocity refinement adds value beyond a stronger model | Independent evaluation; do not assume stacking helps |
| Transkun | Optional comparison once exact artifact terms are recorded | Record checkpoint offset convention and control export behavior |

Represent model-derived releases/velocities as estimates with method/source/uncertainty,
not captured physical measurements. Do not convert a pedal-extended acoustic offset to
key release. When exporting temporary MIDI for a velocity model, record any release
assumptions; maintain stable links back to canonical note IDs. Preserve native sample
rate expectations per model. The user still uploads only a video.

Run candidates on the same development audio and score missing/extra notes, onsets,
target-correct offsets, velocity, pedal, rendered similarity and resources. Matched-note
velocity improvements must not hide poor note recall. Retain complete candidate
artifacts, including failed/no-change results.

The prior one-excerpt VeloEst result (38.37 → 9.03 velocity MAE, 90 improved/3 worsened,
two damaged previously acceptable values) justifies this comparison, not activation.
No proposal passes merely because it is a published model's output.

Do not import Stemforge or MIDI-grep as the product backend. Evaluate narrow useful
functions separately when a measured error calls for them. D3RM is a higher-integration
alternative transcriber, not the first repair adapter. TokenSynth is an optional sound
experiment; none replaces the retained contracts, product integration or evidence gates.

## 9. Build only the missing reconstruction orchestration

After a real renderer and candidate benchmark exist, implement the constrained loop:

1. Render baseline/current candidate on a fixed source interval with verified identity.
2. Fit bounded global instrument/gain/room parameters, keeping notes fixed.
3. Propose local note/timing/expression/pedal alternatives using audio/model evidence.
4. Render alternatives with the sound profile fixed; check independent musical evidence
   and whole-passage improvement. Keep no-change as a candidate.
5. Reject unsupported controls, damaged checked attributes and objective-only tricks;
   apply compatible edits transactionally to an experiment candidate.
6. Re-render the combined final performance and score the delivered audio. Local edits
   that do not survive whole-pass checks are discarded.

Model-only output may win. If refinement does not improve it, omit that stage rather
than shipping a more complicated inferior system. Record unqualified experimental
candidates separately from automatic production decisions. Keep current category/scope
qualification and rollback; a default-deny manifest is not an accuracy policy.

## 10. Resources, product integration and release order

Use the existing [acceptance specification](piano-reconstruction-acceptance-v1.md)
as proposed requirements, not measured performance. Profile the real renderer in this
track, refresh after model selection and again after refinement. Record p50/p95 runtime,
warm/cold start, RAM/GPU, candidate count, dirty-region size, storage/cost and failure
behavior on 15/60/300-second cases. Derive limits from measurements before worker/API
integration; do not reuse the old 60-second/500-event cap as full-upload coverage.

Then integrate the selected adapters/performance document with worker, strict API
contracts, asset retention, review editor, keyboard/sheet behavior, exact audition,
export and learner assessment. Only qualified categories/scopes supply automatic
working-draft edits. Background jobs cannot overwrite manual changes. A restored
baseline restores its matching controls, renderer profile and audition too.

The confirmatory listening study follows stable candidate selection and a locked
instrument/protocol. Keep preregistration, power analysis, recruitment, equipment and
claims review as a separately funded deliverable. It does not block early model or
sampler experiments, but it does block an indistinguishability claim. A high slider
score or non-significant small ABX result cannot replace that evidence.

## 11. Ordered developer work packages

| Package | Concrete deliverable | Gate |
|---|---|---|
| W1. Foundation hardening | Identity, length/tail, delivered-audio/latency and strict-capability fixes plus regressions; dated test receipt | Reproductions in section 3 no longer pass as valid complete comparisons |
| W2. Exact licensed model entries | Kong MIT package + CC BY checkpoint; separate VeloEst entries; correct upstream URL; preserve unresolved training checkout | Preflight admits exact evidenced candidates without globally disabling safeguards |
| W3. Listening instrument v0.1 | Anchored task, internal questionnaire, stimulus/randomization manifest and data export | Pilot is executable without a selected fidelity engine |
| W4. Sampler compatibility spike | Real opcode inventory, core-control probes and actual sfizz/compatible-mapping render | Reproducible WAV and honest capabilities; no static-stub "failure" verdict |
| W5. Small real-data ingestion | Corrected paired development subset, validated timing/controls, feasible untouched split plan | Independent reference scoring possible; inspected excerpts excluded from holdout |
| W6. Adapter benchmark | Same-input candidate matrix in section 8, audio/event/resource results | Choose components on evidence, not published headline metrics |
| W7. Source-sound/refinement prototype | Bounded profile fitting and candidate loop using winning components | Gains exceed model-only output under frozen supported targets |
| W8. Integrated shadow workflow | Worker/API/editor/export/rollback and measured job limits | Seamless upload-to-editable-result flow; production originals preserved |
| W9. Independent qualification | Fresh heldout event/audio evidence and required listening package | Existing thresholds pass per attribute/domain; claims stay within evidence |
| W10. Controlled activation | Pinned manifest/profile/dependencies, notices, monitoring and rollback | Delivered result reproduces evaluated artifact |

W3, W4 and development-data preparation can proceed independently after their relevant
W1/W2 prerequisites; there is no need to choose only one of the developer's two proposed
cheap moves. Full qualification waits for stable components and an adequate holdout.

Do not discard or overwrite the developer's uncommitted foundations. Deliver fixes
and adapters as reviewable changes, retain all original raw AI output, and do not
report "complete reconstruction" merely because the foundational tests pass.

## 12. References and related artifacts

- [Original reconstruction plan](piano-performance-reconstruction-plan.md).
- [Acceptance specification and listening/resource targets](piano-reconstruction-acceptance-v1.md).
- [Repository review and actual VeloEst experiments](piano-reconstruction-repository-review-2026-11-12.md).
- [Selected real-data/sample route](piano-reconstruction-rights-register.md).
- [Developer's foundation evidence](qualification/piano-reconstruction-a0-c-2026-11-12.md).
- [Author inference package](https://pypi.org/project/piano-transcription-inference/0.0.6/),
  [official checkpoint metadata](https://zenodo.org/api/records/4034264),
  [Transkun upstream](https://github.com/Yujia-Yan/Transkun).

This continuation plan resolves the choice as a hybrid implementation. It does not
claim that the current foundations or any imported model have already achieved faithful
performance reconstruction or perceptual identity.
