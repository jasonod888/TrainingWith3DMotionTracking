# Processing providers — independent of application hosting

The CPU web/API application can run locally, on Railway or on AWS. Inference never runs inside the web process. PostgreSQL owns the durable queue, and private S3-compatible storage owns uploaded and finished assets. Hosting changes do not select the inference provider.

## Switch

Set these server environment variables and restart the API:

| Mode | Configuration | Processing location |
| --- | --- | --- |
| Local GPU | `CONVERSION_PROVIDER=local` | Existing outbound-only GPU worker on your PC |
| Replicate | `CONVERSION_PROVIDER=replicate`, `REMOTE_CONVERSION_ENABLED=true`, `CONVERSION_TARGET=owner/deployment` | Verified custom full-pipeline Replicate deployment |
| fal | `CONVERSION_PROVIDER=fal`, `REMOTE_CONVERSION_ENABLED=true`, `CONVERSION_TARGET=owner/app` | Verified custom full-pipeline fal application |
| Pause new conversions | `CONVERSION_PROVIDER=disabled` | New uploads refused; already accepted jobs retain their route |

The checked-in default is **local**, and remote activation is **false**. An unconfigured remote choice refuses new uploads rather than silently falling back. Existing uploading, queued and running jobs retain their provider, target and pipeline version. A stale Create screen must reload if the provider changed, so its processing disclosure stays accurate. Retries retain the original route.

This is an operator setting, not a learner-facing cloud selection menu. Existing lesson playback, section editing, sharing and the Mimic Interface use the same manifest regardless of where inference ran.

## Railway/AWS with your local GPU

Deploy only the CPU application and its database/private storage. Set `CONVERSION_PROVIDER=local` and the application's HTTPS `PUBLIC_URL`. Do not deploy a GPU/model container to Railway. Provision a local worker credential against the hosted database with the operator script, targeting the hosted HTTPS API:

```powershell
.venv-saas/Scripts/python.exe scripts/manage_saas_worker.py --provider local --api-url https://your-app.example --output .local/hosted-local-worker.env
powershell -File scripts/start_saas_worker.ps1 -CredentialFile .local/hosted-local-worker.env -Detach
```

Run credential provisioning only in an operator environment connected to the intended database. Never put production database credentials in the GPU worker's environment file. The generated file contains only the scoped worker credential, API origin and provider identity. Transfer it privately to your processing PC if provisioned elsewhere. The existing local worker credential is not automatically valid against a new cloud database.

The PC makes outbound HTTPS requests; no public PC port, tunnel or inbound webhook is needed. If it is off, local jobs stay queued and the library says **Waiting for the processing computer**. There is no paid fallback. Restart the existing named local worker after changing its credential file; preserve model and output mounts. Do not run two containers with the same name.

## Remote dispatchers

Replicate/fal adapters implement submit, status/result polling and best-effort cancellation. A separate lightweight dispatcher uses the same scoped worker API; it has no model weights, CUDA, database credentials or bucket credentials. It may run next to the hosted API or on another trusted machine. No incoming provider webhook is required.

Provision a separate credential using `manage_saas_worker.py --provider replicate` or `--provider fal`, with the hosted HTTPS API URL. Put the provider API key only in this dispatcher's secrets as `PROVIDER_API_TOKEN`; never expose it in browser configuration or the GPU worker. The worker file also sets `WORKER_API_URL`, `WORKER_TOKEN` and `WORKER_PROVIDER`.

```powershell
docker build -f infra/docker/Dockerfile.dispatcher -t form-dispatcher .
docker run --rm --user 10001:10001 --read-only --cap-drop ALL --security-opt no-new-privileges --env-file .local/remote-worker.env form-dispatcher
```

Add the provider key to that ignored, private environment file using your deployment secret mechanism. On Railway/AWS use a separate worker service/task with this Dockerfile and no public ingress. Run one dispatcher per credential; more dispatchers require distinct credentials. `REMOTE_CONVERSION_CONCURRENCY=1` defaults to one outstanding processing slot per provider across credentials, enforced with a PostgreSQL transaction lock. Upload duration, size and account quotas still apply. This is a concurrency bound, not a guaranteed currency spending cap: configure provider account budgets/alerts and benchmark cold starts, processing and transfers before paid activation.

## Required custom pipeline contract

An arbitrary marketplace motion/video model is not a compatible replacement. Before setting `REMOTE_CONVERSION_ENABLED=true`, package and verify the complete video preparation → SAM reconstruction → rig/landmark export → preview/thumbnail pipeline on the chosen service. Check model/weights redistribution and commercial-use permissions. Pin that deployment's implementation/model revision operationally; do not update it in place while jobs depend on it. A future incompatible pipeline requires a new pipeline version and adapter.

