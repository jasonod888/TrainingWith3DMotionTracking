# Expression v2 review and original-clip test — 12 November 2026

## Outcome

The diagnostic architecture is substantially improved, but the musical-improvement
goal is not complete. The current system preserves the original clip's notes and
does not demonstrate better natural AI durations or MIDI velocity. Automatic
expression categories remain disabled.

This review fixed implementation defects and tested the complete prepared adapter,
not only standalone estimator functions. The existing uncommitted developer work
was retained. No running worker profile, saved lesson, release or Git commit was
changed.

Machine-readable evidence is retained in
[piano-expression-review-2026-11-12.json](piano-expression-review-2026-11-12.json).
Detailed local artifacts are in `.local/piano-expression-review-20261112/`.

## Problems fixed

1. **Qualification credited the wrong scope.** Polyphonic or unscorable trials could
   contribute to a policy that authorized isolated edits. Trials now require scope
   and scorability; only scorable isolated trials count toward the currently
   supported isolated category. Corruption-only results cannot qualify a category:
   net natural-decoder improvement must also be demonstrated.
2. **Decoder identity was no longer enforced.** Expression policy fingerprints again
   include the complete decoder/configuration hash. The server requires matching
   weights, model, decoder and audio identities; missing identity no longer passes
   because a check was optional. It also verifies the embedded policy digest.
3. **Estimator changes did not change a prepared profile's identity.** The expression
   file is now hashed into the profile, checked at load and re-verification, and
   checked again before the optional expression subprocess runs. An expression
   mismatch leaves Phase 3 usable. Profiles enabling expression must be freshly
   prepared with the estimator digest; old expression profiles require regeneration.
4. **NaN/infinite values passed some numeric checks.** Qualification evidence and
   audible-ending references now reject non-finite numbers. Automatic duration
   application rejects non-finite and out-of-clip values rather than silently
   clamping an invalid ending into a different edit.
5. **Short proposed durations hid ringing notes.** Isolation now considers an earlier
   note's possible audible tail and checks pitch activity before assuming that tail
   ended. Notes whose tails may overlap are kept outside isolated qualification.
   This is conservative overlap detection, not source separation.
6. **Independent release evidence was incompletely checked.** Both partial groups
   must observe a release; broadband and harmonic endings must agree within the
   existing bounded tolerance in either direction. An unobserved group or much later
   broadband event cannot silently authorize an isolated ending change.
7. **Relative measurements were presented as changes.** A harmonic attack-SNR
   measurement with no proposed velocity was counted as a `change`; its baseline
   also contained a normalized velocity while its stated units were dB. It is now
   explicitly a measurement with `decision: no_change`, a separate baseline velocity,
   and a separate measurement count. Missing AI velocity does not prevent a useful
   diagnostic measurement. No MIDI velocity is inferred from this SNR value.
8. **Standalone audio identity could be missing.** The estimator computes the WAV
   hash itself, rejects a conflicting supplied hash, and checks the requested duration
   against the actual audio. Diagnostic expression profiles can omit an automatic
   policy without the profile loader requiring nonexistent policy fields.

Regression tests cover wrong-scope/unscorable evidence, corruption-only qualification,
non-finite evidence, missing identities, altered policies, ringing tails, diagnostic
units and measurements, measured audio identity and changed estimator bytes.

## Expanded accuracy benchmark

The v2 benchmark was run with three deterministic variations of eight scenarios:
24 rendered recordings and 96 proposal runs across clean, short/flat, long and
natural-decoder inputs. Scenarios include chords, quiet melody over bass, overlapping
tails, repeated strikes and noise. It produced 551 matched-event trial records;
unscorable endings were excluded from accuracy scoring.

| Input | Scorable trials | Isolated duration suggestions | Within 80 ms reference tolerance | Correct values damaged |
|---|---:|---:|---:|---:|
| Clean reference | 126 | 0 | — | 0 |
| Natural AI decoder | 125 | 0 | — | 0 |
| Deliberately corrupted attributes | 252 | 9 | 9 | 0 |

Natural-decoder ending MAE remains **87.8 ms before and after**. This is a safety
improvement over the old harmful estimator, but it demonstrates no useful recovery
of natural duration errors. The nine controlled corrections do not qualify the system
for automatic use on human recordings. Their smaller count than the developer's
earlier smoke run reflects stricter independent-evidence and ringing-tail checks.

Velocity is unchanged throughout. Current attack measurements are diagnostic harmonic
SNR, not calibrated MIDI velocity or validated cross-pitch relative loudness.

## Original video excerpt: full adapter result

The complete newly prepared profile was run on the exact **14.677-second analysis
WAV retained from the original upload**, with its uploaded video as the source asset.
The source path in the user request was `D:\3d_trainer\Sample Videos\Video Project 8.mp4`.
The retained upload is the same trimmed excerpt tested previously.

- The piano decoder produced **34 notes**, exactly matching the previous working
  proposal's events, durations and velocities. The standard-decoder comparison remains
  available in the analysis archive.
- Phase 3 analyzed all **13 passages**, with zero skipped passages and zero safe edits.
- Expression analyzed **34 duration values and 34 dynamics values**, without truncation.
- **Zero duration edits and zero velocity edits** were produced or applied.
- **Seven attack-SNR measurements** were retained as diagnostics, not changes.
- The other cases were withheld because of shared harmonics, overlap, insufficient
  release evidence or excessive extension. No checked audible-ending or calibrated
  velocity reference exists for this clip.
- `raw.npz`, the immutable proposal, Phase 3 report and expression-v2 report are present
  in the resulting `analysis.zip`. Source identity and estimator/profile hashes were
  verified. The existing saved lesson was not overwritten.

Consequently there is **no measured musical improvement on this clip**. The important
improvement is that unreliable duration/velocity edits are not silently introduced.

## Validation

- Full API suite: **392 passed, 1 skipped**.
- Subsequent focused expression, profile, application and handoff checks: **100 passed**.
- Production web build passed.
- Prepared adapter, both analysis stages, owner artifact output and exact original
  event preservation were checked locally.
- No browser end-to-end acceptance test was completed in this review.

## Remaining development

The plan's core audio-attribution and calibrated-velocity work remains outstanding.
The present implementation adds conservative checks around harmonic/broadband
thresholds; it does not implement a validated competing-note decay decomposition,
instrument/pitch velocity calibration, or automatic chord dynamics.

Before calling the overall goal complete:

1. Demonstrate duration recovery on natural AI errors while preserving correct values.
2. Collect independently checked human audible-ending intervals. MIDI key release
   cannot substitute for audible end under sustain and reverberation.
3. Implement and validate attributable attack strength and an applicable velocity
   calibration before allowing velocity edits.
4. Independently qualify supported isolated/polyphonic scopes; unsupported overlap
   remains diagnostic. Do not enable a category merely because software tests pass.
5. Verify the browser workflow, then prepare/register a new immutable profile for
   activation. The tested local profile has not been deployed to the running worker.
