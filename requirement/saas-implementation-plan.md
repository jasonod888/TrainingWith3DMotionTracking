# Movement Learning SaaS — Implementation Plan

Date: 30 October 2026

Status: Proposed implementation baseline; no application changes or deployments made by this plan.

## 1. Product outcome and boundaries

Build a mobile-responsive movement-learning service where the same person can learn and teach using one account. A user uploads a suitable single-person demonstration, reviews the generated animation, divides it into teachable sections, and practises or shares it. Every lesson starts private.

The learning experience is the product's centre: a large video/3D stage, clear movement controls, optional camera comparison, and very little text. Creator tools live outside the active practice screen.

Initial release includes private lessons, free sharing, invitations, saved sections, practice history, and an instructor view of access and participation. Pricing, subscriptions, credits, checkout, paid publishing, payouts, and sales reporting are deferred together. Operational usage limits and cost measurement are still necessary before open uploads.

Courses, marketplace discovery, academy administration, white labelling, automatic expert coaching, and automatic technique naming follow later. Start evaluation with Taekwondo demonstrations while keeping the lesson format activity-neutral. Do not promise conversion of every video.

## 2. Existing work to preserve

| Existing component | Evidence in current repository | Planned treatment |
| --- | --- | --- |
| SAM inference and motion export | `scripts/process_video.py`, `scripts/export_glb.py` | Wrap as isolated processing stages; preserve pinned sources, timestamps, and verification |
| Working reference package | `scripts/prepare_practice_assets.py`, local `outputs/full_video/` | Import as the first versioned lesson; preserve the accepted rig |
| Browser practice and camera calibration | `web/dist/app.js`, `pose.js`, `composite.js` | Extract reusable engine modules and retain current behaviour |
| Rig sections and navigation | `web/dist/segments.js`, section handling in `app.js` | Promote to a first-class lesson feature, persisted on the server |
| Voice commands | `web/dist/voice.js` | Reuse recognition lifecycle, exact command parsing, and duplicate suppression |
| Browser conversion experiment | `motion-lab.js`, `converter-worker.js`, `motion-processing.js`, `mannequin.js` | Keep as a separately labelled lab until compatibility and quality gates pass |
| Automated verification | 29 browser/data tests passed during repository review | Preserve and extend where contracts or behaviour change |

Current limitations: practice loads fixed asset paths; section edits are stored in browser-local storage; arbitrary conversion does not yet feed the complete practice workflow; accounts, central storage, access controls, and production operations do not exist. Existing prototype section timings are specific to the demonstration and must never be reused automatically for unrelated videos.

Keep the existing local prototype runnable throughout migration. Its editable source currently lives in `web/dist/`, despite the directory name. Migrate deliberately rather than treating that folder as disposable build output.

## 3. Architecture and technology decisions

Use one repository, one application backend, and separately runnable workers. Avoid a microservice expansion before usage justifies it.

| Layer | Proposed implementation | Reason |
| --- | --- | --- |
| Web application | React + TypeScript + Vite, responsive CSS design tokens | Reusable screens and explicit player state while retaining Three.js and MediaPipe |
| Learning engine | Framework-independent TypeScript modules with Three.js and browser workers | Keep rendering/inference outside frequent UI rerenders |
| Backend | Python FastAPI with typed request/response schemas | Integrates naturally with the existing Python processing code |
| Persistence | PostgreSQL, SQLAlchemy, Alembic migrations | Portable account, lesson, access, session, and job data |
| Authentication | Email/password, maintained password-hashing and session libraries, opaque server-side sessions | No hosting-provider identity dependency; implement recovery and verification rather than custom cryptography |
| Durable job queue | PostgreSQL-backed job records with atomic claims and leases | One durable source of truth; no Redis dependency initially |
| Media storage | Private S3-compatible object storage | Local development storage, Railway Buckets, and AWS S3 share an interface |
| Packaging | Separate CPU application and CUDA worker Docker images | Keep model dependencies out of the web deployment |
| Infrastructure | Compose locally, Railway configuration first, AWS infrastructure as code later | Deploy the same application images with different infrastructure settings |

Build the web assets in a Node build stage and serve them with the API under one origin initially. This simplifies cookie sessions and deployments. Keep the API independently addressable so static hosting/CDN delivery can be introduced on AWS without changing the lesson model.

