# Act platform Phase 0 baseline

Status: **evidence record for Phase 0; documentation only.** No application source,
configuration, migration, dependency, or test was changed by this work. The only file
created is this document.

Recorded: 19 November 2026. Baseline commit: `8ea0704e40424c2be6ad0a17a9295fb2f699fad7`
("Add CPU body pipeline, music assessment, and Act architecture plan").

Method: code-level inventory of the checkout, the checked-in production build manifest
(`apps/web/dist/.vite/manifest.json`), and the existing fixtures/tests. There was **no
browser run** in this session. Measurements that require a live server or browser are
marked deferred and have an explicit budget or a named follow-up.

## 0. Session limitation (read this first)

Every attempt to start a shell in this session failed before command execution:
`pwsh -Command` exited `3221225794` (`0xC0000142`, STATUS_DLL_INIT_FAILED) with empty
output, on five separate shell invocations spread across the session (including `echo test`
and `git --version`). Consequences, stated plainly:

- `git status`, `git diff`, and `git ls-files` could **not** be run. The working tree is
  therefore **not** enumerated in this document and must be considered possibly dirty.
  Git facts below come from reading `.git/HEAD`, `.git/refs/heads/main`, and
  `.git/logs/HEAD` directly.
- **No test was executed.** Section 8 lists the exact commands prepared for the focused
  baseline; none of them ran, and none is reported as passing.
- No build, no bundle byte measurement, no runtime profiling, no Playwright check.
- Before Phase 1 begins, run `git status --porcelain=v1` and `git diff --stat` in a
  working shell, record the output in a follow-up note, and preserve every entry.

Nothing here should be read as "clean tree verified". It is not verified.

## 1. Working-tree and runtime inventory

### 1.1 Source version and history

| Item | Value | Source |
| --- | --- | --- |
| Branch | `main` | `.git/HEAD` |
| HEAD | `8ea0704e40424c2be6ad0a17a9295fb2f699fad7` | `.git/refs/heads/main` |
| Head commit subject | "Add CPU body pipeline, music assessment, and Act architecture plan" | `.git/logs/HEAD` last entry |
| Working tree | **unknown / cannot be enumerated** (shell failure) | see §0 |
| Untracked build output present | `apps/web/dist/` with hashed chunks and `.vite/manifest.json` | glob |

The reflog shows the immediately preceding work was guitar notation/practice
(`fc4e33ae`, "Add guitar notation and practice surfaces with shared learner controls"),
followed by the head commit adding the CPU body pipeline, music assessment, and this
plan. The head commit is the only evidence used for "what is already implemented"; the
plan's warning that MediaPipe/feedback/music-assessment/editor work may still be
uncommitted is treated as binding: **do not reset, stash, format, or discard anything.**

### 1.2 Migrations

Alembic; `alembic.ini` points at `apps/api/migrations`; migrations are applied out of
band (`python -m alembic upgrade head`), not at app startup (`apps/api/serve.py`).
There are **25** revisions, linear `0001`→`0025`:

`0001_foundation`, `0002_accounts`, `0003_practice_progress`, `0004_conversion`,
`0005_sharing`, `0006_processing_providers`, `0007_mimic_pairing`,
`0008_mimic_attempts`, `0009_acceptance_publication`, `0010_clip_replacement`,
`0011_groups`, `0012_shared_release`, `0013_platform_admin`,
`0014_silhouette_capability`, `0015_subject_metadata`, `0016_conversion_provenance`,
`0017_media_findings`, `0018_music_drafts`, `0019_music_reviews`,
`0020_music_practice_attempts`, `0021_music_revision_edits`,
`0022_music_verification_decisions`, `0023_music_draft_corrections`,
`0024_piano_model_comparisons`, `0025_music_playback_settings` (head).

Relevant shape: `lessons` holds mutable `subject`/`experience_family`/`instrument`
(`apps/api/database.py:16-18`); `lesson_revisions` holds a frozen snapshot of the same
three (`:36-40`), added and backfilled by `0015_subject_metadata.py:16-27`. There is no
`act` column, table, or type anywhere in `apps/api`.

### 1.3 Feature flags (server-owned; all default off unless stated)

| Setting | Default | Effect |
| --- | --- | --- |
| `body_pipeline` (`BODY_PIPELINE`) | `sam-3d-body` | selects `body-default` vs `body-mediapipe` |
| `conversion_provider` | `local` | body route availability |
| `music_piano_conversion_provider` | `disabled` | piano route availability |
| `music_guitar_conversion_provider` | `disabled` | guitar route availability |
| `music_piano_default_model` | `kong` | picks `music-piano-kong` for new piano uploads |
| `music_remote_conversion_enabled` | `False` | remote music route availability |
| `remote_conversion_enabled` | `False` | remote body route availability |
| `music_midi_setup_enabled` | `False` | advertised only (`/api/capabilities`) |
| `music_history_enabled` | `False` | gates music history routes |
| `music_challenge_enabled` | `False` | gates music challenge routes |
| `music_inference_enabled` | `False` | advertised only |
| `music_piano_library_ui_enabled` / `music_guitar_library_ui_enabled` | `False` | advertised only; consumed only by the unreachable `MusicLessonHome` |
| `music_require_run_profile` | `False` | requires approved run-profile digests |
| `subject_filter_enabled` | `False` | advertised; client hides/shows filter |
| `demo_enabled` | `False` | `/api/demo` and demo import |
| `voice_enabled` | `True` | voice service |
| `camera_calibration_enabled` | `True` | advertised + client policy |
| `hands_model_enabled` | `True` | optional MIDI→hands operation |

`apps/api/config.py:13-80`; advertisement at `apps/api/main.py:106-124`. Note:
`music_midi_setup`, `music_inference`, the two library-UI flags, and `subject_filter`
are **advertisement-only** — they do not gate server routes.

### 1.4 Processing routes

