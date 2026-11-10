# Music worker packaging and operation

10 November 2026. **Prepared, not built or deployed.** No model is included, downloaded or
approved. The image carries only the transport, profile verifier and fixture adapter
scaffolding; production needs an operator-supplied adapter and pinned artifacts.

## Image

`infra/docker/music-worker.Dockerfile`:

- Python 3.12 slim base; pin its digest for a real release.
- Installs only `music-requirements-lock.txt` and `ffmpeg` from the distribution.
- Runs as UID 10001; no body pipeline, database or bucket credentials.
- Copies the worker, profile verifier and fixture transcription adapter. The fixture
  adapter must never be enabled for production.

Build:

```powershell
docker build -f infra/docker/music-worker.Dockerfile -t form-music-worker:local .
```

The build was not executed here; record the base-image digest and dependency lock in the
release record before using it.

## Mounts and runtime contract

| Path | Mode | Contents |
| --- | --- | --- |
| `/profile` | read-only | run profile JSON, code bundle/lock digest file, commercial approval |
| `/models` | read-only | approved weights/checkpoint; no download at runtime |
| `/config` | read-only | inference configuration referenced by `config_sha256` |
| `/opt/music-adapter` | read-only | the actual executed adapter binary/source; `--code` must point at this executed artifact, not a lock file |
| `/work` | writable volume | attempt-local downloads, extraction and adapter outputs |

The examples are in `infra/docker/music-worker-compose.example.yml`: read-only root,
dropped capabilities, no-new-privileges, a token file mount, CPU/memory/PID limits and an
outbound-only API URL. The adapter is mounted read-only at `/opt/music-adapter`, and
`--code` points at the adapter bytes executed by `--adapter-command`, so the profile's
`code_sha256` covers the real runner. `/work` is a single writable host mount, not also a
tmpfs. A `code.lock` file is packaging evidence, not the executed-code digest. Replace the placeholder image digest, hostnames, artifact digests and
token path before any staging run.

## Startup and refusal behavior

The worker requires either:

- `--profile ... --weights ... --code <executed adapter> --config ... --approval ...`, with every file
  matching the declared digest; or
- explicit `--fixture` for tests only.

A missing/mismatched profile or artifact, model identity in fixture mode, or unsupported
preprocessing fails at startup. The worker never downloads a checkpoint and never falls
back to the fixture engine. `MUSIC_REQUIRE_RUN_PROFILE` and
`MUSIC_ALLOWED_RUN_PROFILES` server-side can require an operator-approved profile digest
and reject fixture provenance.

## Adapter

The adapter receives the analysis WAV, original source, job JSON and output directory; it
must honour `MUSIC_RUN_PROFILE` (checkpoint path, sample rate, preprocessing, thresholds)
and return a draft with `provenance` matching the profile's model/version and the actual
analysis audio hash. The worker verifies the profile again in the adapter environment and
records the profile digest in the draft.

## Operating notes

- One worker credential per pipeline; separate capacity and work volume.
- No inbound ports; outbound HTTPS to the API only.
- Cancellation/lease loss terminates the adapter process; attempt files are removed.
- Log the image digest, profile digest, artifact digests and adapter version per attempt.
- Do not bake recordings, model weights, tokens or approval evidence into the image.

## Remaining before a real run

- Build and scan the image; pin the base digest.
- Install the approved model/code/weights and adapter; retain commercial evidence.
- Configure a staging worker token and profile allowlist.
- Verify real inference with a rights-cleared recording, then record sanitized evidence.


## Smoke result (10 November 2026)

The image built locally as `form-music-worker:ui-smoke`
(`sha256:3be308f3a550a075470d26b3adcf1b5f5f821afacb92ca079dd5cc3c3f1a300d`, ~824 MB).

| Check | Result |
| --- | --- |
| `--help` | Usage rendered |
| Missing token | Exit 2 with `WORKER_TOKEN or WORKER_TOKEN_FILE is required` |
| Token-file mount + verified profile | Started, loaded `/run/secrets/token`, verified weights/code/config/approval and reached claim |
| Tampered weights | Exit 2 with `The weights bytes do not match the run profile` |
| Explicit fixture | `--fixture` accepted; no profile stamped |
| Fixture lifecycle, same Docker network | **Passed**: mock API `complete` mode served one job; source download, ffmpeg extraction, fixture adapter, reference upload and draft handoff completed; work directory empty afterwards |
| Lease loss/cancellation | **Passed**: mock returned 409 after the first heartbeat while a slow adapter slept; worker terminated it, sent no draft and removed the attempt directory |

The local-mock transport flag (`--allow-insecure-local`) exists only for this network test; production requires HTTPS. The image is not scanned, signed, pushed or deployed. No model or adapter was included;
the smoke used the image's fixture transcription adapter as the executed code artifact.
The base image digest and ffmpeg version must be pinned before a real release.