Do not make SAM GPU dependencies mandatory for starting the API, running database migrations, viewing a lesson, or practising an existing lesson.

### 3.1 Local, Railway, and AWS deployment matrix

| Capability | Local development | Railway first | AWS later |
| --- | --- | --- | --- |
| Web + API | Native development servers or CPU application container | CPU application container | Same image on ECS/Fargate behind an HTTPS load balancer |
| Database + jobs | PostgreSQL container | PostgreSQL service with persistent storage | RDS PostgreSQL |
| Media | Local S3-compatible development container with a persistent volume | Private Railway Bucket | Private S3 bucket; optional CloudFront delivery |
| CPU validation/maintenance | Local worker process/container | Separate CPU worker from the application image | ECS CPU worker |
| SAM conversion | Existing Windows/CUDA environment first; Linux GPU container after verification | Outbound-connected worker on the current GPU computer for a controlled pilot, or external GPU host | GPU worker on ECS with GPU-enabled EC2 capacity |
| Email | Local captured test mailbox | Configurable transactional SMTP provider | SMTP provider retained or SES integration |
| Secrets | Ignored local environment file | Railway variables | Secrets Manager / task configuration and IAM roles |
| Logs/monitoring | Console and local status | Structured logs plus separate uptime/worker monitoring | CloudWatch and application alerts |

Railway is the initial application host. This plan does not assume Railway provides suitable CUDA GPU capacity. Its public GPU discussions remain unresolved; recheck before deployment. The existing SAM runner explicitly requires CUDA. A CPU-only Railway service must not be presented as a SAM processing replacement.

For the first hosted pilot, the local GPU worker polls authenticated HTTPS endpoints, obtains a narrowly scoped job lease and temporary media URLs, processes locally, and reports completion. No inbound port, public GPU endpoint, or public database access is required on the user's computer. The machine must stay online for new conversions. When it is offline, show a processing-unavailable/queued state; existing lessons remain usable. Move conversion to a managed GPU host before advertising dependable public processing availability.

### 3.2 Portability rules

- Configure origins, database URLs, storage endpoint/region/bucket/addressing style, mail, worker credentials, model paths, limits, and timeouts through environment settings. Commit a documented `.env.example` without credentials.
- Listen on `0.0.0.0` and the supplied `PORT`; provide liveness and readiness endpoints. Do not load GPU models during web startup.
- Store object keys and checksums in PostgreSQL, never permanent provider URLs or Windows absolute paths. Generate short-lived URLs after authorisation; refresh them on expiry.
- Treat container disk as temporary. Store durable media in object storage and metadata in PostgreSQL. Mount model caches separately on GPU hosts.
- Run schema migration once per deployment, independently of replica startup. Prefer additive migrations; database rollback is a separate operation from image rollback.
- Keep queues provider-neutral initially by retaining PostgreSQL on all environments. Add SQS or another queue only if measurements justify a later adapter.
- Keep object lifecycle cleanup in application jobs initially, because S3-compatible providers need not support identical lifecycle/versioning features.
- Pin and test Linux dependency builds before calling the GPU worker portable. Current Windows success does not prove the CUDA container works.

## 4. Saved lesson format and data model

A lesson has a stable ID and owner. Its content is stored as immutable revisions. A published revision remains intact while its owner edits a draft. A learner's saved progress references the revision and section set used during practice.

### 4.1 Lesson package contract

Define and validate a versioned manifest containing:

- Lesson/revision identifiers, title, thumbnail, duration, and original source interval.
- Animation object key, rig/bone mapping, standing reference frame, and measured scale.
- Comparison landmark object key, joint naming, confidence values, and timestamps.
- Explicit coordinate axes, units, root-motion policy, and source-to-animation time mapping.
- Section-set revision and ordered sections with stable IDs and start/end times.
- Conversion engine/version, sampling settings, smoothing, model/source provenance, and quality warnings.
- File sizes, MIME types, content hashes, and package schema version.

Do not assume SAM and browser MediaPipe produce equivalent output. Introduce an adapter per engine into this contract. Missing confidence must be represented honestly; the current SAM reference mapping assigns confidence 1 and should not be described as measured certainty. Preserve the original uploaded video independently of its trimmed conversion interval.