Server-owned registry `ROUTES` in `apps/api/processing_routes.py:60-122`; clients never
name a route, model, or pipeline version.

| Route id | Family / completion | Subjects | Pipeline version | Capability | Required assets | Default |
| --- | --- | --- | --- | --- | --- | --- |
| `body-default` | body / `body-v1` | movement_other, dance, taekwondo, boxing | `sam-3d-body-v1` | `conversion` | reference.glb, reference.json, preview.mp4, thumbnail.jpg | yes (body) |
| `body-mediapipe` | body / `body-v1` | same | `body-mediapipe-v1` | `conversion` | reference.json, preview.mp4, thumbnail.jpg (`local_only`) | only when `BODY_PIPELINE=mediapipe` |
| `music-piano` | music / `music-v2` | piano | `music-piano-v1` | `music_piano` | reference.json | yes |
| `music-piano-kong` | music / `music-v2` | piano | `music-piano-kong-v1` | `music_piano` | reference.json, preview.wav | yes for new piano (`default_model=kong`) |
| `music-guitar` | music / `music-v2` | guitar | `music-guitar-v1` | `music_guitar` | reference.json | yes when enabled |

- Availability is configuration-only (`available()`, `:168-181`); worker presence is a
  separate exact `(provider, pipeline_version)` credential match (`online()`,
  `:184-190`). `create()` checks availability but not `online()`, so a job may queue with
  no worker (`apps/api/conversions.py:210-217`).
- `capability_flags()` returns one key per capability and never one global boolean
  (`:220-226`); it ignores its `online_routes` argument.
- A music route never changes `conversion` availability and vice versa
  (`tests/api/test_lesson_negotiation.py:154,205`).

### 1.5 Application surfaces (architecture map, current state)

| Layer | Current location | Notes |
| --- | --- | --- |
| Shell / routing / navigation | `apps/web/src/LibraryApp.tsx` (240 lines) | 21 page states, query-param "router", all load/dispatch/auth concentrated here |
| Validated lesson boundary | `packages/lesson-schema/parse.ts`, `apps/web/src/lesson-document.ts` | `parseLessonDocument` is the only union dispatch |
| Act dispatch | `apps/web/src/LessonExperienceHost.tsx` | "the only dispatch boundary in the app" |
| Body practice | `LessonWorkspace` → `PracticeWorkspace` → `MimicInterface` | one `Playback` clock |
| Music practice | `PianoWorkspaceHarness` → `PianoPracticeWorkspace` | media-element clock; harness also contains review |
| Shared engine | `packages/learning-engine/` (15 modules) | DOM-free runtime, plan, transport, capabilities |
| API | `apps/api/main.py` + 16 `install_*` routers in one app | single FastAPI app, one DB |
| Processing | `apps/api/processing_routes.py` + independent workers | versioned, provider-scoped |

There is no Act abstraction in either tier. Identity is `subject` + `experience_family`
+ `instrument` + manifest `schema_version`, and the frontend branches on `subject` and
`schema_version`.

## 2. Journey traces from the current code

All line references are the current checkout. "Private release" means an accepted
revision shared by invitation/link/group; "public" means the separate public listing.

### 2.1 Full-body SAM (3D)

1. **Create** — `CreateLesson` (`LibraryApp.tsx:213`). Subject defaults to
   `movement_other`; body subjects come from `limits.subjects`. `prepareClip` is
   dynamically imported, caps 1920 px / 30 fps, strips audio
   (`CreateLesson.tsx:70-71`; `prepareClip.ts:1-19`). `POST /api/conversions` sends
   provider + subject + `feedback_enabled`, never a pipeline version
   (`CreateLesson.tsx:73`).
2. **Process** — `ConversionList` polls `GET /api/conversions` every 5 s
   (`CreateLesson.tsx:108-123`); `ready_for_review` → "Check move" → `open(id,'check')`
   (`:127-129`, `LibraryApp.tsx:193`).
3. **Review** — `MoveCheck` owns a `Playback`, previews source/focused video or the 3D
   GLB from the same frame (`MoveCheck.tsx:13,20-21,53`), frame-accurate trim
   (`:14-16,32-38`), creator feedback toggle (`:19,63`).
4. **Accept / save** — trim → `PUT /lessons/:id/trim`; sections → `PUT
   /lessons/:id/sections`; accept → `POST /workflow/lessons/:id/accept`
   (`MoveCheck.tsx:40-47`; `api.ts:42-43,51-52`). Acceptance is idempotent and bound to
   the exact revision (`apps/api/permissions.py:93-117`).
5. **Correct** — owned body review mounts `SectionEditor` (lazy,
   `LibraryApp.tsx:206`): split, merge, boundary move, rename, feedback
   (`SectionEditor.tsx:62-102,135-136`). Save sends `base_revision_id` and can return
   409 (`LibraryApp.tsx:161-166`). Saving does **not** accept; the feed routes practice
   back through check when needed (`api.ts:53`, `LibraryApp.tsx:152`).
6. **Private release** — `ShareLesson` (Friends / Group / Link), `POST
   /lessons/:id/publish` with `mode:'invite'|'link'`, `keep_current_release:true`
   (`ShareLesson.tsx:30-34,70-101`). Update-shared-version requires
   `accepted_revision_id === lesson.revision_id` (`:69`).
7. **Practice** — `PracticePreview` → `page=practice` → `LessonExperienceHost` returns
   `LessonWorkspace` (`LibraryApp.tsx:197-205`; `LessonExperienceHost.tsx:60`).
   `LessonWorkspace` builds the plan/store, owns one `Playback`, restores progress and
   mounts `PracticeWorkspace` (`LessonWorkspace.tsx:17-22,31-38,54`).
8. **Challenge** — mode selector → `page=compete` → `CompetitionSession.enter()`
   (`PracticeWorkspace.tsx:557-563`; `LibraryApp.tsx:205`). Rules are fixed to full
   sequence, 1×, 5 s preparation, camera scoring (`competition-session.ts:13`); results
   stay in the session (`CompetitionResults.tsx:6`).
