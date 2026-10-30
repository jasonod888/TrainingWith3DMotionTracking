# Phase 3 — Upload and conversion

30 October 2026. Local implementation checkpoint; Railway/AWS and physical-phone checks remain deferred. The user's explicit request to implement upload/conversion and sharing authorises proceeding beyond the previously deferred phone gate, without claiming those tests passed.

Implemented: private resumable S3 multipart sessions through same-origin authenticated API routes, per-part SHA-256 resume checks, bounded source size/range/account limits, durable job states, worker availability, cancel/retry, atomic expiring claims, attempt isolation, heartbeat, credential revocation and idempotent finalisation. Browser uploads pass through the API as bounded chunks; direct-to-bucket signed browser upload is not claimed. This keeps localhost/HTTPS and internal bucket addresses usable on both hosting targets.

The isolated Linux worker receives only assigned assets over its scoped API credential. It has no database or bucket credentials. It probes actual container/codec/dimensions/duration, limits protocols and execution time, strips audio/metadata, applies video orientation, normalises to 15 fps, invokes the existing SAM/export scripts, verifies finite motion/animation and keyframe timestamps, and submits hash-checked private outputs. Every new lesson starts as one whole-animation section, ready to split. Original raw source is removed after successful finalisation; the normalised preview is retained with the lesson.

Local worker launcher uses non-root UID, read-only filesystem/models/scripts, dropped capabilities, bounded memory/processes and an isolated writable output mount. Source reconstruction accuracy, foot contact and technique scoring are not certified. Worker dependencies are the previously smoke-tested GPU image; scripts are mounted read-only so the exact current worker code runs.

Tests: existing 28 API checks passed, four new conversion HTTP tests passed, frontend type/build passed. Real source uploaded through multipart API → Linux GPU inference → verified skinned GLB → private library succeeded. The resulting full-animation section was split at 0.5 seconds, renamed and centrally saved in the browser. An invalid file named `.mp4` was rejected by the real worker without creating a lesson. A second upload was submitted through the actual browser chooser/trim/upload screen. Further results are recorded in ignored `.local/qa/` evidence.

The browser-submitted range produced all 18 normalised frames and a ready private lesson. A disposable conversion was interrupted by stopping its real Docker worker during reconstruction; after restarting, the worker waited for lease expiry, claimed attempt two, and produced exactly one revision/lesson with 18 frames. The first attempt's files were not mixed with the second. Full API suite: 32 passed. Existing playback/Mimic and prototype tests remain part of the regression gate. Worker remains running locally for subsequent uploads.

The user named the reusable camera experience **Mimic Interface** during implementation. It is now explicitly named `MimicInterface`, with its input and lifecycle boundary documented in `mimic-interface.md`. No group-specific camera implementation was introduced.

Retention cleanup is explicit: `scripts/cleanup_saas_conversions.py` is dry-run by default; `--apply` expires abandoned uploads after one day, failed source objects after seven days, and stale terminal attempt objects. Schedule it only after reviewing the deployment's retention policy. Local worker attempt logs/files under `outputs/jobs` are retained for diagnosis and are never committed; disk maintenance remains an operator responsibility before unattended/public operation. No cleanup command was applied to unrelated data.

Setup:

```powershell
.venv-saas/Scripts/python.exe -m alembic upgrade head
.venv-saas/Scripts/python.exe scripts/manage_saas_worker.py --api-url http://host.docker.internal:8001
powershell -File scripts/start_saas_worker.ps1 -Detach
```

The native API must listen on the Docker host bridge (for example `--host 0.0.0.0`) for the local container worker. Do not expose the development server publicly. A hosted worker uses the HTTPS application origin. Tokens are written to ignored `.local/worker.env`; revoke by ID with `manage_saas_worker.py --revoke ID`. Docker image preparation is documented in the earlier foundation record. CPU web/API deployment never requires CUDA.

References: [S3 multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [upload validation](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
