# Phase 0 verification record

Date: 30 October 2026. Status: **Phase 0 local gate passed**.

Phase 1 may begin. Cloud deployment and real phone testing remain later gates.

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
| Docker Compose dependencies | PostgreSQL, Mailpit, and private SeaweedFS storage run successfully |
| Real local integration tests | 4/4 passed: migrated PostgreSQL, revision round trip, signed/private media access, missing-object rejection |
| CPU container HTTP smoke | Liveness, readiness, frontend and capabilities return 200; disabled demonstration returns 404 |
| Storage outage and recovery | Liveness remains 200; readiness changes to 503 and recovers to 200 |
| Restart persistence | Synthetic lesson/revision and media survived PostgreSQL/storage restart; CPU container recovered after its own restart |
| Native CUDA environment | RTX 4060 Laptop GPU, CUDA 12.8, SAM/PyMomentum imports and checkpoint detected |
| Real reference in browser | Loads and renders without console errors in tested flow |
| Section navigation | Section 3 stopped at exactly 13.7 seconds with “Hold this pose” |
| Video/3D switching | Held animation at 13.7 seconds; source video aligned at 19.205506 seconds, including original source offset |
| Section editing in browser | Split 20 → 21 sections, renamed first section, merged 21 → 20, kept session draft with honest persistence notice |
| Speed/settings | Half-speed selectable; settings close without losing lesson time |
| Responsive editor | No horizontal overflow and no unlabelled buttons at 320, 360, 390, 768, 1024 and 1440 CSS pixels |
| Responsive practice | No horizontal overflow at the same six widths; 390-pixel visual inspection recorded |
| Source hygiene | Git whitespace check and credential-pattern scan found no issues in candidate source |

59 automated tests passed in total across the old and new applications, including the four real-service integration tests. Additional deployment checks passed via `scripts/verify_local_deployment.py`, with evidence in `.local/qa/local-deployment.json`. The frontend build has a size warning for the deferred Three.js chunk; the library's initial JS bundle is approximately 77 KB gzip and the on-demand renderer approximately 155 KB gzip. The API test dependencies emit one non-failing upstream deprecation warning.

Local visual evidence, intentionally ignored by Git:

- `.local/qa/phase-0-mobile.png`
- `.local/qa/phase-0-editor-desktop.png`
- `.local/qa/phase-0-responsive.json`

## Outstanding gates and blockers

1. **Local Docker disk space — resolved.** The user approved relocation, which completed through Docker Desktop's supported UI. Docker now uses `D:\DockerData\DockerDesktopWSL`. Image/volume identities were checked after the move; actual database and media persistence tests passed. See `docs/docker-relocation.md`. A guarded launcher detects and checks the configured data drive before starting services.
2. **Railway testing deferred by user.** The user selected “Keep testing local for now.” Do not create cloud projects, databases or storage. No new Railway resources were created and existing projects were not modified. Hosted smoke testing is a future deployment gate, not a reason to request the same approval again during local development.
3. **Linux CUDA portability passed locally.** Image `97961b2e9d25` ran three real frames at 0, 0.2002 and 0.4004 seconds on the RTX 4060, then exported a 127-joint, 2.06 MiB skinned GLB. Structure and preserved timestamps were checked. The isolated synthetic exporter also passed all joint-position, nonuniform-timing, root-translation and rotation-wrap assertions. Evidence: `outputs/linux_animation_smoke_20261030/` and `.local/linux-export-verification/export_check_synthetic/verification.json`. These are smoke checks, not a motion-quality certification. Upstream checkpoint warnings remain visible. `infra/docker/gpu-requirements-lock.txt` records the tested Linux environment; the Dockerfile currently installs its declared ranges and does not consume this snapshot.
4. **Real mobile devices remain untested.** Responsive browser checks passed. Camera/microphone and sustained phone behaviour belong to Phase 2 and cannot be certified from viewport resizing.

## Completion and next phase

Docker was updated by the user to engine 29.9.2. The existing GPU image and project volumes were retained. Local services, CPU delivery, storage outage recovery and restart persistence were verified again after that update.

Proceed to Phase 1 accounts/private library. Railway remains deferred. Real-device camera and voice checks remain Phase 2 work.