9. **History / resume** — server position authority plus local rich fields
   (`practice-store.ts:122-169`); save every 10 s, on pause/visibility/pagehide
   (`LessonWorkspace.tsx:31-38`); attempts are opt-in "Save practice summaries" and
   post `scoring_version:'pose-v1'` (`PracticeWorkspace.tsx:464,708`).

### 2.2 Full-body MediaPipe (video-only)

Identical route and components to §2.1; only the contract and derived UI differ:

1. **Create/process** — server route `body-mediapipe` when `BODY_PIPELINE=mediapipe`
   (`processing_routes.py:71-81,132-134`). The client only reflects
   `limits.body_route.pipeline_version` (`CreateLesson.tsx:10-12,61`).
2. **Reference** — `schema_version` 1, `animation` is **null**, `source_video` required,
   `engine='mediapipe'`, `root_motion='hip-relative'`
   (`apps/api/conversions.py:701-704`; `packages/lesson-schema/parse.ts:234-243`).
3. **Review/correct** — same `MoveCheck`/`SectionEditor`. Both keep the video/3D toggle
   even when no GLB exists; choosing 3D shows "This move is video only"
   (`MoveCheck.tsx:53`; `SectionEditor.tsx:153-159`; `MotionStage.tsx:189`). This is a
   present UI defect, not a future feature.
4. **Practice** — same runtime; `videoOnly=!lesson.animation` hides the 3D/angle controls
   (`PracticeWorkspace.tsx:81-107,539`). Camera scoring reads `mediapipe-33` landmarks
   (`MimicInterface.tsx:329-339`).
5. **Share/public** — private sharing identical; **public listing is refused**: `409
   "This move is video only, so it cannot be published publicly."`
   (`apps/api/public.py:209-210`).
6. **Watch copy defect** — `PracticePreview` says "You can still practise with the 3D
   instructor" when the source video fails (`PracticePreview.tsx:48-53`), which is false
   for a video-only lesson.

### 2.3 Piano

1. **Create** — subject `piano` requires `limits.capabilities.music_piano`;
   `prepareAudioClip` keeps audio (`CreateLesson.tsx:58-71`). `POST /api/conversions`
   adds `subject`, `instrument`, `preparation` (`:65,73`).
2. **Process** — route `music-piano` or `music-piano-kong` (Kong is the configured
   default for new piano uploads); "Review music" → `open(id,'check')` → workflow says
   music → `music-review` (`LibraryApp.tsx:144`; `CreateLesson.tsx:129`).
3. **Review** — `MusicReviewRoute` resolves subject from a saved manifest first, then
   `/music-draft`, and mounts `PianoWorkspaceHarness mode="review"`
   (`MusicReviewRoute.tsx:38-52,71-73`).
4. **Correct** — note pitch/onset/duration, split/merge, hands, alignment anchors,
   notation/score, velocity/pedal, keyboard range, verification decisions
   (`PianoWorkspaceHarness.tsx:23-120,1876-1945`).
5. **Save** — requires `confirmReviewed`; `buildSaveBody` → `POST
   /lessons/:id/music-draft/review` or `POST /lessons/:id/music-revision`; 409 keeps
   local work and offers recovery; success reports "Saved privately · revision …"
   (`PianoWorkspaceHarness.tsx:1877-1938`).
6. **Private release** — `MusicShareLesson`, invitation only; requires the accepted
   revision to equal the reviewed draft revision; `POST /lessons/:id/publish
   mode:'invite'`; "Update shared version" is a separate confirmation
   (`MusicShareLesson.tsx:14-17,44-63,118-126`).
7. **Practice** — mount is `PianoWorkspaceHarness` (lazy) → `PianoPracticeWorkspace`
   (`LessonExperienceHost.tsx:41-53`; `PianoWorkspaceHarness.tsx:220-227`). The
   practice module re-fetches the manifest and reference, verifies SHA-256, builds
   bar-aligned chunks and a `pianoPracticePlan`, and uses the media element as clock
   (`PianoPracticeWorkspace.tsx:137-140,165-228`; `media-transport.ts:4-8`).
8. **Challenge** — only when all host gates pass: server `music_challenge`, creator
   feedback on, `subject==='piano'`, `assessment==='notes'`, MIDI/mic declared
   (`LessonExperienceHost.tsx:42-46`). Whole piece, 1×, reference muted, one global
   offset, overall score withheld (`useMusicChallenge.ts:11-14`; `challenge-payload.ts:25-31`).
9. **History/resume** — local only (`MUSIC_CAPABILITIES.progress='local'`); same
   `form-practice-v2` keys; save every 5 s/pause/pagehide (`useMusicPractice.ts:126-146`).
   Challenge reports are optional via `music_history` into the account panel
   (`PianoPracticeWorkspace.tsx:368-385`; `LibraryApp.tsx:221`).

### 2.4 Guitar

Guitar reuses the piano journey end to end. Differences that are actually implemented:

1. **Create/process** — requires `limits.capabilities.music_guitar`; route
   `music-guitar` (`CreateLesson.tsx:62-64,81`; `processing_routes.py:109-121`).
2. **Review/correct** — same `MusicReviewRoute` → same harness; guitar-specific TAB /
   string-fret editing, chord HUD, tuning/capo and chord authoring
   (`PianoWorkspaceHarness.tsx:582,989-1014,2331-2379,3157-3220`).
3. **Reference** — `schema_version` 2 with `subject/instrument='guitar'`,
   `guitar_chords`, notation `guitar_tuning`/`guitar_capo`, rubric
   `guitar-notes-v1` (`music-feedback.ts:8-12`; `parse.ts:426-501`).
4. **Practice** — same `PianoPracticeWorkspace`; unscored; MIDI/microphone listen &
   play when the rubric matches (`PianoPracticeWorkspace.tsx:687,630-654`).
