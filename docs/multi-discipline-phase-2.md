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

- The feed has a secondary **subject filter** row that renders only when at least two
  subjects are available. Options come from the owned workflow states and the **shared
  summaries** — sources that exist before the feed is filtered — never from the already
  filtered public page, so selecting a subject cannot shrink the options that produced it.
- A hidden filter never filters: a selection that is no longer offered (deleted or
  relabelled subject, or a movement-only account) resolves to `all`, and the stored
  selection is reset.
- Shared cards and filters use the released subject from `/shared-lessons/summaries`, not
  the owner-only workflow states, so a recipient-only subject is visible and selectable.
- Public results are filtered **by the server**: the subject is a query parameter on every
  page (including "More"), and the page identity includes the subject so switching while a
  request is in flight cannot let the stale response win. The client no longer filters
  public results by subject after the page has been cut.
- Client helpers `loadLessonSummaries(subject?)` / `loadSharedSummaries(subject?)` accept
  a filter for the forthcoming summary-state migration.

### Feed correctness follow-up

| # | Finding | Fix | Coverage |
| --- | --- | --- | --- |
| 1 | The subject filter was not actually dormant | Options are gated to the pre-filter sources; the control renders only with two or more subjects; a stale or removed selection resolves to `all` instead of filtering invisibly | `apps/web/tests/feed-subject.test.mjs` |
| 2 | Shared lessons used the owner workflow states for subject metadata | Shared lessons and filters read `sharedSummaries` from `/shared-lessons/summaries`; `LibraryApp` fetches them with the shared list and on join/sign-in | same file (recipient-only subject case) |
| 3 | Public filtering still happened after pagination in the client | Subject is sent to `/api/public/moves` on every page; page key includes the subject; client-side subject filtering removed | `apps/web/tests/feed-subject.test.mjs`, `tests/api/test_public_pagination.py` (30 matches across two pages) |

Known limitation for the next slice: a subject that exists **only** in public results is
not offered as an option, because options come from owned and shared sources. A facet
endpoint (`GET /api/public/subjects`, counts over unfiltered listings) is the clean fix
and belongs with P2.1 rather than being bolted onto the dormant control.

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
| `npm --prefix apps/web test` | **230 passed** (Phase 1: 223; +7 feed-subject) |
| `npm --prefix apps/web run build` | Passes |
| API suite | **262 passed, 13 skipped** (Phase 1: 255/13; +4 discovery, +3 pagination) |
| Movement browser scripts | **Not run.** Playwright and its Chromium build are now installed, but the scripts need a seeded Vite + API stack with a database; that stack was not started. |
| Music screen visual check | Not run |
| PostgreSQL migration of 0015/0016 | Still pending; offline SQL only |

## Acceptance rule for this phase

The Phase 2 interface work is complete only when `verify_practice_flow.py`,
`verify_practice_preview.py`, `verify_practice_feed.py` and `verify_compete_flow.py`
pass against the same build, plus a visual check of the music fixture screen. Until
then, treat the feed filter as dormant scaffolding rather than an accepted change.
