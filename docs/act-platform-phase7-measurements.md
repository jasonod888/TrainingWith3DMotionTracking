# Act platform Phase 7 measurements

Status: measured optimization record. Documentation only; no application behavior was
changed by this file.

## 1. Bundle and chunk measurements

Phase 7 repeated the Phase 1 structural check against the production build manifest
(`apps/web/dist/.vite/manifest.json`) and the build output. The editor/practice split
introduced in Phase 2 is the measured win:

| Chunk | Before split (Phase 1 baseline) | After split (Phase 7) |
| --- | --- | --- |
| `PianoWorkspaceHarness` | 378.36 kB raw / 113.89 kB gzip | 160.73 kB raw / 46.77 kB gzip |
| `PianoPracticeWorkspace` | part of the harness chunk | 217.75 kB raw / 67.96 kB gzip |

Escaping numbers mean the same code is split, not removed: 113.89 gzip became
46.77 + 67.96 gzip across two independently loaded entries (114.73 total, of which
practice loads only `PianoPracticeWorkspace`).

Verified graph facts:

- Opening piano/guitar practice loads `PracticeEntry` → `PianoPracticeWorkspace` and
  **not** `PianoWorkspaceHarness`.
- The review route (`MusicReviewRoute`) still loads `PianoWorkspaceHarness`.
- `LessonExperienceHost` has no static harness import.
- `apps/web/tests/bundle-boundaries.test.ts` enforces that social browsing surfaces
  (`PracticeFeed`, `FeedCard`, `Public`, `Studio`, `social/*`) import no editor,
  capture, tracking, transcription or assessment module.

## 2. SQL query budgets

`tests/api/test_query_budgets.py` attaches a `before_cursor_execute` listener and
counts every statement a request issues, including authentication. Each budget is
compared at two library sizes at the same page size; an N+1 regression makes the
larger count grow.

| Endpoint | Budget | Shape |
| --- | --- | --- |
| `GET /api/public/moves` | ≤ 10, equal at 5 vs 30 lessons | 1 page + 1 revisions + 1 acceptances + 1 tags + like count/liked batch + auth |
| `GET /api/public/recommendations` | ≤ 20, equal as the library grows | seed lookups + 1 candidate page + the same four batches + auth |
| `GET /api/lessons/summaries` | ≤ 8, equal at 30 vs 55 lessons | 1 lesson/revision page + auth |

Discovery items are hydrated by `social.discovery_items()` using `IN (...)`/`GROUP BY`
for revisions, acceptances, tags and likes. No per-card query remains in listing,
recommendations or owner summaries.

Deliberately still per-request (constant, not per-card): `public_lesson()` for a single
detail/like/seed lookup, and `subject_projection()` which operates on already-loaded rows.

## 3. Retired vs retained compatibility paths

Repository-wide search was performed before any deletion.

**Retired**

| Path | Evidence |
| --- | --- |
| `MusicLessonScreen` export (`LessonExperienceHost.tsx`) | No production import, no test import; dead wrapper over the dormant `MusicLessonHome`. |
| `public.listing_item` helper | Superseded by `social.discovery_items`; no remaining references. |

**Intentionally retained**

| Path | Why |
| --- | --- |
| `MusicDraftReview.tsx` | Still imported by `MusicReviewRoute` for the explicit `legacyGuitarReview` escape hatch. The branch is unreachable from the app (no caller passes the flag), but the file has a production import, so it is not deleted under the Phase 7 rule. Candidate for Phase 8 after the route flag is removed in a dedicated change. |
| `music-practice.ts` | Imported by `apps/web/tests/music-practice.test.mjs`; documented as a historical controller only. |
| `MusicLessonHome.tsx` | Imported by `LessonExperienceHost` for non-piano/guitar music subjects (defensive fallback) and by `music-practice-runtime.test.tsx`. Removing it would break a live test and the fallback. |
| `PianoWorkspaceHarness` re-export shim | Existing editor/harness imports and tests depend on it. |
| Legacy `practice_progress` table and `/lessons/{id}/progress` endpoint | Body resume state remains authoritative there; plan-scoped progress is additive. |
| `web/` prototype | Outside the application; not part of this repository's app graph. |

## 4. Deferred runtime measurements

The following require a live server/browser and were not performed in this session:
feed/editor/practice transfer bytes per configuration, manifest/reference request counts
on a real release, frame/commit/memory profiles after repeated Act/mode switches, and
device resource-release verification. The structural budgets above and the query budgets
are the enforced part of Phase 7; the frame/memory budgets remain those recorded in the
Phase 0 baseline and must be measured before final acceptance.
