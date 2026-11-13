# Complete piano pipeline audit — 11 November 2026

The corrected pipeline can make a small, measured improvement over the piano decoder,
but automatic correction is **not yet qualified for general uploads**. The current
policies deliberately enable no categories. The original user excerpt does not yet
have a checked reference transcription, and no safe edit was found for that excerpt.

The machine-readable [audit results](piano-system-audit-2026-11-11.json) retain input
identities, implementation fingerprints, coverage and results. Full local artifacts
are under `.local/piano-system-audit/`; third-party recordings are not redistributed.

## Fixes made during this audit

1. The adapter now supplies the verified model, weights, decoder version and complete
   decoder configuration identity to the verifier. Previously a real subprocess
   report lacked information the automatic applier needed, although fabricated
   handoff fixtures passed.
2. Edit preconditions retain the original numeric precision and null velocities.
   Rounding snapshots to four decimal places caused valid merges/deletions/splits
   to fail the applier's tighter comparison. Five duplicate fixes in the controlled
   benchmark now apply successfully instead of conflicting.
3. Automatic operations must match their qualified category: approving an onset
   correction cannot authorize deletion or pitch replacement.
4. Correction and expression policies bind the adapter bytes, preprocessing and full
   decoding settings, in addition to weights and verifier/application code. A policy
   qualified with different thresholds cannot silently authorize the new decoder.
5. Both qualification builders reject duplicate trial identities, invalid splits and
   a performance appearing in development and holdout. Copying evidence can no longer
   inflate measured precision.
6. Memory limits now bound the separable solver's actual workspace, including expanded
   candidate models. The previous check counted an imaginary three-dimensional dense
   dictionary and unnecessarily skipped part of the original clip.
7. A repeated-strike proposal requires a separate decoder onset as well as the acoustic
   attack and fit improvement. Already detected same-pitch strikes are excluded. This
   prevents a false split exposed when the corrected memory guard analyzed more audio.
8. Phase 4 can analyze unchanged working notes when Phase 3 has no qualified edits.
   Previously an insufficient-evidence Phase 3 policy raised an eligibility error and
   unnecessarily blocked the independent expression stage.

Regression tests cover the real subprocess metadata handoff, precision-sensitive
merges, actual workspace limits, false repetition, evidence identity and the
independent Phase 3/4 handoff.

## Accuracy measurements

All note counts below use one-to-one exact-pitch matching with onset error at most
50 ms. They do not establish accurate offsets, pedal, key release, dynamics or written
rhythm.

### Human performances

Three 20-second excerpts, containing 626 reference notes, were taken from original
recorded WAV files paired with the corrected MIDI in
[SMD v2](https://www.audiolabs-erlangen.de/resources/MIR/SMD/midi), using the
[official archive](https://zenodo.org/records/13753319). MIDI-rendered comparison audio
was excluded. Excerpts begin at recording time zero; no offset was fitted to improve
the score. The benchmark files remain local research material.

| Output | Matched | Missing | Extra | Pitch/onset F1 |
|---|---:|---:|---:|---:|
| Standard Basic Pitch decoder | 465 | 161 | 157 | 74.52% |
| Existing piano peak decoder | 563 | 63 | 100 | 87.35% |
| Piano decoder + proposed verifier edits | 563 | 63 | 97 | 87.56% |

The verifier removed three false duplicate events across two performances and damaged
zero matched notes. These edits were evaluated through the shared production applier
with an evaluation-only policy; **the production policy was not enabled**. Most of the
gain over standard Basic Pitch comes from the already implemented piano decoder. The
new verification stage's measured additional gain is small. Three performances from
one piano are insufficient to establish generalization.

Reproduce with local WAV/MIDI pairs having the same filename stem:

```powershell
$env:PYTHONPATH = (Resolve-Path .venv-music/Lib/site-packages).Path
$env:OMP_NUM_THREADS = '1'
.venv-saas/Scripts/python.exe scripts/benchmark_piano_recordings.py `
  --pairs .local/piano-system-audit/smd `
  --weights music-candidate-run/basic-pitch-0.4.0/model.onnx `
  --output .local/piano-system-audit/human-recordings --seconds 20
```

### Controlled corruption benchmark

Eight rendered performances, each with six injected error scenarios, produced nine
successful edits: five duplicate merges, two extra-note removals and two timing fixes.
No previously matched notes were damaged. Clean reference proposals received zero
suggested edits. On the unmodified AI drafts, remaining missing/extra errors stayed
at 77; the verifier abstained. It did not recover missing notes, octave substitutions
or merged repetitions safely enough to propose edits in this evaluation.

The initially exposed false repeated-note split would have increased the natural
draft errors from 77 to 78. After corroboration was required, it remains an unresolved
finding without an executable edit. This failure is a reason to retain qualification
gates, rather than to enable every suggestion.

### Original uploaded excerpt

The full prepared adapter was run on the exact 14.677-second inference WAV retained
from the upload, with the retained uploaded video as its source identity. It produced
34 piano-decoder events and retained the 46-event standard-decoder comparison.

All 13 passages were analyzed, versus 12 before the workspace fix. The report contains
13 unresolved findings and zero safe edits. Phase 4 reports `disabled` under its
unqualified policy, rather than incorrectly reporting an eligibility failure. Raw
activations, immutable proposal, verification and expression reports are present in
the resulting analysis archive. The checked user lessons were not overwritten.

## Verification and operational state

- 139 combined music pipeline/API tests passed, covering worker handoff, review,
  migrations, profile binding, corrections, expression and piano decoding.
- 314 web tests passed; the production web build passed.
- The exact newly prepared profile was tested end to end locally, including both
  analysis subprocesses and archive output. Its hash is recorded in the JSON results.
- The running service's existing profile allowlist was not changed. This prepared
  profile is not an automatic rollout to the currently running worker.
- No automatic correction or expression category was enabled. Requalification and a
  newly prepared profile are required after the implementation identity changes.

Before enabling seamless automatic edits, collect untouched human recordings with
checked reference notes across different pianos and recording conditions, then pass
the existing category-specific held-out gates. Missing-note and pitch substitutions
remain the major accuracy gaps; acoustic residuals alone did not resolve them reliably.
Do not present a visual finding, a lower spectral residual or agreement between two
models as proof that a proposed musical edit is correct.