5. **Challenge — absent.** `LessonExperienceHost` requires `subject==='piano'`,
   `PianoPracticeWorkspace`'s challenge button is piano-gated, challenge MIDI setup is
   piano-gated, and `challengeAttemptPayload` hard-codes `subject:'piano'`
   (`LessonExperienceHost.tsx:43`; `PianoPracticeWorkspace.tsx:308,555`;
   `challenge-payload.ts:14,25`). `MUSIC_CAPABILITIES.challenge` is `'unsupported'`.
6. **History** — local resume only; the only new-route attempt POST is the piano-only
   challenge report, so guitar has no new-route practice/challenge history.
7. **Sharing/public** — invitation-only; public refused (`public.py:204-205`).

## 3. Active vs legacy inventory

Three categories, because the plan requires distinguishing *unreachable* compatibility
code from *mounted duplicate* controllers.

### 3.1 Active entry points

| Path | State | Protected by |
| --- | --- | --- |
| `GET /api/lessons/{id}` + `X-Lesson-Formats` negotiation | active | `tests/api/test_lesson_negotiation.py`, `tests/engine/parse.test.ts` |
| `POST /api/conversions`, worker claim/heartbeat/finish | active | `tests/api/test_conversions.py`, `test_processing_providers.py`, `test_music_conversions.py` |
| `POST /api/workflow/lessons/{id}/accept` | active (body) | `tests/api/test_workflow.py` |
| `POST /api/lessons/{id}/music-draft/review`, `/music-revision` | active (music) | `tests/api/test_music_review.py`, `test_music_edit.py` |
| `PATCH /api/public/lessons/{id}`, `/api/public/*` | active (body only) | `tests/api/test_public.py`, `test_public_pagination.py` |
| `POST /api/lessons/{id}/publish`, `/unpublish`, sharing/invites | active | `tests/api/test_sharing.py`, `test_music_sharing.py`, `test_audience.py` |
| `PracticeRuntime` + `PracticeSession` facade | active (body) | `tests/engine/practice-runtime.test.ts`, `practice-session.test.ts` |
| `PracticeRuntime` via `useMusicPractice` | active (music) | `apps/web/tests/music-practice-runtime.test.tsx`, `practice-contract.test.ts` |
| `PianoWorkspaceHarness` | active for **both** review and practice | `apps/web/tests/workspace-save.test.tsx`, `workspace-piano-integration.test.tsx` |

### 3.2 Compatibility paths that are mounted and reachable

| Path | Why it is compatibility | Still reachable? |
| --- | --- | --- |
| `PracticeSession` (`packages/learning-engine/practice-session.ts:12-17`) | forwards every field/command to `PracticeRuntime`; "owns no rules of its own" | yes, body practice constructs it |
| schema v1 body manifests, `summary_version:1`, `draft_version:1` | older formats kept readable | yes, by design |
| `POST /lessons/{id}/publish` accepting a body revision at publish time | legacy shortcut | yes, body only (`permissions.py:140-142`) |
| `source: 'public'|'demo'` query handling, `loadLesson`/`loadPublicMove` | pre-boundary loaders with no client validation | yes (`LibraryApp.tsx:87-89`; `api.ts:40,87`) |
| `?page=midi-test` entry | standalone MIDI test page | yes, statically imported in `main.tsx:11,16-17` |

### 3.3 Unreachable / dead code that still ships or builds

| Surface | Evidence | Risk |
| --- | --- | --- |
| `MusicLessonHome` / `MusicLessonScreen` | host uses it only when a music document's subject is not piano/guitar (`LessonExperienceHost.tsx:41,55-57`), and the parser accepts only those two (`parse.ts:288`); `MusicLessonScreen` has no call site | legacy music practice engine, MIDI setup and its own history POST (`MusicLessonHome.tsx:333`) are dead — including the only consumer of `midiSetup`, `pianoLibrary`, `guitarLibrary` |
| Legacy guitar review `MusicDraftReview` | `legacyGuitarReview` defaults false and no caller passes it (`MusicReviewRoute.tsx:15,67-69`) | old guitar review form is unreachable |
| `LessonWorkspace` inline review UI | only rendered when `review` is true, but that branch requires `!lessonOwned` while the prop is `page==='review'&&lessonOwned` (`LibraryApp.tsx:205-206`; `LessonWorkspace.tsx:55-68`) | duplicate review implementation |
| `PianoReviewWorkspace`'s `isPractice` branch | harness always passes `mode="review"`; practice dispatches earlier (`PianoWorkspaceHarness.tsx:220-228,245`) | second, older practice UI inside the harness |
| `music-practice.ts` | marked `@deprecated`, "retained only for its historical unit test", no src importer (grep) | test-only legacy controller |
| `web/` prototype | README: "next-phase browser practice prototype now lives in `web/`"; `apps/` is the SaaS app | whole legacy app outside the current runner |
| `apps/web/src/spike/`, `apps/web/src/workspace-harness.tsx` | standalone spike/harness entries (`workspace-harness.html` in the build manifest) | extra entry, not product routes |

### 3.4 Mounted duplicate controllers (not dead — both can run)

- **Two practice compositions**: body (`LessonWorkspace`/`PracticeWorkspace`) and music
  (`PianoWorkspaceHarness`/`PianoPracticeWorkspace`). Both are mounted through the single
  `LessonExperienceHost` boundary, which is the intended seam, but they share no adapter
  contract and duplicate shell concerns.
- **Two "watch" surfaces**: generic `PracticePreview` for every Act, plus camera-off
  body practice that labels itself `WATCH` (`PracticeWorkspace.tsx:573`). Music has no
  notation-aware watch surface.
- **Two manifest loaders**: validated `loadLessonDocument` and unvalidated
  `loadLesson`/`loadPublicMove`/raw `request('/lessons/:id')`. The latter are used by
  share, adjust, and music review/practice (`MusicReviewRoute.tsx:40`;
  `PianoWorkspaceHarness.tsx:1319`).
