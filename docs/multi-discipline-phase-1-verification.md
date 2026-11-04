# Multi-discipline Phase 1 verification record

Revision 2, 4 November 2026. Status: **Phase 1 slices 1A–1I implemented, seven review
findings fixed, evidenced locally.** This record belongs to the
[multi-discipline plan](multi-discipline-implementation-plan.md);
`docs/phase-1-verification.md` is the unrelated SaaS-plan record and was not modified.

Enabled flags: **none.** `music_piano_conversion_provider` and
`music_guitar_conversion_provider` both default to `disabled`, so the music routes are
registered and reported but cannot create work. Nothing is exposed to learners.

## Slices delivered

### 1A Subject catalogue and additive lesson metadata

- `apps/api/subjects.py` — one catalogue: ids, labels, families, instruments, selection
  validation. `movement_other` maps to **Full Body Movement**; no title/tag inference.
- Migration `0015_subject_metadata.py` adds `subject`, `experience_family`, `instrument`
  to `lessons` and frozen snapshots to `lesson_revisions`, plus `ix_lessons_subject`.
  It backfills every pre-subject revision to `movement_other`/`body`, so a released
  revision can never inherit a later relabel through the lesson row.
- `database_ready()` probes the new lesson, revision and conversion columns.
- `PATCH /api/lessons/{id}/subject` is **metadata only**: it updates the lesson record
  and creates no revision, so practice progress, acceptance and the published pointer
  survive a relabel. Readers keep the label frozen on the revision they may read; the
  owner's views read the current draft label. Publishing is the act that adopts the
  current label on the released revision.
- A relabel can only stay inside the discipline and instrument the lesson already has.
  Movement↔music and piano↔guitar need new content, because the stored reference has no
  assets for them.
- `GET /api/workflow/lessons` carries `subject`, `subject_label`, `experience_family`
  and `instrument` additively; cards show the label in the existing detail line.

Evidence: `tests/api/test_subjects.py` (8 tests).

### 1B Schema artifacts, generation command, drift checks

- `apps/api/export_lesson_schemas.py` generates three artifacts and supports `--check`.
- `manifest.schema.json` regenerates byte-identically; `music-manifest.schema.json` and
  `lesson-boundary.schema.json` are new.
- `tests/api/test_schema_artifacts.py` replaces the single-model drift assertion with
  per-artifact checks and proves each artifact is reported independently.

Evidence: `python -m apps.api.export_lesson_schemas --check` → `3 schema artifacts are current`.

### 1C Music manifest v2

- `MusicLessonManifest`, `InstrumentConfig`, `AssessmentPolicy` in `apps/api/contracts.py`.
- `schema_version: 2`, `experience_family: music`, contiguous teaching sections covering
  the whole lesson, reviewed reference required, no body fields, extras forbidden.
- Positive and four negative fixtures under `packages/lesson-schema/fixtures/`.
- TypeScript projection `MusicLessonManifest` in `packages/lesson-schema/index.ts`.

Evidence: `tests/api/test_music_contract.py`.

### 1D Runtime readers

- `packages/lesson-schema/parse.ts`: `parseLessonManifest`, `parseMusicLessonManifest`,
  `parseLessonSummary`, `parseLessonDocument`, returning typed values or structured
  `{code, message}` failures. No new bundle dependency.
- **Strict as the server contract:** unknown fields, missing required fields, unsafe asset
  keys, wrong media types, out-of-range duration/frame-rate/standing-time, non-image
  posters and inconsistent assessment policies are refused. A v2 payload given to the
  body reader returns `unsupported_format`, never a cast.

Evidence: `tests/engine/parse.test.ts` (16 tests).

### 1E Negotiation, summaries, capability and route responses

- `X-Lesson-Formats` header; an unversioned client is v1-only.
- `GET /api/lessons` **and** `GET /api/shared-lessons` stay body-shaped and exclude music
  lessons; `visible_manifest` also refuses a v2 object, so paired display or any other
  body-shaped caller cannot receive one by accident.
- New `GET /api/lessons/summaries` and `GET /api/shared-lessons/summaries` return
  `LessonSummary` values filtered by advertised formats.
- A v1-only client asking for a music lesson receives **406** with
  `X-Lesson-Format-Required: 2` and refresh guidance.
- `apps/api/processing_routes.py` is the route catalogue (body default, piano, guitar)
  with **per-instrument provider, target and kill switch**. Availability is reported per
  capability in `/api/capabilities` and `/api/conversions/limits`.

Evidence: `tests/api/test_lesson_negotiation.py` (12 tests).

### 1F Music route registration and completion binding

- `NewConversion` gains optional `subject`, `instrument`, `preparation`; the server
  derives the route, so the body route remains the default for old clients.
- `preparation` records version and client-reported selection offsets; the uploaded clip
  stays authoritative and `start` must remain zero.
- `finish` dispatches on the leased job's pipeline. The music completion validates
  `MusicLessonManifest` **and** binds it to the job: subject, instrument and clip duration
  must match what the server requested. The body completion now carries the job's subject
  into the lesson row and revision snapshot instead of resetting it to the default.
- Account-wide limits unchanged; no new quota was introduced.

Evidence: `tests/api/test_music_conversions.py` (10 tests).

### 1G Internal music fixture import

- `import_music_fixture()` and `scripts/import_music_fixture.py`: operator-only,
  validate-before-write, checksums verified, no HTTP path, no worker, no model.
- Imported fixtures are not publicly listable; publishing music remains guarded.

Evidence: covered by `tests/api/test_lesson_negotiation.py` and
`tests/api/test_acceptance_shortcuts.py`.

### 1H LessonExperienceHost before body controller initialisation

