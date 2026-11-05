# Music model qualification evidence harness

Updated 5 November 2026. No model is installed, downloaded, selected or qualified.
The CLI evaluates saved proposals and records evidence; it does not run inference or
approve a model for production.

## Artifact and licence evidence

Supply metadata with `name`, `version`, `license`, `sha256`, `source_url`, `code_license`,
`weights_license` and `license_source_url`. Source URLs must use HTTPS. Both code and
weights need eligible declared terms; a code licence alone is insufficient.

The existing label allowlist (Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, CC-BY-4.0)
is a metadata policy check, **not verification that those terms actually grant rights to
the supplied code/weights**. Retain the licence evidence with `--license-file`. The report
records its hash. An operator still needs to verify the evidence applies to the exact
artifact, resolve notices/attribution and approve commercial deployment.

`--artifact-file` is required. Its actual bytes must hash to the declared SHA-256. For
multi-file models, supply a pinned bundle/manifest covering all required files rather
than treating a single unrelated component as the model. No network download occurs.
The harness cannot prove which model generated an externally supplied proposal; the
future qualified adapter/run profile must bind that provenance.

Every report is marked `evidence_only_not_model_or_licence_approval`. No score selects
an engine or changes a feature flag.

## Metrics

Exact pitches are matched one-to-one within an onset tolerance (default 50 ms). Ordered,
earliest-compatible matching per pitch maximizes the number of matched events, avoiding
the old nearest-first greedy counterexample. MAE is measured over those deterministic
pairs; it is not a globally minimized onset-error assignment.

Reports include matched/missing/extra, precision, recall, F1 and onset MAE. Two empty event
lists score perfect silence agreement; a predicted note in a silent reference remains an
extra. Invalid/non-finite notes, excessive events, and negative/non-finite tolerances are
refused. The reference must have review evidence. Duration and velocity accuracy, audio
alignment, finger choice and pedagogy are not evaluated by these onset/pitch metrics.

## Usage

```powershell
python scripts/qualify_music_model.py --artifact artifact.json --artifact-file checkpoint.bin --license-file LICENSE.txt --reference reviewed.json --proposal proposal.json --output report.json
```

The symbolic corpus under `packages/lesson-schema/fixtures/music-corpus` supplies six
project-authored regression cases and expected counts. Regenerate it with
`python scripts/generate_music_corpus.py`. It is not an acoustic benchmark or model
qualification corpus. Real qualification still needs rights-cleared representative
recordings, instructor ground truth, frozen artifact identity and actual inference runs.

`tests/api/test_music_model_qualification.py` covers score cases, the greedy-matching
counterexample, silence, invalid values, the corpus, required code/weights declarations,
actual file-hash refusal, evidence retention and CLI reports.