- **Two identity schemes**: mutable lesson metadata and frozen revision snapshots
  (`database.py:16-18,36-40`), projected by `subject_projection()`
  (`lessons.py:54-77`).

## 4. Required baseline behaviour matrix

"Absent" means not implemented. Nothing in this table describes planned behaviour.

| Capability | Full-body SAM | Full-body MediaPipe | Piano | Guitar |
| --- | --- | --- | --- | --- |
| Processing route | `body-default` (`sam-3d-body-v1`) | `body-mediapipe` (`body-mediapipe-v1`), local-only | `music-piano` / `music-piano-kong` | `music-guitar` |
| Editor tools | `MoveCheck` frame trim + video/3D switch; `SectionEditor` split/merge/boundary/rename | same tools; 3D switch still shown but has no GLB | `PianoWorkspaceHarness`: notes, hands, notation/score, alignment, velocity/pedal, keyboard, verification | same + string/fret, TAB, chords, tuning/capo |
| Review/save rules | accept exact revision via workflow; section edits are new revisions with `base_revision_id`, 409 on conflict; saving does not accept | identical | `confirmReviewed` required; music review/edit endpoints; 409 keeps local recovery; saved-private revision | identical |
| Reference format | `schema_version:1`; GLB `animation` + `landmarks` JSON + `section_set` | `schema_version:1`; `animation:null`, `source_video` required, `mediapipe-33` landmarks | `schema_version:2`; reviewed `reference.json`, `piano-midi-v1` rubric | `schema_version:2`; `reference.json`, `guitar_chords`, notation tuning/capo, `guitar-notes-v1` |
| Source playback | source/focused instructor video + 3D GLB, one `Playback` clock | source video only; 3D controls hidden in practice | instructor video + verified WAV / synthesized instrument, offset-synced; media element is clock | same |
| Practice modes | watch (preview) / practice / challenge | same | watch (generic preview, not notation-aware) / practice / challenge | watch / practice; **challenge absent** |
| Device inputs | camera, microphone (voice), keyboard | same | MIDI, microphone, keyboard; no camera | MIDI, microphone, keyboard; no camera |
| Feedback | live comparison + similarity % and coverage after an attempt; creator switch | same (33-landmark reference) | local matched/missing/extra + timing, unscored; creator switch | same, sounding pitch only |
| Assessment | `pose-v1` approximate similarity, ≥3 samples and ≥60% coverage else no score | same | local note matching; scoring "experimental and withheld" | same, guitar rubric |
| Challenge policy | full sequence, 1×, 5 s preparation, camera scoring, result in-session | same | flags + creator feedback + `notes` + MIDI/mic; whole piece, 1×, score withheld; optional report | **not available** |
| Progress location | server `GET/PUT /lessons/{id}/progress` + local rich fields | same | local only (`form-practice-v2:*`) | local only |
| Private sharing | invite / link / group | same | invitation only | invitation only |
| Public eligibility | accepted revision + non-null `animation` + rights + title + creator + ≥1 tag | **refused** (`409` video-only) | **refused** (`409` music is invitation-only) | **refused** |
| Fallback behaviour | camera-off instructor-only practice; no camera required for watch | 3D toggle yields "video only" message; preview copy wrongly promises 3D | music deep links only for preview/practice/compete; review links require owner | same |

Cross-cutting facts worth stating separately:

- **Publication** is decided server-side. Listing requires an exact acceptance row
  (`public.py:202-203`), `schema_version==1` (`:204-205`), non-null `animation`
  (`:209-210`), rights acknowledgement, title, creator (no `@`), 1–8 tags
  (`:211-221`). Public reads re-check listed/not-hidden/published/accepted/schema-1
  (`permissions.py:162-175`) and strip `source_video`, `focused_video`, `thumbnail`,
  `presentation.report` (`permissions.py:184-194`).
- **Music release** is stricter: acceptance must come from `music-review`, by the owner,
  on the latest revision, with `reference_reviewed`
  (`permissions.py:127-136`).
- **Capability representation is ad hoc**: `PracticeCapabilities` already models
  `challenge/camera/recording/scoring/voice/progress/history/seek/sections/repeat/...`
  (`practice-capabilities.ts:28-53`) with `supported|unsupported` and
  `enabled/off/reason` states (`:8-18`), but there is no `canEdit/canReview/canPractice/
  canChallenge/canAssess/canRecord/canPublishPublicly` result and no reason codes.
- **"Non-movement means music"** assumptions survive in the client: the
  `experience_family === 'music'` branch in `CreateLesson.tsx:59`, feed labels
  ("Preview only", "3D movement"), and `PracticePreview` body-shaped props.
- **Public responses are body-shaped**: `PublicDetailPage` constructs a body `Playback`
  and `MotionStage` (`Public.tsx:45,53`).

## 5. Measurements and explicit performance budgets

### 5.1 Measured now (no build, no server)

| Measurement | Result | How obtained |
| --- | --- | --- |
| Page states in the shell | 21 | `LibraryApp.tsx:33` |
| Distinct processing routes | 5 (2 body, 2 piano, 1 guitar) | `processing_routes.py:60-122` |
| Alembic revisions | 25, head `0025` | `apps/api/migrations/versions/` |
| Code-split entries in the production manifest | 20 dynamic entries + 3 HTML entries | `apps/web/dist/.vite/manifest.json` |
| Manifest loads per music practice entry | **2+** (`/lessons/:id` in the shell/restore path and again in `PianoPracticeWorkspace`) | `LibraryApp.tsx:91`; `PianoPracticeWorkspace.tsx:165` |
| Manifest loads per music review entry | **2** (`MusicReviewRoute.tsx:40` then `PianoWorkspaceHarness.tsx:1319`) | code |
| Reference asset loads per music practice entry | 1 JSON (+1 WAV/video) after a fresh manifest fetch | `PianoPracticeWorkspace.tsx:165-177` |
| Editor code in the practice dependency path | **yes** — practice and review share one chunk (`PianoWorkspaceHarness-CK2xaMeU.js` imports `_FeedbackChoice`, `_codec`, `GuitarNeckGuide`; `MusicReviewRoute` imports that chunk) | `dist/.vite/manifest.json:37-53,354-373` |
| Practice runtime unit tests | 16 scenarios in `practice-runtime.test.ts`; 7 capability/parity tests in `practice-contract.test.ts` | test files |

