# Multi-discipline Phase 2 log

Started 4 November 2026. Status: **in progress.** Music processing stays disabled
(`music_piano_conversion_provider` and `music_guitar_conversion_provider` default to
`disabled`). Phase 2 interface changes are **not accepted yet**: the movement browser
checks have not run against this build.

Checkpoint for Phase 0 and Phase 1: commit `a6a91ff`.

## Delivered so far

### Discovery and summaries (server)

- `GET /api/lessons/summaries?subject=<id>` filters owned summaries by the **draft**
  label the owner sees. An unknown subject is a client error (422).
- `GET /api/shared-lessons/summaries?subject=<id>` filters by the **released** label, so
  a recipient never sees the owner's unpublished relabel.
- Group detail rows now carry `subject`, `subject_label`, `experience_family` and
  `instrument` from the published revision.
- Public listing items carry the same four fields, and `GET /api/public/moves?subject=`
  filters on the released revision **inside the query, before `offset`/`limit`** — a
  page can no longer omit matching lessons because filtering happened afterwards.
- `PublicMove` and `GroupMoveView` client types carry the subject fields.

Tests: `tests/api/test_discovery_filters.py` (4 tests) — owned filter, released-label
freeze for a recipient, group projection, public filter before pagination.

### Discovery UI (first, deliberately dormant slice)

- The feed has a secondary **subject filter** row that renders only when the account can
  see more than one subject. A movement-only library keeps exactly the current controls,
  so no existing screen changes until multi-subject data exists.
- Card detail already shows the subject label from the workflow projection.
- Client helpers `loadLessonSummaries(subject?)` / `loadSharedSummaries(subject?)` accept
  a filter for the forthcoming summary-state migration.

## Remaining Phase 2 work

| Slice | State |
| --- | --- |
| P2.1 migrate library/shared state from full manifests to `LessonSummary` | Not started. Deliberately held until the browser checks can run, because it changes every card, preview and studio consumer. |
| P2.2 subject badges and filter | Started: dormant filter row and label on cards. Badges on all card types still to do once summaries drive the feed. |
| P2.3 extend summary queries | Owned, shared, group and public projections done. |
| P2.4 dispatch music at check/preview/practice/edit | Host exists from Phase 1 and opens a music deep link; fixture cards not added. |
| P2.5 deep links and Back | Unchanged; music deep links handled by the host. |
| P2.6 inert music fixture cards | Not started; needs a real fixture through the import path. |
| P2.7 session and resource cleanup | Not started. |
| P2.8 capability messaging at point of use | Not started. |
| P2.9 lazy loading and bundle budget | Music screen is a lazy chunk; measured budget check still to do. |

## Verification status

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean |
| `npm --prefix apps/web test` | 223 passed |
| `npm --prefix apps/web run build` | Passes |
| API suite | **259 passed, 13 skipped** (Phase 1: 255/13; +4 discovery tests) |
| Movement browser scripts | **Not run.** Playwright and its Chromium build are now installed, but the scripts need a seeded Vite + API stack with a database; that stack was not started. |
| Music screen visual check | Not run |
| PostgreSQL migration of 0015/0016 | Still pending; offline SQL only |

## Acceptance rule for this phase

The Phase 2 interface work is complete only when `verify_practice_flow.py`,
`verify_practice_preview.py`, `verify_practice_feed.py` and `verify_compete_flow.py`
pass against the same build, plus a visual check of the music fixture screen. Until
then, treat the feed filter as dormant scaffolding rather than an accepted change.
