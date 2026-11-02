# Docker handoff · avatar clips

Everything below is what another developer needs to make the Mixamo avatar appear in lessons
inside Docker. Code is committed at `e4c9c4c`; the working tree is clean.

## Two things block it, both in the worker container

**1. The running process predates the code.** The worker mounts `scripts/` from the host, so the
*file* `scripts/saas_worker.py` is current — but Python loaded it at container start:

```
$ docker inspect form-conversion-worker --format '{{.State.StartedAt}}'
2026-10-31T01:12:11Z          # two days before the avatar step existed

$ docker logs form-conversion-worker --tail 3
Conversion d9936fae917f43bdaadfd264e9a84ecf: ready for section review.
```

No `avatar clips published` line, because that code is not in the running process. Recreating
the container is required for any of this to take effect.

**2. The rig profiles are not in the image.** Even after a restart, the retargeter reads its
profiles from `<repo>/packages/avatar-rigs/profiles/*.json`, and `/app/packages` does not
exist:

```
$ docker exec form-conversion-worker ls /app
models  outputs  requirements.txt  scripts  vendor

$ docker exec form-conversion-worker ls /app/packages/avatar-rigs/profiles
ls: cannot access '/app/packages/avatar-rigs/profiles': No such file or directory
```

If it is missing at runtime the retarget logs a warning and the lesson still completes on the
MHR body — nothing breaks, the avatar is simply skipped.

Two ways to fix the second one; pick either.

**Option A — bind mount (fastest, matches how `scripts/` is already mounted):**

```
docker run --gpus all -d --name form-conversion-worker \
  --network bridge \
  -e WORKER_API_URL=http://host.docker.internal:8001 \
  -e WORKER_TOKEN=<the token already in the current container> \
  -v D:\3d_trainer\developement\models:/app/models \
  -v D:\3d_trainer\developement\outputs:/app/outputs \
  -v D:\3d_trainer\developement\scripts:/app/scripts \
  -v D:\3d_trainer\developement\packages:/app/packages:ro \
  form-saas-gpu:latest python scripts/saas_worker.py
```

`docker inspect form-conversion-worker` currently reports exactly the first three mounts,
`CMD ["python","scripts/saas_worker.py"]`, `--gpus all`, `bridge`, and that token in `Env`.
Reuse them; add only the `packages` mount.

**Option B — bake it into the image (correct for a deploy that does not mount `scripts/`):**

Add to `infra/docker/Dockerfile.gpu`, next to `COPY scripts/ scripts/`:

```
COPY packages/avatar-rigs/ packages/avatar-rigs/
```

Then rebuild and recreate:

```
docker build -f infra/docker/Dockerfile.gpu -t form-saas-gpu:latest .
docker rm -f form-conversion-worker
# re-run the same docker run command as above, without the packages mount
```

Note the image currently also relies on the `scripts/` mount. If this worker is ever deployed
without that mount, the image must `COPY scripts/` as well — the Dockerfile already does, so a
bind mount of `scripts/` is redundant but harmless.

## What else needs rebuilding

| Component | Needed? | Why |
|---|---|---|
| Worker image / container | **Yes** | New `scripts/avatar_rig.py`, `scripts/retarget_mixamo.py`; changed `scripts/saas_worker.py`. Add the `packages` mount or COPY above |
| API | **Only if it runs in Docker** | `apps/api/conversions.py`, `lessons.py`, `main.py` changed. The API currently in use is the native process on port 8001 (`uvicorn apps.api.main:app`), restarted from the repo, so it is already current |
| Web bundle | **Yes, if the app runs in Docker** | Frontend-only changes since the last image: `MotionStage.tsx` (travel + camera follow + ground cues). The Vite build copies `public/` into the bundle, including `apps/web/public/avatars/*.glb` and `packages/avatar-rigs/*`. The native server already serves the rebuilt `apps/web/dist`, so only a Docker `app` image needs rebuilding |
| Database | **No** | No migration. Derivatives are rows in the existing `lesson_assets` table |
| Python packages | **No** | `pygltflib`, `numpy`, `scipy` are already in `requirements.txt`, which the GPU image installs |

The `app` compose service has `profiles: ["app"]` and publishes `127.0.0.1:8001:8000`, so it
will collide with the native API on 8001. Do not start both.

## Demo lesson assets (host files, not an image build)

The built-in demonstration has no database lesson: its assets are mounted from the host
(`./web/dist/assets:/demo:ro`, `DEMO_ASSETS_DIR=/demo`) and served by
`GET /api/demo/assets/{name}`. For the demo to use the avatar, these two files must exist in
`web/dist/assets/` on the host:

```
avatar-male.glb
avatar-female.glb
```

