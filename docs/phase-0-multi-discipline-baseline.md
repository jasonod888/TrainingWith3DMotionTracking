# Phase 0 multi-discipline baseline

Date: 4 November 2026. Status: **Phase 0 local gate passed, with physical-device and
hosted-service qualification still open.** Prepared alongside revision 2 of the
[multi-discipline plan](multi-discipline-implementation-plan.md).

This record covers P0.1–P0.10. It deliberately does not claim that real-device,
hosted-service, or physical-keyboard qualification has passed; none of those were run.

## Environment

| Item | Value |
| --- | --- |
| OS | Windows, PowerShell |
| Python | 3.12.2 (`.venv-saas`: FastAPI 0.119.1, Pydantic 2.14.2) |
| Node | v22.18.0, npm 10.9.3 |
| Test database | SQLite 3.43.1 via the API test fixtures |
| PostgreSQL | Not started for this record; existing docs describe the local PostgreSQL 17 container |
| ffmpeg | 8.1.1 essentials build |
| GPU | Not used by this record (no model ran) |

## Baseline state (P0.9)

`main` at `182daa1` plus an uncommitted working tree containing the transparent
instructor-video work: 17 modified files and new `InstructorGhost.tsx`,
`StageControls.tsx`, `backfill_instructor_alpha.py`, verification images, and the three
multi-discipline documents.

Disposition: the owner instructed Phase 1 implementation on this working tree, so the
instructor-video changes are part of the agreed baseline for this work. Nothing was
committed, reset, discarded or reformatted. Two consequences are recorded:

- The baseline is **agreed but not yet committed**. For long-term reproducibility the
  owner should commit the instructor-video work (or move it to its own branch). This is
  an open item, not an implementation blocker.
- Changes made by this work are additive and confined to the files listed in the Phase 1
  verification note.

## Suites run (P0.2)

| Command | Baseline result |
| --- | --- |
| `.venv-saas\Scripts\python.exe -m pytest -q` | 206 passed, 13 skipped in 234.57s |
| `npm.cmd --prefix apps/web test` | 198 passed |
| `npm.cmd --prefix apps/web run build` | Built successfully; only the existing >500 kB chunk warning |
| `python -m apps.api.export_lesson_schemas --check` | Did not exist before this work; added in Phase 1 slice 1B |

The 13 skips are pre-existing and unmodified by this work. They belong to the optional
provider/PostgreSQL families that require credentials or a live database; see
`docs/saas-development.md`. No previously failing test was observed.

## Recorded behaviour (P0.1)

Inventory taken from the routers, components and suites in this checkout. It is a
code-level inventory, not a fresh manual browser pass; the movement regression scripts
listed under P0.2 remain the authority for browser behaviour.

| Flow | Where | Baseline behaviour to preserve |
| --- | --- | --- |
| Upload and local trim | `CreateLesson.tsx`, `prepareClip.ts`, `clipCache.ts` | One standalone clip prepared locally at 15 fps with audio discarded; never uploads the source |
| Conversion lifecycle | `conversions.py` | uploading → validating → queued → processing → exporting → verifying → ready_for_review, with cancel, resume and bounded retry |
| Check and accept | `MoveCheck.tsx`, `workflow.py` | Owner review of the exact revision; acceptance is idempotent and revision-bound |
| Preview | `PracticePreview.tsx` | Real/3D instructor choice, Back, resume position |
| Practice and Compete | `LessonWorkspace.tsx` → `PracticeWorkspace.tsx` → `MimicInterface.tsx` | Count-in, repeat, section navigation, four speeds, camera setup, comparison feedback |
| Sharing | `sharing.py`, `ShareLesson.tsx` | Direct grants, invitations, links, groups, public listing; public projection strips private media |
| Recording and paired display | `usePracticeRecording.ts`, `MimicReceiver.tsx` | Video-only takes; timestamped display state on the authoritative device |

## Continuity checklist (P0.3)

A music lesson must not change any of these for body lessons: header and Back; preview
entry; practice toolbar positions; section list; settings panel conventions; count-in and
repeat lifecycle; attempt-review placement; four speed presets; camera/height preferences.
Subject labels appear in the card detail line and in the subject catalogue, not by
renaming movement controls. Internal "lesson" terminology stays in code and docs;
user-facing movement copy keeps "move" where it is today.

## Commercial artifact policy (P0.4–P0.5)

Template and current entries: [commercial artifact inventory](commercial-artifact-inventory.md).
Starting point is official Basic Pitch, per the licensing review. No model, weight file,
or runtime is installed by Phase 0 or Phase 1. Production workers and browser builds read
an allowlist, and an entry without exact identity and commercial terms stays out of it.

## Test material (P0.6)