### 4.2 Main entities

| Entity | Main responsibilities |
| --- | --- |
| User / session / recovery token | Identity, verified email, expiring/revocable sessions and recovery |
| Lesson | Ownership, title, current draft/published revision, archive status |
| Lesson revision / asset | Immutable motion package, source interval, quality/provenance, private object keys |
| Section set / section | Revision-specific timeline, stable section IDs, labels, boundaries |
| Conversion job / attempt / worker lease | State, progress, worker capability, retries, timestamps and errors |
| Access policy / grant / invitation | Who can discover and practise a lesson; revocation and expiry |
| Practice session / progress | Revision-aware resume point, section repetitions, duration, optional similarity summaries |
| Audit event / usage event | Publishing/access changes, processing consumption, support evidence |

Discovery is separate from access. Initially support private, unlisted-link, and invite-only distribution; defer a public catalogue. Owners always have access. Free access does not mean unrestricted access. An unlisted link is a bearer capability and can be forwarded; use authenticated invitation grants for restricted students. Store share/invitation token hashes, support rotation/expiry, and enforce access on every media URL request.

Commercial entitlements can later become another access-grant source. Do not build payment tables or display paid options before the pricing phase.

## 5. Animation sections and voice-controlled learning

This is a core release requirement and an existing capability to preserve, not a later enhancement.

### 5.1 One rig, multiple teachable sections

Keep one complete animated rig and create logical timeline sections. Do not cut the mesh or generate separate GLBs for each movement. The player seeks and clamps playback within the selected time interval, preserving animation continuity and reducing duplicate downloads.

For a new lesson, create one section covering the complete animation. The creator pauses at a boundary and chooses **Split**, adjusts the boundary if necessary, names sections optionally, and merges adjacent sections when appropriate. Provide a visual filmstrip/timeline and draggable boundary handles, with precise time fields in an optional details panel. Automatic suggestions may come later; no automatic technique recognition is assumed.

Import the existing demonstration's hand-set boundaries as its own section set. Existing local edits can be explicitly imported after validating against the matching lesson; do not associate edits using duration alone, as the prototype currently does.

Validation must ensure ordered, finite boundaries with no gaps or overlaps, full animation coverage, stable IDs, and a supported minimum duration (retain the current 0.05-second technical minimum initially). Display useful guidance for impractically short teaching sections. Store times relative to animation zero and retain the original video offset separately.

Save section drafts centrally. Preview a section before publishing. Use revision checks to prevent one browser silently overwriting another editor's changes. Published edits create a new section-set/content revision. Do not shift an active student's section boundaries midway through a session; offer the newer lesson on the next load and map progress only where section identity is still meaningful.

### 5.2 Command behaviour

All inputs call one playback controller: buttons, keyboard, and voice. Section mode is the default; uninterrupted full-sequence mode remains available.

| Input/state | Required behaviour |
| --- | --- |
| Next before starting | Play the first section |
| Next during/after a section | Play the next section from its beginning |
| Section end | Stop exactly at the end pose and hold it |
| Pause | Freeze the current animation time; retain section and speed |
| Back | Play the previous section forward from its start; clamp at the first section |
| Again | Replay the current section; before starting, play the first |
| Play after a manual pause | Continue from the paused position |
| Play after section completion | Replay that section |
| Next after the final section | Stay at the end and show completion; do not wrap automatically |
| Scrub / change speed / switch view | Preserve a consistent section/time state; scrubbing pauses playback |
| Camera calibration | Pause reference playback and reject movement-navigation commands until complete |
| Hide/leave page | Pause playback and stop recognition; release camera/microphone on exit |

Separate playback state from tracking state: students can preview and navigate without enabling camera access. Restore position after returning to a lesson, but require fresh camera calibration and do not automatically resume recording permissions or voice listening.

### 5.3 Voice support

Retain Next, Back, Again, and Pause as exact supported commands, with duplicate suppression and final-result handling. Voice is explicitly enabled by the user. Provide a compact listening indicator, an accessible label, and short failure messages. Buttons are always available. Unsupported or denied recognition must not block a lesson.

