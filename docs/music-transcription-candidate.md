# Transcription candidate dossier (required before real inference)

10 November 2026. **No candidate is selected or installed.** This dossier defines the
exact evidence needed to assemble one for review; the repository contains only the
selection/benchmark tooling, run-profile verifier, worker transport and fixture adapter.

## Required artifact

One candidate must supply all of the following as immutable, retained evidence:

| Item | Evidence |
| --- | --- |
| Code | Repository/package identity, exact commit or wheel digest, executed adapter entry point |
| Weights | Checkpoint file, SHA-256, source URL, model card/version |
| Runtime | Python/runtime lock, OS/driver assumptions, deterministic CPU/GPU settings |
| Preprocessing | Exact mono/PCM/sample-rate pipeline and resampling library |
| Thresholds | Onset/frame/pitch thresholds and post-processing configuration |
| Commercial terms | Code licence and **weights** licence, commercial-use/redistribution/attribution clauses, retained terms snapshot |
| Approval | Accountable reviewer, date, decision, scope, retained approval evidence digest |
| Attribution | Exact required notice for product/docs |
| Benchmark | Rights-cleared reviewed acoustic corpus, per-case references/proposals, metrics and reviewer |

The existing `scripts/music_run_profile.py`, `scripts/qualify_music_model.py` and
`docs/music-model-licensing.md` enforce/record these fields. A package version alone is
not sufficient.

## Assembly procedure

1. Obtain the code and weights through the approved channel; record digests before use.
2. Build the isolated worker environment from `music-requirements-lock.txt` plus the
   candidate's runtime dependencies; retain the resolved lock.
3. Create `inference.json` containing exactly the profile's `sample_rate`,
   `preprocessing: mono-pcm-s16le` and numeric `thresholds`.
4. Create `run-profile.json` with model/version and all four digests.
5. Create the commercial approval JSON and mount it read-only; enable
   `MUSIC_REQUIRE_RUN_PROFILE` and `MUSIC_ALLOWED_RUN_PROFILES` on the server.
6. Run the worker in the built image with the profile and the real adapter; verify the
   draft provenance records the profile digest and model identity.
7. Run the three-case real reviewed acoustic benchmark and retain the report.

## Current blockers

- No approved code/weights or commercial evidence.
- No rights-cleared recordings or reviewed acoustic references.
- No real adapter installed; the fixture adapter is explicitly non-production.

Until these exist, the private loop remains synthetic and no accuracy claim is made.