Input JSON:

```json
{
  "video_url": "https://your-app.example/api/worker/input/JOB/temporary-capability",
  "start": 0,
  "duration": 10,
  "pipeline_version": "sam-3d-body-v1",
  "engine_version": "b5c765a0d89d789985e186d396315e7590887b94"
}
```

The input URL grants access to one source only while a valid active worker lease exists. It does not contain the worker/API credential. It stops working after cancellation, expiry, completion or worker revocation; recovery of a known provider request preserves the original input capability. Do not log these capability paths in reverse proxies or provider application logs. The packaged API disables access logging; platform proxy logs must be configured separately.

The provider result must be a JSON object with `pipeline_version`, `manifest` matching `packages/lesson-schema/manifest.schema.json`, and `files` mapping exactly these names to HTTPS download URLs: `reference.glb`, `reference.json`, `preview.mp4`, `thumbnail.jpg`. The manifest must identify the pinned SAM engine version and use the current units, coordinate axes and timestamps, a normalized preview with audio removed, and one whole-animation section. Emit JSON as an object, not a string or ZIP archive. Replicate returns this object as its prediction `output`; fal returns it as the request result.

Output URLs must use the selected provider's delivery domains (`replicate.delivery` and subdomains, or `fal.media` and subdomains). Other storage domains require a deliberate reviewed adapter change. Downloads do not follow redirects or carry provider/application authorization headers, and each output is limited to 64 MiB. The dispatcher imports outputs into our private storage, and the API checks engine version, attempt scope, manifest, file hashes/sizes and GLB container before creating a private lesson. The external deployment must pass the same finite-motion/keyframe checks as the local pipeline before activation. The framework alone does not certify external model output quality.

## Recovery and charge protection

Submission intent is committed before contacting a paid provider, and the returned request ID is committed before polling. Restart recovery polls the same request ID. A missing/uncertain POST response is never automatically submitted again. Uncertain submissions reserve a processing slot until reconciled. Provider retries for transient status errors only poll the existing request. There is no automatic cross-provider rerouting.

Cancellation immediately blocks new source/media/finalization requests. A live dispatcher requests provider cancellation and polls for terminal confirmation; cancellation signals do not guarantee immediate billing termination. If the dispatcher is offline or cannot confirm the result, the slot remains held. Operators must review the provider dashboard, then either resume an existing identified request or confirm no active work remains:

```powershell
.venv-saas/Scripts/python.exe scripts/reconcile_saas_conversion.py JOB_ID --attach-request EXISTING_PROVIDER_REQUEST_ID
.venv-saas/Scripts/python.exe scripts/reconcile_saas_conversion.py JOB_ID --confirmed-no-active-request
```

These commands never create a paid request. A cancelled job cannot be resumed. Releasing a slot leaves the stopped job non-retryable; it never silently charges again. Source retention cleanup remains seven days for failed jobs; reconcile before that window expires. Already submitted third-party data cannot be recalled by revoking our input URL.

## Verification checkpoint

Local API routing, disabled/unconfigured modes, stale-screen rejection, provider/pipeline isolation, source capabilities, submission receipts, concurrency reservations, cancellation and idempotent finalization are tested with synthetic inputs. Replicate/fal HTTP transports and fresh/recovered end-to-end dispatch are exercised using simulated provider responses through the real application endpoints. No paid calls, provider deployment, cloud resources or model uploads were made. Remote activation remains gated until a compatible custom deployment is selected, credentials are installed and a paid staging benchmark is explicitly authorized.

Primary API contracts: [Replicate HTTP API](https://replicate.com/docs/reference/http), [fal submission](https://fal.ai/docs/api-reference/inference-api/queue/submit), [fal status](https://fal.ai/docs/api-reference/inference-api/queue/status), [fal results](https://fal.ai/docs/api-reference/inference-api/queue/result), [fal cancellation](https://fal.ai/docs/api-reference/inference-api/queue/cancel).

Verified on 30 October 2026: 49 API checks passed across the full regression and final provider-specific run; seven real local PostgreSQL/storage integration checks passed, including concurrent dispatcher claims. Frontend type checking/build passed. Both CPU web and dispatcher images built; the dispatcher started read-only, non-root and offline with no credentials. Final CPU containers passed readiness with local processing available and unconfigured Replicate safely unavailable. A real 1.2-second source completed on the existing local GPU worker with 18 frames, one attempt and one whole-animation section. Provider integrations were simulated only; no paid service was contacted.