Recognition support varies by browser; certify actual target devices instead of assuming universal mobile support. Explain once during voice setup that the browser's speech service may process audio remotely. The application does not retain audio. Microphone permission is independent of camera permission. Check behaviour with demonstration audio, background noise, and phone-to-TV audio feedback. Additional languages and offline speech recognition are deferred.

## 6. Content-first interface and mobile behaviour

### 6.1 Navigation and visual language

- Primary destinations: **Library**, **Create**, **Account**. Teaching/access tools appear within owned lessons, rather than a separate product or role-selection onboarding.
- Library uses large thumbnails and small status badges. Separate owned and shared-with-me content using simple tabs. Main action: **Practise**. Secondary actions live in an overflow menu.
- Use quiet neutral surfaces, one restrained accent, readable type, generous spacing, and strong contrast. Keep technical terms such as rigs, GPU workers, and manifests out of normal product screens.
- One main action per step, short labels, icon-plus-label controls, and progressive disclosure. Empty states use one sentence and one action. Errors remain specific enough to recover from.
- The practice stage receives most of the available space. Do not place sales, processing details, long instructions, or analytics panels around it.

### 6.2 Screens and key states

| Screen | Primary content and action |
| --- | --- |
| Sign in / register | Minimal fields; verification and recovery states |
| Library | Lesson thumbnails, processing badges, create/practise/resume |
| Create | Select video, visual source-range trim, suitability check, Convert |
| Processing | Thumbnail, current stage, honest progress, cancel/retry where available |
| Review and sections | Large video/3D preview, timeline, Split/Merge, Save lesson |
| Lesson detail | Thumbnail, creator, section count, Practise, owner Share/Edit |
| Practice setup | Short visual full-body/camera-position guide, calibration, Start |
| Practice | Large reference/camera stage; section name/count; Back, Again, Play/Pause, Next |
| Settings sheet | Speed, camera, mirror, view, avatar opacity/position, optional voice |
| Share / students | Distribution choice, copy/revoke link or invite, access list |
| Practice history | Resume point and useful participation summaries without leaderboard pressure |

### 6.3 Responsive acceptance criteria

- Design from 360 CSS pixels upward; verify at 320, 360, 390, 768, 1024, and desktop widths, plus real devices. No page-level horizontal overflow.
- Portrait: stage above a compact control bar; comparison panes may stack. Landscape: panes can sit alongside each other. Provide a clear view toggle; never require rotation to access controls.
- Respect safe-area insets and dynamic viewport height. Essential controls must remain reachable with browser chrome visible. Use at least 44-by-44 CSS-pixel touch targets and visible focus states.
- Keep the learner's feet, calibration indicators, and movement stage clear of persistent controls. Provide an immersive mode with a deliberate way to restore controls.
- Allow reference rotation in avatar/side-by-side inspection. Camera-composite mode uses a defined comparison view; arbitrary display rotation must not change scoring coordinates or silently invalidate alignment.
- Switching views preserves timeline and sections. Recalibrate if camera geometry actually changes. Do not claim room anchoring or occlusion handling.
- Camera, voice, fullscreen, and screen-wake features are capability-detected, with usable fallbacks. Phone-to-TV mirroring is supported as an external device feature, not a custom streaming service.
- Show one unobtrusive similarity cue; hide unreliable/stale scores. Avoid presenting numerical similarity as technique certification.
- Prefer lower render resolution/tracking cadence on constrained devices; bound in-flight camera frames. Test sustained 15-minute sessions, thermal behaviour, rotation, permission denial, and background/resume.

## 7. Upload, conversion, and job reliability

### 7.1 Workflow

Create a private lesson draft → issue an authorised upload → upload to private storage → verify the completed object → inspect/normalise the video → queue conversion → run SAM → export/verify motion → create thumbnail/manifest → creator reviews quality and sections → save/publish a revision.

Use short-lived signed uploads or narrowly scoped multipart sessions. Validate ownership, size, duration, decoded video type, dimensions, and selected range on the server. Do not trust filename extensions or client-reported metadata. Begin with configurable pilot limits, proposed at 120 seconds per conversion and 250 MB per source upload; revise after measuring real phone recordings. Display limits before upload.

Phone videos need orientation, variable-frame-rate, codec, and audio handling. Preserve a source timestamp map if generating a browser-compatible preview. Never concatenate user input into a shell command. Run decoding/conversion with bounded time, memory, and temporary disk; isolate untrusted media from the API process.

