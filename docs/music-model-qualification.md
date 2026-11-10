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


## Commercial licensing evidence (10 November 2026)

`--use commercial` is stricter than the default internal-evaluation mode. It requires:

- approved code **and** weights licences, each declared separately;
- `commercial_use` and `redistribution` both `allowed`;
- a non-empty attribution statement;
- an `approval` object with `reviewer_id`, `approved_at`, `decision: approved`,
  `scope` and an `evidence_sha256`;
- `--approval-file` retained locally, whose bytes hash to that evidence digest;
- the artifact bytes hash to the declared `sha256`, and HTTPS artifact/licence sources.

The harness reports `commercial-evidence-complete-not-an-approval`; it never grants a
licence or commercial approval. A human/legal approval record remains authoritative. See
[`music-model-licensing.md`](music-model-licensing.md) for the review checklist and the
record schema.

## Real-audio accuracy corpus

`--corpus DIR` scores a local set of cases instead of one reference/proposal pair. Each
case directory needs `case.json` declaring `real_audio: true`, `reviewed: true`, the audio
file and its SHA-256, plus reviewed `reference.json` and `proposal.json`. The runner:

- refuses synthetic cases, unreviewed references, missing audio and digest mismatches;
- requires at least `--min-cases` (default 3) cases;
- reports per-case metrics and macro precision/recall/F1/onset MAE;
- labels the result `real-audio-reviewed` only when every case is real and reviewed.

It still measures note agreement, not musical technique or licence suitability. No real
recordings or model output are in the repository yet, so **no accuracy claim exists**.

## Status

No transcription artifact is installed or qualified. The fixture engine remains a
transport test. Before processing is enabled: commercial code/weights approval, a
real-audio reviewed corpus with acceptable metrics, and model/runtime packaging must all
be reviewed.


## bb780c9 follow-up: corpus integrity and commercial evidence binding

Corrected the following before any real candidate/corpus is qualified:

- Commercial runs pin actual source/runtime bytes through `--code-file`, and the exact
  terms snapshot through `terms_snapshot_sha256`. Retained approval JSON must bind the
  actual artifact, code and terms hashes plus the same reviewer/date/decision/scope.
  See `music-model-licensing.md`; a generic approval file hash alone is insufficient.
- Corpus audio must decode as bounded **PCM WAV**, not merely exist with a matching hash.
  Header-only/truncated/empty data is refused; the decoded-data bound is 100 MiB. Other
  audio formats must be prepared to WAV explicitly for this harness.
- Each case pins audio, reference and proposal hashes. Relative file paths and symlinks
  must resolve inside the case; case folders and case.json also stay inside the corpus.
- At least three distinct audio-byte identities are required. `--min-cases` may raise
  that floor but cannot lower it. Distinct hashes alone do not prove sample independence,
  acoustic origin, representative diversity or adequate sample size for deployment.
- The reference duration must agree with the decoded audio within 50 ms; proposal notes
  cannot extend beyond that audio. Inference declarations bind the evaluated artifact,
  audio and proposal hashes plus run ID and code version.
- Macro onset error averages only cases that have matched attacks, with an explicit
  contributing-case count. If no case matches, onset MAE is null, not zero or a crash.
  Precision/recall/F1 still include every case, including misses and silence. These are
  macro, per-case metrics, not a micro/pooled score.
- Incomplete single-reference CLI arguments fail cleanly rather than raising a traceback.

Example `case.json` shape (all hashes/IDs below are placeholders, not evidence):

```json
{
  "real_audio": true,
  "reviewed": true,
  "audio": "clip.wav",
  "audio_sha256": "<audio bytes digest>",
  "reference": "reference.json",
  "reference_sha256": "<reviewed reference bytes digest>",
  "proposal": "proposal.json",
  "proposal_sha256": "<proposal bytes digest>",
  "inference": {
    "artifact_sha256": "<evaluated artifact bytes digest>",
    "audio_sha256": "<same audio digest>",
    "proposal_sha256": "<same proposal digest>",
    "run_id": "<retained inference run identity>",
    "code_version": "<frozen adapter/runtime identity>"
  }
}
```

The report is now `reviewed-audio-proposal-comparison`, with
`declared_real_audio_cases`, `audio_origin: declared-acoustic-not-independently-proven`
and `inference_verified: false`. The harness compares saved files: it does not run the
model, authenticate an inference declaration, distinguish recorded versus synthesized
PCM, establish recording rights or independently verify a human review. The per-case
identities are retained in reports so actual inference logs and rights/review evidence
can be checked separately. A verified runner/capture workflow and a real, rights-cleared
corpus remain necessary before making an artifact-accuracy/deployment claim.

Commercial CLI:

```powershell
python scripts/qualify_music_model.py --use commercial --artifact artifact.json --artifact-file model.bundle --code-file runtime.bundle --license-file terms.txt --approval-file approval.json --corpus reviewed-corpus --output report.json
```

Tests generate PCM solely as structural fixtures; they are not acoustic recordings,
actual model inference or legal approvals. No model, commercial licence approval, real
corpus, deployment flag or scoring capability was introduced by these corrections.


Verification: **20 focused tests passed** (15 qualification tests and 5 transcription
adapter tests); Python compilation and diff checks pass. Includes a complete commercial
CLI evidence chain and refusal when a different artifact is substituted in approval
contents, even after updating the approval-file digest. Full API/web suites were not
rerun: no application, UI, worker runtime or feature-flag code changed. Synthetic test
files are not actual recordings, checkpoints or human approvals. Nothing was committed,
pushed, downloaded or enabled in deployment by this follow-up.