They are there now, but that directory is git-ignored and `.dockerignore`d, so they are not in
the image. Any fresh checkout needs them generated:

```
python scripts/prepare_avatars.py                          # builds the avatars + rig profiles
python scripts/retarget_mixamo.py --source outputs/full_video/motion.glb \
    --avatar male --output apps/web/public/dev-clips/male.glb --report <report>.json
# … then copy that clip to web/dist/assets/avatar-male.glb (and the female equivalent)
```

Missing files only mean the demo keeps the MHR reference; nothing errors.

## Existing lessons

New uploads get clips automatically. Lessons converted before this change need a one-off
backfill, because their attempt objects are gone. Run where boto3 and psycopg are available
(the API environment, `.venv-saas` here):

```
python scripts/publish_lesson_clips.py --lesson <id> \
  --male <avatar-male.glb> --female <avatar-female.glb> --report <avatar-report.json>
```

It writes `lessons/<lesson_id>/avatar-*.glb` to the bucket and upserts `lesson_assets` rows.
Idempotent. Already applied to:

- `taegeuk-demo` — via the demo fixture directory, not this script
- `40e650ea2d97448baf8e3dda87f61b66` — Taegeuk 3 Jang
- `d9936fae917f43bdaadfd264e9a84ecf` — newest upload, finished by the old worker without
  derivatives and backfilled by hand

## Files changed (HEAD `e4c9c4c` and the two commits before it)

New:

- `scripts/avatar_rig.py` — rig profiles, bone mapping, rest calibration
- `scripts/retarget_mixamo.py` — MHR → Mixamo converter + validation report
- `scripts/prepare_avatars.py` — builds the prepared avatars and profiles
- `scripts/publish_lesson_clips.py` — backfill publisher (storage + database)
- `packages/avatar-rigs/` — `index.ts`, `profiles/male.json`, `profiles/female.json`
- `apps/web/src/avatar-stage.ts` — loads avatar + clip, validates, returns bones
- `apps/web/public/avatars/{male,female}-<hash>.glb` — the two prepared avatars (~4.4 MB)
- `apps/web/avatar-lab.html`, `apps/web/src/avatar-lab.ts` — project-aware comparison harness;
  now a second Vite entry point served at `/avatar-lab.html` (not linked from the app shell)
- `tests/avatar/` — 28 tests

Modified:

- `scripts/saas_worker.py` — retarget + upload before `/finish`, attach after
- `apps/api/conversions.py` — `MANIFEST_ASSETS`, derivative asset names, `Derivatives` model,
  `POST /jobs/{id}/derivatives`, cleanup narrowed to the manifest assets
- `apps/api/lessons.py` — asset route also serves `avatar-*.glb` for that lesson
- `apps/api/main.py` — demo asset route also serves the demo's `avatar-*.glb`
- `apps/web/src/MotionStage.tsx` — avatar path with MHR fallback; the instructor keeps its real
  floor travel in free view with the camera following it (the OrbitControls target moves, the
  camera rides at a fixed offset), while camera practice still cancels horizontal motion so the
  model stays anchored to the calibration. The ground carries the direction cues: a 40 m grid,
  brown left/right axis, blue forward/back axis, start disc and 1/2/3 m rings
- `apps/web/tsconfig.json` — `resolveJsonModule`
- `pytest.ini` — `testpaths` includes `tests/avatar`
- `docs/avatar-phase-{a,b}-verification.md` — measurements, decisions, open risks

## How to verify after the fix

1. `docker exec form-conversion-worker ls /app/packages/avatar-rigs/profiles` → two JSON files.
2. Upload one short video (< 20 s is quickest) and watch the worker log:
   `docker logs -f form-conversion-worker` should end with
   `avatar clips published (3 assets)`.
3. `docker exec form-form-storage-1 …` or the S3 console: `lessons/<lesson_id>/avatar-male.glb`
   exists, and `lesson_assets` has three rows for that lesson.
4. Open the lesson: the Mixamo instructor should appear. If it does not, the browser console
   reports the reason — a 404 on `avatar-male.glb`, or a duration mismatch (the clip must be
   within 0.1 s of the lesson duration).

## What is not covered yet

- Fingers are a static preset; the source's finger motion is discarded.
- Foot contact is unmeasured. Travel is now preserved in free view, so steps read correctly, but
  contact sliding against the ground has not been quantified.
- The camera follows by moving the OrbitControls target; drag-to-orbit still works, but the
  observation angles in the View panel now rotate around the followed instructor rather than the
  world origin.
- Only the male avatar is selectable in lessons; the comparison lab has a male/female body
  selector, but the lesson selector (Phase E) is still not built.
- `apps/web/public/dev-clips/` is a scratch directory used by the lab; the app no longer reads
  it.