### 7.2 Job state and recovery

States: `uploading → validating → queued → processing → exporting → verifying → ready_for_review`, with `failed` and `cancelled` exits. Publication state is independent of processing state. Report stage/frame progress where measured; do not invent a percentage or ETA during model loading or opaque stages.

Workers claim jobs atomically, send heartbeats, and hold an expiring lease with an attempt token. A stale worker cannot finalise a reassigned job. Use one GPU job at a time on the current 8 GB device until profiling supports concurrency. Each attempt gets an isolated directory/object prefix; never mix partial results across retries.

The database is the authority for status. Persist retry counters, error category, model/config provenance, frame count, runtime, and output hashes. Retry transient infrastructure failures with a cap; do not automatically repeat unsupported video or quality failures indefinitely. Cancellation is cooperative and blocks final publication. Cleanup abandoned multipart uploads and temporary assets. Finalisation is idempotent: publish the complete verified manifest/revision once, then clean orphaned attempts later.

Worker credentials are revocable and capability-scoped. A local pilot worker accesses only assigned assets through short-lived URLs and authenticated job endpoints. It does not receive browser sessions or unrestricted database/storage credentials. Bound URL validity to the download/upload step and renew through the worker lease.

### 7.3 Quality and browser-conversion gates

Review source and reconstruction together; identify missing/uncertain frames, unexpected turns, cropping, and foot/root-motion limitations. Verification of GLB export fidelity does not prove correct human reconstruction. Keep quality warnings alongside the review preview.

SAM is the initial production engine. Browser conversion remains an experimental alternative until it produces the common manifest, works with sections/calibration/scoring, passes representative turn/occlusion tests, and demonstrates acceptable mobile stability. Do not silently fall back between engines or imply the procedural mannequin reconstructs the instructor's appearance.

## 8. Delivery phases and acceptance gates

Implement in order. Each phase ends with a runnable demonstration, updated setup notes, relevant verification evidence, known limitations, and a Git checkpoint. Avoid assigning calendar dates before the first infrastructure and GPU portability spike.

### Phase 0 — Contracts, UI prototype, and deployment foundation

Tasks:

1. Capture the accepted MVP behaviour and a small reproducible fixture; keep the current prototype working.
2. Write manifest, section, permission, and job contracts; decide draft/published revision behaviour.
3. Set up the proposed web/API structure, typed API client, lint/type checks, and database migrations.
4. Build a responsive library, review timeline, and practice shell using the existing demonstration. No fake accounts, sales numbers, or invented processing success.
5. Add CPU Docker image, Compose PostgreSQL/storage/mail services, `.env.example`, health endpoints, and Railway configuration.
6. Test the existing pipeline in a Linux CUDA worker image; retain native Windows worker execution until validated.
7. Establish CI for CPU-safe tests and contract fixtures; keep GPU verification a separate explicit check.

Gate: local startup works from documented steps; existing practice remains usable; CPU image deploys as a Railway smoke test; the GPU container result is recorded honestly. Review the content-first mobile screens before expanding features.

### Phase 1 — Accounts, private library, and persistent lessons

Tasks:

1. Add registration, verification, sign-in/out, recovery, secure cookie sessions, and account ownership checks.
2. Persist lessons, revisions, assets, and section sets in PostgreSQL; add private storage access.
3. Import the accepted demonstration through a controlled fixture/import command, without exposing a general untrusted-GLB upload feature.
4. Replace hardcoded reference paths with an authorised manifest loader. Add library, lesson detail, loading/empty/error states.
5. Add versioned section editing with central Save and draft review. Import matching local prototype edits only through an explicit action.
6. Implement deletion/archive rules and revoke access immediately before background media cleanup.

Gate: two accounts cannot access each other's private lessons or assets; a saved lesson and its sections reopen on another device; a deployment/restart does not lose data.

### Phase 2 — Complete reusable practice experience

Tasks:

1. Extract and integrate playback, calibration, tracking, scoring, labels, and composite rendering modules.
2. Implement the shared section playback controller and all command behaviours in section 5.
3. Integrate voice lifecycle, visible buttons, keyboard support, and compact settings.
4. Add responsive comparison modes, reference inspection rotation, resume state, and optional session summaries.
5. Test permissions, stale tracking, section ends, view changes, camera changes, background/resume, and mobile lifecycle cleanup.
6. Calibrate similarity expectations against representative demonstrations and correct/incorrect attempts; label feedback appropriately.