| Material | Purpose | Rights status |
| --- | --- | --- |
| Simple piano melody | Baseline transcription and MIDI matching | Not yet supplied |
| Simultaneous notes (two and three) | Polyphony and chord spread | Not yet supplied |
| Repeated notes | Re-articulation handling | Not yet supplied |
| Silence and count-in | No false positives during preparation | Not yet supplied |
| Pedal-held notes | Release versus sustain separation | Not yet supplied |
| Beginner guitar single notes | Basic Pitch comparison | Not yet supplied |
| Beginner guitar chords | Chord-class qualification | Not yet supplied |
| Intentional mistakes | Wrong-note detection | Not yet supplied |

Phase 1 needed one internal piano fixture. The import path takes supplied, owned or
licensed media; no public dataset and no unlicensed recording is used. The fixture
currently imported by tests is synthetic (a tiny JSON reference), not a music-accuracy
demonstration.

## Budgets (P0.7)

| Budget | Current value | Note |
| --- | --- | --- |
| Upload size | 250 MB per clip | Shared by body and music; a music clip is audio-bearing, so effective duration may fall |
| Conversion seconds | 300 s | Per clip |
| Active conversions | 2 per account | Account-wide; music does not get a separate pool in Phase 1 |
| Account storage | 2 GiB | Sum of conversion sources and lesson assets; extracted audio, waveform and MIDI count here |
| Music attempts | 5,000 completed attempts per account | Separate from the movement allowance; applies from Phase 6 |
| Body worker host | Existing local CUDA worker (RTX 4060 Laptop, per earlier documentation) | Music worker host not chosen |
| Retention | Temporary attempt outputs cleaned on completion; source media retained privately | Music cleanup must be attempt-bound and bounded |

Audio-bearing assets increase storage consumption per minute relative to silent 15 fps
video. No quota was raised in Phase 1; the budget review must size this before Phase 3
uploads are enabled.

## Audio preparation qualification (P0.8)

Status: **harness delivered, physical-device runs pending.** No browser has been
exercised yet, so no preparation path is qualified.

Harness: `apps/web/spike/music-prepare.html` with `apps/web/spike/music-prepare.ts`.
It is a development page, not part of the app bundle.

```
npm.cmd --prefix apps/web run dev
# then open http://127.0.0.1:5173/spike/music-prepare.html
```

The page reports, for this browser and the installed mediabunny 1.65.0:

- whether the AVC and VP8 video encoders and the AAC and Opus audio encoders exist
  (`canEncodeVideo`, `canEncodeAudio`, plus the encodable codec lists);
- whether `Conversion.init` considers each candidate valid and which tracks it discards;
- after preparing the selected range: output duration, audio sample rate, channel count,
  codec, size, preparation time, and the audio-versus-video first-timestamp offset;
- cancellation, and a playable preview for an audibility check.

Computed verdict per path: audio track present with non-zero sample rate and channel
count, video present, duration within 150 ms of the requested range, start offset within
50 ms, size within the upload limit. The verdict is based on stream facts; audibility
still needs a person to listen.

| Browser / device | MP4 AVC/AAC | WebM VP8/Opus | Notes |
| --- | --- | --- | --- |
| Desktop Chrome (version TBD) | pending | pending | |
| Desktop Edge (version TBD) | pending | pending | |
| Desktop Firefox (version TBD) | pending | pending | |
| Desktop Safari (version TBD) | pending | pending | |
| Android Chrome (device TBD) | pending | pending | |
| iPhone Safari (device TBD) | pending | pending | |

Until this table has results, Phase 3 must not assume either path works. If no path
works on a target browser, the explicit export/import recovery path becomes required
before broad rollout, and the supported-browser list narrows.

## Quality gates ratified (P0.10)

These remain planning targets. They are recorded here so later phases are measured
against an agreed number rather than a retrospective one. Nothing in this table is a
measured product claim.

| Area | Target |
| --- | --- |
| Legacy compatibility | Existing supported body journeys pass; v1 data and processing semantics unchanged |
| MIDI evaluation | Deterministic fixtures match exactly; real-input timing measured separately |
| Reference synchronisation | Within 50 ms absolute A/V/guide error over five-minute clips after offset correction |
| Live response | p95 capture-to-feedback below 250 ms for supported exercises on qualified devices |
| Microphone trust | Under 5% false corrections on assessable correct events with at least 80% required-event coverage |
| Authoring quality | Teacher-approved reference passes validation; editing burden measured and agreed |
| Permission safety | Private video, audio, references and attempts never leak through public or unrelated-account routes |
| Account continuity | One account moves among all enabled subjects without losing access or calibration isolation |
| Commercial artifact coverage | Every shipped model and runtime has documented terms, exact identity and notices |
| Audio preparation | At least one qualified path per target browser, or an accepted recovery path; no silent audio loss |

## Exit gate

- Baseline verification record: this document.
- Product-flow checklist: recorded above, code-level.
- Approved model starting point: Basic Pitch, with no artifact installed.
- Fixture list: recorded; rights still to be supplied.
- Feature-flag design: server route catalogue with music routes disabled by default.
- Audio-preparation spike: harness delivered, device results pending.
- No production flag enabled; no existing lesson rewritten.

Rollback of Phase 0 is discarding these artifacts. Nothing here changes runtime behaviour.
