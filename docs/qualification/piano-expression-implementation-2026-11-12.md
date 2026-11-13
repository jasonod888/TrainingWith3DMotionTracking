# Piano expression implementation and measured results — 12 November 2026

## Delivery status

The remaining signal-measurement, calibration, application and evaluation software described below is implemented. **The plan's accuracy and automatic-activation acceptance criteria are not met.** All checked-in expression categories remain disabled. The original uploaded performance has no demonstrated expression improvement from this work. No production worker configuration, real lesson, Git commit or remote branch was changed.

This distinction matters: successfully repairing deliberately damaged controls does not establish useful corrections to natural Basic Pitch errors. Public reference data was used as requested; synthetic evidence is identified separately.

## Implemented

1. **Note-attributed audio evidence.** `scripts/piano_expression_evidence.py` fits nonnegative, time-varying note contributions using attack/sustain templates, a background component and bounded template adaptation. Attribution depends on pitches and attack times, not incoming durations or velocities. Separate harmonic views, residual error, shared partials, background noise and ringing from preceding strikes control abstention. Reliable attributed decay can generate an audible-ending candidate for isolated or overlapping notes. This is a constrained approximation, not perfect source separation.
2. **Independent velocity calibration.** `scripts/piano_velocity_calibration.py` fits measured attack levels to captured MIDI velocities using separate fitting and uncertainty-calibration performances. It validates pitch support, observed velocity ranges, calibration domain, uncertainty and exact measurement identity. It does not multiply Basic Pitch velocity or extrapolate beyond supported ranges. `scripts/calibrate_piano_velocity.py` provides the standalone fitting command.
3. **Conditional application.** Duration and velocity have independent policy categories and independently qualified isolated/polyphonic scopes. The API checks source/working identity, exact baseline, implementation, interval and policy before application. Velocity additionally requires a matching captured-MIDI calibration and domain. Applying velocity preserves duration and written notation. Failure preserves the Phase 3 result. Category activation is still subject to qualification.
4. **Dependency identity.** Prepared profiles copy and hash the full expression dependency bundle. Calibration identity includes that bundle, the verifier/templates code and effective settings; changing any of these invalidates stale calibration. Optional calibration is explicitly attached to a prepared profile with its recording domain.
5. **Real-reference tools.** `scripts/fetch_smd_expression_data.py` obtains original SMD audio excerpts and paired corrected MIDI with source hashes and fixed splits. `scripts/benchmark_piano_velocity.py` fits and evaluates without training on held-out performances. `scripts/prepare_expression_annotation.py` creates audible-ending annotation templates, with endings initially unscorable. `scripts/benchmark_piano_expression_references.py` evaluates validated independent audible-ending annotations. MIDI key release is never substituted for audible end.
6. **Resource bounds and safe fallback.** Expression analysis has a 60-second audio limit, 500-event analysis limit, bounded attribution windows/pitch counts and a time budget capped at 60 seconds. Unsupported or partially analyzed material is disclosed and retained unchanged; coverage is not implied for arbitrary long uploads. A bounded rational resampling fix also prevents pathological allocation for 48 kHz input.
7. **Review workflow.** Browser acceptance verified corrected values and restoring original values against a disposable database. A mobile keyboard overflow was fixed with a horizontally scrollable keyboard region. Intensity help text now describes approximate playback intensity without claiming physical key pressure. No real user lesson was modified during this check.

## Measured evidence

| Dataset / test | Result | Interpretation |
|---|---|---|
| Development renderings: 24 performances, 96 runs | One natural-decoder duration improved; no measured damage | Development evidence only; already inspected |
| Untouched rendered set: 48 performances, 192 runs | 142 deliberately corrupted durations corrected within 80 ms; zero worsened | Demonstrates recovery of controlled errors |
| Same rendered set, clean reference | 252 scorable notes; zero edits | Clean controls preserved |
| Same rendered set, natural decoder | 245 scorable notes; zero edits; mean ending error remains about 83.3 ms | Natural-error recovery acceptance remains unmet |
| Public SMD velocity holdout | 40 performances, 3,271 matched sampled notes; zero safe edits; mean absolute error remains 22.47 MIDI units | Spectral calibration was too uncertain/narrow to improve this set |
| Original retained 14.677-second upload | 34 events unchanged in pitch, onset, duration and velocity; both attributes analyzed on all 34; two attack measurements, zero proposals | No demonstrated improvement on the user's clip |
| Exploratory piano-specific neural companion | 3,241 paired notes; velocity MAE 22.51 → 12.13 MIDI units | Promising separate model direction; offline comparison, not qualified or installed in production |