Gate: the imported full rig can be edited into sections and practised using Next/Back/Again/Pause without visual discontinuities or state drift. Verify Android Chrome, iPhone Safari, and desktop browsers on real devices; record voice support separately from basic player support. Validate at least two consecutive sections through end-pose hold, pause/resume, back, replay, and final completion.

### Phase 3 — Self-service upload and reliable conversion

Tasks:

1. Implement the direct upload, source trim, validation, job lifecycle, and processing UI.
2. Wrap existing Python scripts behind a worker interface without changing their accepted numerical behaviour unnecessarily.
3. Add worker registration/leases, scoped HTTPS polling, heartbeat, cancellation, bounded retry, output verification, and cleanup.
4. Integrate motion output into the manifest and review editor. New uploads begin with one whole-animation section, ready to split.
5. Record operational usage independently of billing; enforce configurable account/concurrency/storage limits.
6. Verify both fully local execution and a Railway application using the local GPU worker.

Gate: upload → conversion → section editing → practice works without manual file copying or editing scripts. Disconnect and reconnect the worker during processing; ensure no corrupt lesson or duplicate published revision. Test variable-frame-rate/rotated phone video, invalid files, cancellation, object URL expiry, and long-running jobs.

### Phase 4 — Free publishing and instructor workflow

Tasks:

1. Add unlisted links and invite-only access, invitation acceptance, revocation, and student library entries.
2. Require review completion and a concise content-rights acknowledgement before sharing; keep new uploads private.
3. Add a small student/access screen and aggregate participation summaries with clear privacy boundaries.
4. Add publish/unpublish and new-revision handling without breaking active practice sessions.
5. Surface a user-visible way to report a shared lesson and an operator path to disable access.

Gate: an instructor can prepare a sectioned lesson and distribute it to students; students practise the same published revision; forwarded invite-only links do not bypass account grants. Revocation blocks new media access and manifest requests; already downloaded bytes cannot be recalled, and short-lived URLs have a bounded expiry.

### Phase 5 — Railway pilot and release hardening

Tasks:

1. Separate staging/production data, secrets, and buckets; configure domain/HTTPS and production email.
2. Set deployment migration/readiness gates, worker status monitoring, structured logs, failure alerts, and an operator retry/disable view.
3. Schedule database and object backups to a separate recovery location; perform a restore test. Do not equate bucket durability with a complete backup policy.
4. Add CI deployment checks and a documented application rollback/recovery procedure.
5. Run the mobile matrix, permission/access checks, modest multi-user upload tests, and representative movement-quality evaluation.
6. Publish concise supported-video/device guidance, retention/deletion rules, and an explicit initial audience policy. Do not open child/student data collection without the corresponding guardian/school and privacy decisions.
7. Document whether conversion still depends on the local machine. If reliable unattended conversion is a release requirement, move the worker to a hosted GPU before launch.

Gate: new users can create, section, practise, and share from Railway; worker outages are visible and recoverable; backups restore a usable lesson; regression tests and real-device checks are recorded. Keep the pilot constrained until conversion throughput and quality are understood.

### Phase 6 — AWS migration and migration rehearsal

Tasks:

1. Provision VPC/networking, RDS PostgreSQL, S3, ECR, ECS CPU services, GPU EC2 capacity, HTTPS, IAM, secrets, logs, and backups using infrastructure as code.
2. Deploy the same CPU image and validated CUDA worker image. Use task roles on AWS instead of long-lived bucket credentials.
3. Rehearse database export/import and object copy, checking counts, hashes, manifests, section sets, accounts, sessions, and grants.
4. Retain the same cookie-signing/encryption secrets where appropriate; preserve existing password hashes. Plan DNS/origin changes and reissue signed asset URLs.
5. During cutover: disable new uploads/edits, drain or stop job claims, resolve active leases, take a final database snapshot and object delta, switch traffic, and run access/practice smoke tests.
6. Keep Railway read-only for a defined rollback window. If new writes occur on AWS, rollback requires an explicit reverse-sync/reconciliation procedure; it is not just a DNS reversal.