Build manifest is a **checked-in artifact** and may postdate or predate `src`; it is used
for structure, not for byte claims.

### 5.2 Documented historical byte measurements (not re-measured here)

These come from prior verification records and are the only byte evidence available:

| Metric | Value | Source |
| --- | --- | --- |
| Initial JS/CSS gzip | 128,921 B (vs 126,758 B at a prior checkpoint) | `docs/music-review-finalisation.md:97` |
| Initial entry (older measurement) | ~306 kB raw / ~94 kB gzip; 3D viewer separate | `docs/workflow-implementation.md:24` |
| Initial library JS (earlier) | ~77 kB gzip; renderer ~155 kB gzip | `docs/phase-0-verification.md:44` |
| `MusicLessonEditor` lazy chunk | 77.84 kB raw / 24.41 kB gzip | `docs/music-notation-verification.md:36` |
| Shared React closure | 69.06 kB gzip | `docs/music-ui-library-spike.md:59` |
| Fretboard manual chunk | 15.78 kB gzip | `docs/music-ui-library-spike.md:57` |
| svguitar + deps | 69.93 kB gzip | `docs/music-ui-library-spike.md:58` |
| Existing build warning | one chunk >500 kB | `docs/phase-0-multi-discipline-baseline.md:45` |
| Existing screen budgets | 16 KiB initial-growth allowance; 25 KiB per-instrument closure | `docs/multi-discipline-phase-2.md:304-305`; `docs/music-ui-library-verification.md:69-70` |

### 5.3 Proposed budgets (numeric, derived from the above)

Target device profile (unchanged from prior records): Windows desktop Chromium on the
RTX 4060 laptop as the reference, mid-range Android Chrome and iPhone Safari as the
supported mobile floor. No emulated "slow 3G"; network shaping is applied at the CDP
level in the deferred live measurement.

| Budget | Ceiling | Basis | Status |
| --- | --- | --- | --- |
| Shell initial JS+CSS gzip | **≤ 145 KiB** (current documented 125.9 KiB + ≤ 16 KiB growth) | 128,921 B + 16 KiB allowance | provisional; verify on next build |
| Music practice static closure added per instrument | **≤ 25 KiB gzip** | existing per-instrument cap | inherited, unchanged |
| Editor-only chunks reachable from practice entry | **0** | current state violates this (one shared harness chunk) | Phase 2 exit criterion |
| Manifest requests per lesson open (practice or review) | **1** (plus 1 permission/release revalidation) | current 2+ | Phase 2 exit criterion |
| Reference asset requests per practice open | **1** JSON (+1 media) | current 1 JSON but after a redundant manifest fetch | Phase 2 exit criterion |
| Practice entry JS chunks | **≤ 2** (adapter + practice shell), no review chunk | current 1 chunk containing both | Phase 2 exit criterion |
| Time from practice URL to first interactive controls (desktop, warm cache) | **≤ 1,500 ms p95** | provisional; must be measured live | deferred |
| Same on mid-range Android, cold cache | **≤ 3,500 ms p95** | provisional | deferred |
| Stage frame time during body practice | **≤ 16.7 ms p95**, no long task > 50 ms | 60 fps target | deferred |
| React commit cost on mode/section switch | **≤ 8 ms p95** | provisional | deferred |
| Memory growth after 20 Act/mode switches | **≤ 10%** retained heap, 0 live camera/audio/worker handles | provisional | deferred |
| Route/manifest requests per feed load (small library, <20 lessons) | **≤ 6** | current shell fires demo + library + shared + workflow + capabilities + assets | deferred |

Every "provisional" number is a ceiling to test against, **not a measurement**. The
Phase 0 exit criterion "exact numbers recorded" is met only for counts and structural
facts; byte and timing budgets require the live-server step in §8.3 and must be updated
with real values before Phase 1 closes.

## 6. Compatibility fixtures inventory

### 6.1 `packages/lesson-schema/`

No test files live inside the package. Fixtures:

| Fixture | Shape | Consumed by |
| --- | --- | --- |
| `fixture.json` + `synthetic.glb` + `synthetic-landmarks.json` | body v1, synthetic GLB, 2 s, 2 sections | `tests/engine/parse.test.ts`, `tests/engine/playback.test.ts`, `tests/api/test_foundation.py` |
| `fixtures/music-v2.json` | piano music v2, reviewed, `piano-midi-v1`, notes | `tests/engine/parse.test.ts`, `tests/api/test_music_contract.py` |
| `fixtures/lesson-summary.json` | music summary v1 (piano) | `tests/engine/parse.test.ts`, `tests/api/test_music_contract.py` |
| `fixtures/invalid/music-v2-missing-subject.json` | missing subject | contract tests |
| `fixtures/invalid/music-v2-sparse-sections.json` | section gap | contract tests |
| `fixtures/invalid/music-v2-body-fields.json` | body fields smuggled into music | contract tests |
| `fixtures/invalid/music-v2-unreviewed.json` | `reference_reviewed:false` | contract tests |
| `fixtures/music-corpus/index.json` | 6 authored-synthetic symbolic cases with expected match counts | `tests/music-engine/*`, API model qualification |
| `.../piano-scale`, `repeated-attacks`, `piano-chord`, `optional-note`, `silence` | piano reference/proposal pairs | music-engine + qualification |
| `.../guitar-open-strings` | guitar reference/proposal (E2/A2/D3, 3 s) | guitar tests |

