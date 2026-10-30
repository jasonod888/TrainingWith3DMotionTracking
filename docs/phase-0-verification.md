# Phase 0 verification record

Date: 30 October 2026. Status: **implemented locally; release gate pending**.

Do not start Phase 1 until the outstanding infrastructure gates below pass or the user explicitly changes the phase gate. No claims of completed cloud deployment or real phone testing are made.

## Delivered

- Additive React/TypeScript/Vite application; original prototype preserved.
- Content-first responsive library, real 3D/video practice preview, section editor, split/merge/rename and precise boundary editing.
- Shared deterministic playback controller with end-pose hold, next/back/replay, pause/resume, speed and full-sequence modes.
- Explicit session-only draft saving. Accounts, central persistence, camera/voice integration and conversion UI remain later phases; capability endpoint reports them as unavailable.
- Versioned Pydantic/JSON Schema/TypeScript lesson and section contracts; engine, confidence, timing, object hashes and provenance included.
- Original synthetic two-bone skinned GLB fixture; CPU tests need no downloaded videos or weights.
- FastAPI liveness/readiness, opt-in allowlisted local demonstration, SQLAlchemy models and initial Alembic migration, private storage readiness interface.
- Separate CPU and candidate CUDA Dockerfiles, local Compose, Railway config, AWS portability notes, isolated API dependencies, setup scripts and CI workflow.
- API does not import torch, load models, or run inference during startup. New UI loads its 3D renderer only when entering a lesson.

## Passed checks

| Check | Result |
| --- | --- |
| Existing prototype tests | 29/29 passed |
| New engine and original synthetic GLB tests | 9/9 passed |
| API and contract integration tests | 17/17 passed |
| TypeScript check and production frontend build | Passed |
| Alembic PostgreSQL migration | SQL generation and real execution on the local PostgreSQL 17 container passed |
| CPU application Docker build | Passed; image `form-saas:phase0` built successfully |
| Docker Compose dependencies | PostgreSQL and Mailpit started healthy; object storage startup pending disk-space recovery |
| Native CUDA environment | RTX 4060 Laptop GPU, CUDA 12.8, SAM/PyMomentum imports and checkpoint detected |
| Real reference in browser | Loads and renders without console errors in tested flow |
| Section navigation | Section 3 stopped at exactly 13.7 seconds with “Hold this pose” |
| Video/3D switching | Held animation at 13.7 seconds; source video aligned at 19.205506 seconds, including original source offset |
| Section editing in browser | Split 20 → 21 sections, renamed first section, merged 21 → 20, kept session draft with honest persistence notice |
| Speed/settings | Half-speed selectable; settings close without losing lesson time |
| Responsive editor | No horizontal overflow and no unlabelled buttons at 320, 360, 390, 768, 1024 and 1440 CSS pixels |
| Responsive practice | No horizontal overflow at the same six widths; 390-pixel visual inspection recorded |
| Source hygiene | Git whitespace check and credential-pattern scan found no issues in candidate source |

55 automated tests passed in total across the old and new applications. The frontend build has a size warning for the deferred Three.js chunk; the library's initial JS bundle is approximately 77 KB gzip and the on-demand renderer approximately 155 KB gzip. The API test dependencies emit one non-failing upstream deprecation warning.

Local visual evidence, intentionally ignored by Git:

- `.local/qa/phase-0-mobile.png`
- `.local/qa/phase-0-editor-desktop.png`
- `.local/qa/phase-0-responsive.json`

## Outstanding gates and blockers

1. **Local Docker disk space.** The startup failure was resolved by renaming the socket-only runtime folders, while Docker was stopped, to `C:\Users\enqui\AppData\Local\Docker\run.phase0-backup-20261030` and `C:\Users\enqui\AppData\Local\docker-secrets-engine.phase0-backup-20261030`. Originals were preserved; no factory reset or data deletion was performed. Docker 29.2.1 then started, the CPU image built and the PostgreSQL migration ran. Subsequent image downloads exhausted C: and Docker storage became read-only, preventing object-storage/container startup and GPU build. Docker was stopped; this recovered roughly 0.7 GB but remains below the safe preflight threshold. User was asked whether to relocate Docker's approximately 13 GB data disk to `D:\DockerData` or free C: space themselves. No relocation has been performed. A guarded launcher now checks available space first.
2. **Railway testing deferred by user.** The user selected “Keep testing local for now.” Do not create cloud projects, databases or storage. No new Railway resources were created and existing projects were not modified. Hosted smoke testing is a future deployment gate, not a reason to request the same approval again during local development.
3. **Linux CUDA portability remains unverified.** The native environment check passed, but the GPU build failed before dependency installation because Docker's metadata filesystem became read-only. A native success is not substituted for Linux verification.
4. **Real mobile devices remain untested.** Responsive browser checks passed. Camera/microphone and sustained phone behaviour belong to Phase 2 and cannot be certified from viewport resizing.

## Next actions after unblocking

1. Start PostgreSQL/storage/mail, initialize the local bucket, execute migration, restart and verify persistence, and run private object round-trip checks.
2. Build/start the CPU image and verify `/health/live`, `/health/ready`, static UI delivery and failure/recovery behaviour.
3. Leave Railway deployment deferred, respecting the user's local-only choice. Retain portable deployment configuration for a later release.
4. Build/test the CUDA image with a one-frame sample and exporter verification, recording any Linux dependency fixes.
5. Mark Phase 0 complete only after the gates pass, then proceed to accounts/private library in Phase 1.
