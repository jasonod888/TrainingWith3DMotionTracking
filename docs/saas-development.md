# SaaS development — Upload, conversion and sharing checkpoint

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

## Accounts and saved lessons

Run all migrations through `0005` with `.venv-saas/Scripts/python.exe -m alembic upgrade head` before starting the updated API. Create an account from **Account**, then open the local test mailbox at `http://127.0.0.1:8025` to follow the verification link. Local email stays in Mailpit; it is not delivered externally. Sign in, choose **Create → Add private lesson**, edit the whole animation into sections, and **Save**. Refreshing or signing in from another browser retains the saved revision. **Keep draft** remains session-only for the public demonstration; private copies use central Save.

To import a different trusted, prepared manifest as an operator:

```powershell
.venv-saas/Scripts/python.exe scripts/import_saas_lesson.py --email your-account@example.com --manifest path/to/manifest.json --assets path/to/assets
```

This validates asset sizes and SHA-256 hashes, uploads private objects and registers the manifest/revision/assets in PostgreSQL. It is a trusted operator import, not a general file-upload feature. The demonstration import button only uses the server-configured allowlisted demonstration; it never accepts filesystem paths from the browser.

Earlier prototype edits are imported only by choosing **Earlier prototype edits → Import browser sections** in a private copy of the same animation. This reads that browser origin's old `form-sections-v1-{duration}` entry only after the explicit click, validates its timings, and leaves changes unsaved for review. Cross-origin browser storage cannot be read; no edits are automatically imported or overwritten.

Removing a lesson archives it: the owner library, manifest and media routes immediately reject further requests, while immutable revisions and private objects remain retained. Phase 1 performs no automatic permanent purge. Already downloaded bytes cannot be recalled. A later retention/cleanup worker must operate only on archived records under the chosen retention policy.

Account sessions and verification/reset tokens are random and stored only as SHA-256 digests. Passwords use salted scrypt (N=131072, r=8, p=1). Session cookies are HTTP-only and SameSite=Lax; hosted environments require HTTPS (Secure cookies) and SMTP STARTTLS. Write requests require an allowed Origin, the application header, JSON and, after sign-in, a session-bound CSRF token. Shared database throttles survive process restarts. Reset invalidates all sessions and existing account tokens. Do not expose local development credentials or Mailpit to the internet.

For Railway/AWS, set `ENVIRONMENT`, `PUBLIC_URL`, SMTP and storage/database settings explicitly. `PUBLIC_URL` is the browser-facing HTTPS origin, never an internal service hostname. No CORS wildcard or trusted forwarding-header assumption is used. Media is streamed through an account-authorized API route, with byte ranges for video seeking; storage stays private and has no browser-facing internal hostname dependency.

Additional checks (using the disposable project smoke container on port 8010):

```powershell
.venv-saas/Scripts/python.exe scripts/verify_phase1_deployment.py
```

See `phase-1-verification.md` for results and the remaining phase boundaries.

## Phase 2 practice and browser assets

The practice screen adds explicit camera/voice activation, height calibration, comparison/composite views, L/R labels and approximate similarity. Private lessons save paused position/speed/mode in PostgreSQL. Revising sections resets old resume state. Returning never restores camera/microphone permission use or calibration automatically.

`npm run dev` and `npm run build` prepare pinned MediaPipe 0.10.21 files into ignored `apps/web/public/tracking/`. The model is copied from the existing local prototype when available, otherwise downloaded from Google's versioned model URL and checked against SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`. The Docker build follows the same preparation; it needs download access to prepare a missing model. There is no runtime CDN dependency for camera frames.

**Camera and voice settings → Recorded test** uses the real tracker on the supplied instructor video. It briefly freezes the configured standing pose for deterministic calibration, then plays the recording. This is a labelled software check, not a live student assessment. No live camera or microphone was enabled during automated browser checks.

Phone testing is deferred by the user. See `phase-2-verification.md` for local evidence and `phase-2-phone-checks.md` for device acceptance and the optional HTTPS launcher. No certificates or firewall settings were installed or changed. The physical-device acceptance gate remains open. Upload/conversion and sharing subsequently proceeded at the user's explicit request; see `phase-3-verification.md` and `phase-4-verification.md`.

## Original Phase 0 checkpoint

Real demonstration playback, section split/merge/rename/boundary editing, and a draft held in the current browser session. **Keep draft** is explicitly temporary. Refreshing clears it. Camera/voice integration, accounts, central saving, upload, and sharing are subsequent phases. The original prototype still provides its existing camera/voice experience.

## UI review

Check library, practice, and editor at 320/360/390/768/1024/1440 CSS-pixel widths and landscape. Verify no horizontal overflow, labelled icon buttons, visible focus, usable touch targets, and the large content stage. Browser viewport emulation is not a claim of real phone/camera testing.

## Upload, conversion and sharing

See `phase-3-verification.md` for the scoped GPU worker setup and cleanup commands. Set `PUBLIC_URL=http://127.0.0.1:8001` when using the built local application so email links return to that origin. The container worker needs the API on the Docker host bridge; run the native API with `--host 0.0.0.0` only on a trusted local development network. CPU app and GPU worker remain separate services.

Choose **Create**, select a video, trim its range, and upload. Processing appears in the library; interrupted uploads can resume using the same source file. Converted lessons remain private and begin with one section covering the whole animation. Open **Edit sections** to split, rename, adjust boundaries and save; the Mimic Interface uses these sections for next/back/pause playback and voice commands.

Choose **Share** on a private lesson, review it, confirm permission to share, and publish. Invite a specific email or generate a link. Local invitations appear in Mailpit on port 8025. Learners sign in with a verified account and explicitly join; **Shared** contains their read-only published lessons. Further teacher edits stay private until republished. Access and recent activity are visible to the teacher; camera frames and pose scores stay on the learner's device. Revoke a learner or make the lesson private to block subsequent API/media requests. Already downloaded media cannot be recalled.

See `phase-4-verification.md` for expiry, revision and revocation behavior and the operator report-review command. No paid plans, group synchronization, cloud resources or physical-device certification are included in this checkpoint.