The two velocity comparisons have different matched-note populations and must not be treated as the same experiment. The companion's average gain does not establish 95% correction precision, zero damage, or applicability to an unknown piano recording.

SMD used 50 original 20-second excerpts: six fitting performances, two uncertainty-calibration performances, 40 held out and two previously inspected Chopin examples retained only as diagnostics. Evaluation matches exact pitch and onset within 50 ms and samples at most 100 matched notes per performance. It measures velocity conditional on matched notes, not pitch/onset recall. The narrow calibration learned here is not valid for the user's unknown recording domain. An earlier exploratory pass permitted extrapolation and produced two edits; the final supported-range guards reject both, so the final result is **zero** velocity edits.

Local evidence: `.local/expression-completion/holdout-duration-final/report.json`, `public-velocity/report.json`, `companion/report.json`, and `final-original-result/analysis.zip`. These artifacts and downloaded reference recordings are local, not checked-in benchmark fixtures. The original clip lacks independently checked audible-ending and velocity references, so subjective improvement cannot be certified from it.

## Verification

- Full API suite: **401 passed, 1 skipped**.
- Integrated focused suite after final measurement-identity changes: **107 passed**.
- Final expression regression suite: **33 passed**; attribution coverage was also exercised in the focused suite.
- Web suite: **314 passed**; production build passed.
- Default and calibration-bearing prepared profiles loaded and verified successfully.
- Browser: reviewed working values, restored baseline values and verified mobile page width. Evidence: `.local/expression-completion/mobile-review.png`.

These counts are separate runs, not additive. The full API run preceded the final measurement-identity tightening; the focused run covered that tightening. No production rollout was performed.

## Reproduction

On this workstation use `.venv-saas/Scripts/python.exe` with `PYTHONPATH` pointing to `.venv-music/Lib/site-packages` and `OMP_NUM_THREADS=1`. Each named script supports `--help`.

```powershell
$env:PYTHONPATH = "$PWD/.venv-music/Lib/site-packages"
$env:OMP_NUM_THREADS = '1'
.venv-saas/Scripts/python.exe scripts/fetch_smd_expression_data.py --output .local/expression-completion/smd-public --count 50 --seconds 20
.venv-saas/Scripts/python.exe scripts/benchmark_piano_velocity.py --pairs .local/expression-completion/smd-public --weights music-candidate-run/basic-pitch-0.4.0/model.onnx --output .local/expression-completion/public-velocity
.venv-saas/Scripts/python.exe scripts/benchmark_piano_expression_v2.py --samples music-candidate-run/editors/riffscore/demo/public/audio/piano --weights music-candidate-run/basic-pitch-0.4.0/model.onnx --start-seed 100 --seeds 6 --split holdout --output .local/expression-completion/holdout-duration-final
```

Do not tune against the already inspected holdout and then describe a rerun as untouched. Further algorithm development needs another fixed, independent evaluation split.

## Remaining acceptance work

1. Independently annotate audible-ending intervals on real performances, including masked/unscorable endings, then run the reference benchmark. Existing public MIDI supports key-release and velocity evaluation but does not supply audible-ending ground truth.
2. Establish useful natural-error recovery and calibrated velocity accuracy on additional untouched recordings. Current spectral calibration does not achieve this. The piano-specific companion warrants a separate pinned, licensed, validated integration rather than silently becoming a runtime dependency.
3. Qualify each category and scope using the existing gate: at least 40 distinct contributing held-out human performances, at least 20 suggestions, at least 95% correction precision, zero measured damage and natural-error improvement. Merely evaluating 40 recordings with zero suggestions cannot pass this gate.
4. Install a newly prepared approved profile only after qualification. Keep calibration domain matching explicit; do not apply the SMD piano's calibration to unrelated uploads. Physical key release, pedal transcription and written rhythm remain outside this expression project.

## Method and data sources

The attribution approach follows constrained spectral factorization principles described in the [AudioLabs NMF tutorial](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C8/C8S3_NMFSpecFac.html). Original paired piano recordings come from the [Saarland Music Data description](https://www.audiolabs-erlangen.de/resources/MIR/SMD/midi) and [official archive](https://zenodo.org/records/13753319); its noncommercial share-alike terms require attention before redistribution or commercial dataset use. The neural comparison uses the existing local checkpoint of [ByteDance's piano transcription project](https://github.com/bytedance/piano_transcription), solely as an offline experiment. No reference recordings or checkpoint are added to the repository.