Gaps: **no static MediaPipe/video-only manifest fixture** (synthesised inline in
`tests/engine/parse.test.ts:242-250`, `tests/api/test_mediapipe_pipeline.py:47-63`,
`apps/web/tests/workspace-video-only.test.tsx:29-45`); **no static guitar manifest**
(derived from `music-v2.json` by `tests/api/support_multi.py:17-22`); **no body summary
fixture** (inline); **no release/publication JSON fixture anywhere** (releases are built
through DB rows).

### 6.2 `packages/learning-engine/`

15 modules, no in-package tests. Protected by:

| Contract | Test file |
| --- | --- |
| `PracticeRuntime` state machine, buffering, repetitions, plan remap, destroy | `tests/engine/practice-runtime.test.ts` (16) |
| `PracticeSession` facade compatibility | `tests/engine/practice-session.test.ts` (8) |
| `PracticePlan` identity/reconciliation | `apps/web/tests/practice-store.test.ts`, `practice-contract.test.ts` |
| `practice-capabilities` (body/music parity, challenge unsupported for music) | `apps/web/tests/practice-contract.test.ts` (7) |
| `CompetitionSession` | `tests/engine/competition-session.test.ts` |
| `AttemptFeedback` evidence thresholds | `tests/engine/attempt-feedback.test.ts` |
| `Playback` + section contract | `tests/engine/playback.test.ts` |

Untested directly: `playback-transport.ts`, `experience-mode.ts` (covered indirectly
only).

### 6.3 `apps/api/` and `tests/`

| Area | Protecting tests |
| --- | --- |
| Schema/contracts | `test_music_contract.py`, `test_schema_artifacts.py`, `test_foundation.py`, `test_client_contract.py` |
| Subject identity | `test_subjects.py` (catalogue, relabel, frozen published label) |
| Format negotiation | `test_lesson_negotiation.py` (body-only library, v1 refusal, music never public) |
| Body pipeline | `test_mediapipe_pipeline.py` (route, worker scoping, video-only, publish refusal) |
| Music pipeline | `test_music_conversions.py`, `test_music_kong_adapter.py`, `test_music_media_validation.py`, `test_music_worker.py` |
| Acceptance/release | `test_workflow.py`, `test_acceptance_shortcuts.py`, `test_music_sharing.py`, `test_public.py` |
| Audience | `test_audience.py`, `test_sharing.py`, `test_groups.py` |
| Music review/edit | `test_music_review.py`, `test_music_edit.py`, `test_music_verification.py`, `test_universal_feedback.py` |
| Guitar | `test_guitar_tab_solver.py` (13), `apps/web/tests/guitar-notation.test.mjs` (18), `guitar-surfaces.test.tsx` (10) |
| Practice/capabilities | `tests/engine/*`, `apps/web/tests/practice-*.test.*`, `body-practice-route.test.tsx`, `music-practice-runtime.test.tsx` |

Current runner inventory (on disk): 105 files — 12 engine, 10 music-engine, 39 `.mjs`,
6 `.ts`, 38 `.tsx`. `--focused` selects 17 workspace/shared-timeline/formatted files and
**does not** include `practice-*.test.*`. `docs/frontend-test-workflow.md:83-104` is
stale (claims 78 files / 16 focused); do not cite its counts.

## 7. Phase 1 + Phase 2 vertical slice plan

Design rule for both phases: additive metadata and adapters; never rewrite stored
revisions or infer Act from `schema_version`, GLB presence, title, or filename.

### 7.1 Phase 1 — Act identity, server descriptors, layered capabilities

New files:

- `apps/api/acts.py` — `ActId = Literal['full_body','piano','guitar']`; `ACT_VERSION=1`;
  frozen descriptors: label, permitted subjects, creation inputs, enabled route ids,
  editor/review flags, practice inputs/modes, assessment adapter versions, permitted
  publication representations. `SUBJECT_TO_ACT = {dance|taekwondo|boxing|movement_other:
  full_body, piano: piano, guitar: guitar}`. Unknown subject → `ActError`, never a body
  fallback.
- `apps/api/migrations/versions/0026_act_identity.py` — additive nullable `lessons.act_id`
  and `lesson_revisions.act_id`; bounded backfill from the frozen snapshot; no JSON
  mutation.
- `packages/learning-engine/act-capabilities.ts` — `CapabilityResult {support:
  'supported'|'unsupported'|'unavailable', enabled, reasonCode, explanation}` and
  `resolveCapabilities({actSupport, assets, creatorPolicy, learnerChoice, device,
  audience, deploymentFlag})` returning explicit `canEdit/canReview/canPractice/
  canChallenge/canAssess/canRecord/canPublishPublicly`. Stored preferences stay separate
  from availability.

Modified files:

- `apps/api/subjects.py` — add `act_id` to `catalogue()` entries; keep canonical
  subject ids and instrument fields unchanged.
- `apps/api/processing_routes.py` — add `act_id` to `ProcessingRoute` (derived from
  subjects) and to `status()`/`public_catalogue()`; route ids unchanged.
- `apps/api/lessons.py` — `act_for(subject, family, schema_version)` deterministic
  adapter; include `act` only in the negotiated **outer** summary/detail envelope
  (`summary_version: 2`), leaving the v1 manifest bytes and reference hashes untouched.
- `apps/api/main.py` — `/api/capabilities` gains `act_descriptor_version` and `acts`
  descriptors; invalid version returns `unsupported_act`, not body.
- `apps/api/contracts.py` — `LessonSummaryV2` with `act_id`, `capabilities` (the seven
  booleans + reasons), keeping `LessonSummaryV1` for old clients.
- `apps/api/permissions.py` — publication gate reads `act.publication` policy instead
  of only `schema_version==1`, but the stricter existing checks remain until Phase 5.