Gate: an existing user can sign in, open an existing shared lesson, navigate its original sections, resume practice, and create a new conversion on AWS. No broken asset links, ownership changes, or double processing. The local development setup still works after migration.

### Phase 7 — Pricing and commercial distribution, deferred

Use measured conversion, storage, support, and delivery usage to define plans. Separately specify subscription/credit rules and creator sales, then implement payment-provider onboarding, checkout, verified/idempotent webhooks, paid access grants, refund/dispute handling, payout status, and sales reporting. Resolve access duration and creator unpublish/update rules before taking payment. Keep learning repetition free of per-replay metering unless later evidence changes the business model.

After this, consider courses, academy groups, embeds, automatic section suggestions, and richer feedback based on actual learner/instructor demand.

## 9. Proposed repository layout after migration

```text
apps/web/                  React UI and practice integration
apps/api/                  API, identity, lessons, access, jobs
packages/learning-engine/  Playback, sections, pose/scoring, calibration
packages/lesson-schema/    Manifest schemas and small synthetic fixtures
workers/motion/            SAM runner and native/container entry points
workers/maintenance/       Validation, cleanup, operational tasks
scripts/                   Existing experiments and documented compatibility tools
infra/docker/              CPU/GPU Dockerfiles and Compose
infra/railway/             Railway service configuration/runbook
infra/aws/                 Infrastructure as code and migration runbook
tests/                     API, integration, access and end-to-end checks
requirement/               Product requirements and this plan
docs/                      Architecture decisions, device matrix, operations
```

Make directory moves only when imports, setup instructions, and tests move with them. Avoid duplicating two competing implementations of the learning engine.

## 10. Verification and release discipline

- Preserve the current unit tests; add meaningful checks for section contracts, playback commands, schema adapters, and uncertainty handling.
- Add API integration tests for ownership, grants, signed asset authorisation, session recovery, concurrency conflicts, job leasing, and idempotent finalisation.
- Use a small synthetic motion fixture in Git for CPU CI, and a documented opt-in regression run using the real accepted demonstration. Do not make every test depend on untracked model weights or private media.
- Browser end-to-end checks cover create/review/section/save/practise/share with controlled fixtures. They do not replace real camera, microphone, and GPU tests.
- Verify a representative set of turns, kicks, crouches, occlusions, and varied body proportions. Keep reconstruction/export fidelity separate from similarity fairness and learning outcomes.
- Each phase produces an actionable evidence record: environment, device/browser where relevant, expected behaviour, observed result, and unresolved issues. Do not mark an untested feature complete based on a UI mockup.

Suggested product measures: first successful lesson creation, first completed practice, repeat practice, section replays, return rate, sharing acceptance, and conversion failure rate. Operational measures: queue wait, processing seconds per video second, GPU runtime/memory, worker availability, storage/egress, and support incidents. Do not upload camera frames or retain student audio for analytics.

## 11. Immediate implementation order

Start with Phase 0, then deliver the private, saved, section-based practice path in Phases 1–2 before exposing general conversion. Follow with self-service conversion, teaching/sharing, and the hardened Railway pilot. AWS migration is an independent later phase. Pricing remains deferred.

The first reviewable milestone is a local responsive library and lesson review/practice shell using the accepted demonstration, backed by the agreed manifest and section contract, with the existing prototype still available.

## 12. Hosting references checked for this plan

Checked 30 October 2026; recheck capabilities during deployment rather than treating provider behaviour as permanent.

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles): supports custom container builds.
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks): use the supplied port and deployment readiness checks; deployment checks are not continuous uptime monitoring.
- [Railway private S3-compatible buckets](https://docs.railway.com/storage-buckets): use private assets and a portable supported subset; do not depend on provider lifecycle/versioning parity.
- [Railway upload and serving patterns](https://docs.railway.com/storage-buckets/uploading-serving): signed direct uploads/downloads and browser CORS configuration.
- [Railway GPU support discussion](https://station.railway.com/feedback/gpu-support-56d19c42): public discussion does not establish available production GPU capacity; plan external GPU processing.
- [AWS ECS GPU workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html): GPU-enabled EC2 container capacity for SAM workers.
- [AWS Fargate task limitations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html): keep the GPU worker separate from Fargate CPU services.