- `apps/web/src/LessonExperienceHost.tsx` wraps `LessonWorkspace` at the call site, so a
  music lesson never constructs `Playback`, never starts the progress saver and never
  mounts the body controller.
- `apps/web/src/music/MusicLessonHome.tsx` + `music.css` render an approved music
  manifest only; no camera, microphone or MIDI permission is requested.
- `apps/web/src/lesson-document.ts` loads through the validated boundary with the format
  header; a music deep link on a v1 build surfaces the recoverable server message.

Evidence: `npx tsc --noEmit` clean, production build clean. Browser regression scripts
were not run (see below).

### 1I Acceptance-shortcut guardrails

- `accept_revision` refuses a v2 revision unless the source is `music-review`.
- `ensure_release` (publish) returns a specific "needs a reviewed reference" conflict.
- The frame-based trim refuses music before `accept` is considered.
- Body behaviour is unchanged: publish and trim-with-accept still record acceptance.

Evidence: `tests/api/test_acceptance_shortcuts.py`.

## Review follow-up: seven findings

| # | Finding | Root cause | Fix and coverage |
| --- | --- | --- | --- |
| 1 | Subject changes could break an existing movement lesson | Relabelling minted a revision, which dropped saved progress and forced the owner back through check/accept | Relabel is metadata-only; the revision, acceptance and progress are untouched. `test_relabelling_is_metadata_only` |
| 2 | A published revision could inherit an unpublished subject change | Revisions created by editing carried no snapshot, so the projection fell back to the mutable lesson row | Migration backfills all pre-subject revisions; every new revision writes a snapshot; publishing adopts the current label. `test_published_label_is_frozen_until_the_owner_publishes`, `test_editing_after_a_relabel_does_not_change_the_published_label`, `test_a_recipient_keeps_the_released_label_until_the_owner_publishes` |
| 3 | The legacy shared library still returned music manifests | `/shared-lessons` did not filter family, and `visible_manifest` had no v2 guard | The list filters to body; `visible_manifest` refuses v2. `test_shared_library_never_returns_a_music_manifest` |
| 4 | Music completion was not bound to the requested instrument or duration | The completion validated the v2 shape but not the job | Subject, instrument and duration are checked against the leased job. `test_music_completion_is_bound_to_the_requested_subject` |
| 5 | Body conversion discarded the selected subject | Completion created the lesson without the job's subject | The job's subject and family are written to the lesson and the revision snapshot. `test_body_conversion_keeps_the_selected_subject` |
| 6 | Runtime readers accepted malformed contracts | Validators checked a subset and then cast | Required fields, unknown fields, asset key safety, media types and value ranges are enforced. Six new cases in `tests/engine/parse.test.ts` |
| 7 | Piano and guitar could not be enabled independently | Both music routes read one provider setting | Per-instrument provider, target and kill switch. `test_piano_and_guitar_are_enabled_independently`, `test_piano_can_be_enabled_while_guitar_stays_off` |

## Commands and results

| Command | Result |
| --- | --- |
| `.venv-saas\Scripts\python.exe -m pytest -q` | **255 passed, 13 skipped** in 250s (baseline 206/13; +49 new) |
| `npm.cmd --prefix apps/web test` | **219 passed** (baseline 198; +21 new) |
| `npx tsc --noEmit` (apps/web) | Clean |
| `npm.cmd --prefix apps/web run build` | Built successfully; existing >500 kB chunk warning only |
| `python -m apps.api.export_lesson_schemas --check` | 3 artifacts current |
| `python -m alembic upgrade head --sql` | Renders 0015 (with backfill) and 0016 cleanly |
| Spike harness type check | `tsc --noEmit … spike/music-prepare.ts` clean |

## Not run (explicit)

| Item | Why | Consequence |
| --- | --- | --- |
| `scripts/verify_practice_flow.py`, `verify_practice_preview.py`, `verify_practice_feed.py`, `verify_compete_flow.py` | Playwright is not installed in either virtual environment, and no Vite/API stack was started | Movement browser behaviour is not re-proved here. The body render path is unchanged and suites pass, but run these before treating 1H as signed off. |
| Real PostgreSQL upgrade of 0015/0016 | No PostgreSQL instance was started; only offline SQL was rendered | P1.8 remains open. The backfill statement is rendered but not executed against legacy rows. |
| Physical devices, MIDI, microphone | Out of Phase 1 scope | Phase 0 audio spike table still pending |
| Visual review of the music screen in a browser | No browser automation available | Type-checked and built, not visually inspected |

## Rollback

Every change is additive. Rollback is: disable the music routes (already the default),
ship the previous build, and leave the additive columns and tables in place. No lesson
manifest was rewritten and no publication pointer moved.

## Baseline note

The instructor-video work in the working tree is part of the agreed baseline for this
record (owner instruction, 4 November 2026). It is still uncommitted, and this work does
not commit it. `apps/web/src/practice.css` and `docs/practice-and-compete.md` were already
modified by that work and were not touched here.

## Remaining blockers after Phase 1

| ID | Status |
| --- | --- |
| B1 baseline reproducibility | **Agreed, not committed.** Owner should commit or branch the instructor-video work before Phase 2 lands on the same files. |
| B2 audio preparation matrix | Open. Harness delivered; device runs pending. |
| B3 fixture media rights | Open. Phase 1 fixture is synthetic; real fixture media still needed. |
| B4 music attempt event bound | Open, blocks Phase 6 persistence. |
| B5 public preview rights | Open, blocks Phase 5 public derivative. |
| B6 commercial inventory | Template delivered; no artifact installed. |
| B7 physical MIDI qualification | Open, blocks Phase 6 pilot. |
| B8 audio storage budget | Partly addressed (account-wide limits kept, no raise); sizing still open. |