- `apps/web/src/acts/registry.ts` (new) — static `{full_body, piano, guitar}` map of
  lazy loaders; the server never returns module paths.

Tests: act mapping for every subject, unknown subject/descriptor version, v1 summary
still parsed, capability matrix for absent assets/creator-off/learner-off/no device/
offline worker/unsupported Act, and unchanged reference hashes and releases.

### 7.2 Phase 2 slice — open a reviewed guitar lesson, practise, return

Goal: guitar practice must not import the review editor, and the feed must describe
capabilities accurately on return.

New files:

- `apps/web/src/app/lesson-context.ts` — `LessonContext {lessonId, revisionId, actId,
  audience, capabilities, document}`; built once by the extended
  `loadLessonDocument()` and passed down; `rev`/`audience` in the cache key.
- `apps/web/src/acts/guitar/practice-adapter.ts` — builds the practice plan, transport,
  stage and input prep for guitar; no review imports.

Modified files:

- `apps/web/src/lesson-document.ts` — return the context; add a small identity-keyed
  cache with release revalidation; keep `parseLessonDocument` as the only validator.
- `apps/web/src/LessonExperienceHost.tsx` — dispatch on `actId`, not `subject`; for
  guitar practice `lazy(() => import('./acts/guitar/PracticeEntry'))`; do **not** import
  `PianoWorkspaceHarness` on the practice path.
- `apps/web/src/LibraryApp.tsx` — pass the loaded context into preview/practice instead
  of re-fetching by id; keep `source=public|demo` compatibility branches.
- `apps/web/src/music/workspace/PianoWorkspaceHarness.tsx` — split the practice
  implementation out of the review module behind a re-export shim so existing imports
  keep working; behaviour and payloads unchanged.
- `apps/web/src/PracticePreview.tsx` — read capabilities rather than assuming body/3D.
- `apps/web/src/FeedCard.tsx` / `PracticeFeed.tsx` — label from `actId` + capabilities
  ("Practise", "Watch only", "Challenge unavailable — guitar"), not "Preview only"/"3D".

Slice exit checks: practice network log contains one manifest + one reference, zero
review-editor chunks; review route still saves a revised guitar reference with chords,
tuning and TAB unchanged; direct link/refresh/back works; returning to the feed shows
guitar-specific actions; full-body SAM, MediaPipe and piano journeys unchanged;
`music-practice-runtime.test.tsx`, `guitar-notation.test.mjs`, `workspace-save.test.tsx`
and `practice-contract.test.ts` pass.

## 8. Checks: what was run, what was not

### 8.1 Executed

| Command | Exit code | Result |
| --- | --- | --- |
| `pwsh -Command "Write-Output hello; Get-Location"` | `3221225794` | no output; process failed at DLL init |
| `pwsh -Command "echo test"` | `3221225794` | same |
| `pwsh -Command "git status"` / `"git --version"` | `3221225794` | same |
| `pwsh -Command "$PSVersionTable..."` (with workdir) | `3221225794` | same |

No application test, build, or check was executed. No test is claimed as passing.

### 8.2 Prepared focused baseline (NOT RUN — for the follow-up session)

```powershell
# API contracts, identity, publication, guitar solver (fast, SQLite-backed)
.venv-saas\Scripts\python.exe -m pytest -q `
  tests/api/test_subjects.py tests/api/test_lesson_negotiation.py `
  tests/api/test_music_contract.py tests/api/test_public.py `
  tests/api/test_mediapipe_pipeline.py tests/api/test_guitar_tab_solver.py

# Shared runtime + capability parity + guitar notation (bounded)
cd apps/web
npm test -- --file tests/practice-contract.test.ts --file tests/practice-store.test.ts
npm test -- --file tests/guitar-notation.test.mjs --file tests/music-practice-runtime.test.tsx
```

Exclude (slow/heavy, per §6.3 and the runner notes): `test_real_transcription_journey.py`,
`test_music_model_qualification.py`, `test_music_worker.py`, `test_music_media_validation.py`,
all `tests/infrastructure/*` (need `FORM_TEST_LOCAL_SERVICES=1`), the 38 JSDOM workspace
journeys, and any Playwright `scripts/verify_*.py`.

### 8.3 Deferred live measurements (named)

1. Production build: `npm.cmd --prefix apps/web run build`; record per-chunk raw/gzip,
   confirm no review chunk in the guitar practice graph.
2. CDP network trace for feed → guitar lesson → practice → feed: counts and bytes of
   manifest/reference/media, plus which chunks load.
3. Frame/commit/memory profile on desktop Chromium and one mid-range Android device.
4. Route/DB query counts for feed and workflow at 20 and 200 lessons.

## 9. Phase 0 acceptance and open items

| Deliverable | State |
| --- | --- |
| Working-tree/runtime inventory | **partial** — runtime, routes, flags, migrations complete; `git status` unavailable |
| Journey traces for four Acts | **done**, code-cited |
| Active vs legacy inventory | **done**, distinguishes reachable compatibility from unreachable code |
| Baseline behaviour matrix | **done**, missing capabilities marked absent |
| Measurements + numeric budgets | **partial** — structural counts measured; byte/timing budgets provisional and named as deferred |
| Compatibility fixtures inventory | **done**, including named gaps |
| Phase 1 + Phase 2 slice plan | **done** |

Open items before Phase 1:

1. Capture and preserve `git status --porcelain=v1` / `git diff --stat`.
2. Run §8.2 and record real exit codes/counts; replace provisional budgets in §5.3
   with measured values after §8.3.
3. Decide the summary negotiation (`summary_version: 2`) with the Python/TypeScript
   schema regeneration and fixtures in the same change.
4. Do not remove the `MusicLessonHome`, `MusicDraftReview`, `music-practice.ts`, or
   inline-review branches until Phase 7 proves them unused; they are listed here so the
   later cleanup has a reference point.
