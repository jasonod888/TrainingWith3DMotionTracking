# SaaS development — Phase 0

The new application is additive. The existing `scripts/start_practice.ps1` prototype is unchanged.

## Requirements

- Node 22.12+ and Python 3.12.
- Docker Desktop with its Linux engine running, for PostgreSQL and local S3-compatible storage.
- Existing accepted demonstration assets for the local real-motion preview. No camera or GPU is required just to view a prepared lesson.

## Install

From the repository root, in PowerShell:

```powershell
python -m venv .venv-saas
.venv-saas/Scripts/python.exe -m pip install -r apps/api/requirements-lock.txt
Copy-Item .env.example .env
npm.cmd --prefix apps/web ci
powershell -ExecutionPolicy Bypass -File scripts/start_saas_services.ps1
.venv-saas/Scripts/python.exe -m alembic upgrade head
.venv-saas/Scripts/python.exe scripts/init_saas_storage.py
```

Only copy `.env.example` when creating a new local environment. Do not overwrite existing configuration. The Compose credentials are local development values and its ports bind only to localhost.

The service launcher detects Docker's configured WSL disk drive from its settings and checks free space before downloading or starting containers. It requires 10 GB free on Docker's data drive (25 GB for GPU-image preparation). You can override detection with `-DockerDataDrive D`. This argument checks the drive; it does not relocate Docker. Docker on the original development machine now uses `D:\DockerData\DockerDesktopWSL`, moved using Docker Desktop's supported disk-location setting with the user's approval. Do not factory-reset or prune existing user data to make space.

Local object storage uses pinned SeaweedFS 4.51 through the same S3 interface as hosted storage. The original MinIO image was unavailable and the local RustFS images failed to execute during container verification. SeaweedFS passed the real private-object and signed-download tests. The application depends only on S3 APIs, not the development server's SDK. Only its S3 port is published, on localhost; its internal management endpoints are not published.

If the accepted `web/dist/assets/reference.json`, `reference.glb`, and `demonstration.mp4` already exist:

```powershell
.venv-saas/Scripts/python.exe scripts/prepare_saas_demo.py
```

Otherwise follow the original README to produce the accepted local outputs and run `scripts/prepare_practice_assets.py` in the original GPU environment first. These generated files are intentionally not in Git or the deployment image. The original video's rights must be confirmed before hosted distribution.

## Run

Terminal 1:

```powershell
.venv-saas/Scripts/python.exe -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8001
```

Terminal 2:

```powershell
npm.cmd --prefix apps/web run dev
```

Open `http://127.0.0.1:5173`. Vite forwards `/api` and `/health` to the API. For a production-style single process, build with `npm.cmd --prefix apps/web run build`, then run `scripts/start_saas.ps1` and open port 8001.

Without Docker, the local demonstration interface still works with `DEMO_ENABLED=true`, but `/health/ready` correctly returns 503. This is a UI preview, not a passed database/storage readiness check. Do not use SQLite as a substitute for production PostgreSQL verification.

## Test

```powershell
.venv-saas/Scripts/python.exe -m pytest -q
npm.cmd --prefix apps/web test
npm.cmd --prefix apps/web run build
npm.cmd --prefix web test
docker compose config --quiet
docker build -f infra/docker/Dockerfile -t form-saas:phase0 .
```

The original `web` tests use the real local GLB. New CPU contract/controller tests use synthetic fixtures and run without model weights. The JSON Schema in `packages/lesson-schema/manifest.schema.json` is generated from `apps/api/contracts.py` and checked for drift.

After real PostgreSQL/storage services are running and initialized, run the opt-in integration tests:

```powershell
$env:FORM_TEST_LOCAL_SERVICES = '1'
.venv-saas/Scripts/python.exe -m pytest tests/infrastructure -q
Remove-Item Env:FORM_TEST_LOCAL_SERVICES
```

These tests refuse non-local service URLs. They create uniquely named synthetic verification rows and objects, check database round trips and private/signed object access, then clean up only their own fixtures.

For the complete local container application, initialize the bucket using the local helper above, then:

```powershell
docker compose --profile app up --build -d app
```

The migration service runs before the app. Do not start the native API on port 8001 simultaneously. Data persists in named Docker volumes. Do not remove volumes during routine shutdown.

## GPU portability check

The original native CUDA environment is preserved. The separate GPU image passed local Linux inference and GLB export checks on 30 October 2026; see `phase-0-verification.md`. This does not certify production throughput or motion accuracy. `infra/docker/gpu-requirements-lock.txt` is the tested Linux environment snapshot, not yet an installed build constraint. Rebuilding its ranged dependencies requires repeating these checks. Use at least two frames for animation export. The image can require many GB of downloads; use the disk preflight before rebuilding.

## Scope of this checkpoint

Real demonstration playback, section split/merge/rename/boundary editing, and a draft held in the current browser session. **Keep draft** is explicitly temporary. Refreshing clears it. Camera/voice integration, accounts, central saving, upload, and sharing are subsequent phases. The original prototype still provides its existing camera/voice experience.

## UI review

Check library, practice, and editor at 320/360/390/768/1024/1440 CSS-pixel widths and landscape. Verify no horizontal overflow, labelled icon buttons, visible focus, usable touch targets, and the large content stage. Browser viewport emulation is not a claim of real phone/camera testing.
