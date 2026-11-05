# Multi-discipline Phase 2 log

Started 4 November 2026. Status: **in progress.** Music processing stays disabled
(`music_piano_conversion_provider` and `music_guitar_conversion_provider` default to
`disabled`). Phase 2 interface changes are **not accepted yet**: the four movement browser
scripts were run against this build and each stops on a script/UI drift that still needs
triage (see the outcomes table).

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

Tests: `tests/api/test_discovery_filters.py` (4 tests) and
`tests/api/test_public_pagination.py` (3 tests).

### Discovery UI (gated, not accepted)

- The subject filter is behind a **server rollout capability**: `subject_filter` in
  `/api/capabilities`, default `false` (`SUBJECT_FILTER_ENABLED`). When it is off the
  control is not rendered at all, so an existing movement library keeps exactly its
  current controls. When it is on, the row still requires at least two subjects.
- Options come from the owned workflow states and the **shared summaries** — sources that
  exist before the feed is filtered — never from the already filtered public page.
- A hidden filter never filters: a selection that is no longer offered resolves to `all`,
  and the stored selection is reset.
- Shared cards and filters use the released subject from `/shared-lessons/summaries`, never
  the owner-only workflow states.
- Public results are filtered **by the server**; the subject travels as a query parameter
  on every page and the page identity includes it, so a subject switch invalidates an
  in-flight response.
- Retry is explicit: a first-page failure re-requests page 0, while a failed "More" keeps
  the loaded pages and retries the same next page.

### Feed correctness follow-up

| # | Finding | Fix | Coverage |
| --- | --- | --- | --- |
| 1 | The subject filter was not actually dormant | The render condition was missing the rollout capability; it is now `subjectFilterEnabled && options > 1`, and options are gated to pre-filter sources | rendered gating tests (hidden by default, shown when enabled) |
| 2 | Shared card labels still read owned workflow state | The card label resolver uses `states` for owned lessons and `sharedSummaries` for shared ones | rendered label test |
| 3 | Public filtering still happened after pagination | Subject is sent to `/api/public/moves` on every page; page key includes it; the client re-filter was removed | `tests/api/test_public_pagination.py` (30 matches across two pages) |
| 4 | Retry did nothing after a pagination failure | The first-page key includes the retry counter; "More" failures get their own message and retry the same next page instead of resetting | rendered first-page and pagination retry tests |

Rendered-component tests use jsdom + React Testing Library (new dev dependencies) and
mount the real feed, so gating, labels and both retry paths are asserted against the DOM.

Known limitation for the next slice: a subject that exists **only** in public results is
not offered as an option, because options come from owned and shared sources. A facet
endpoint (`GET /api/public/subjects`, counts over unfiltered listings) is the clean fix
and belongs with P2.1.

## UI defects fixed (5 November 2026)

Both confirmed defects were reproduced first, fixed, and re-checked with the same
assertions that caught them. No global overflow clipping was added.

| Defect | Reproduction | Fix | Verification |
| --- | --- | --- | --- |
| Landscape header overflow | At 812×375 signed out, `scrollWidth` was 842: the actions block measured 206 px inside a fixed 160 px grid column | The 761–1100 px header column now sizes to its content (`max-content`) with `min-width:0` on the actions | Probe at 812×375: `scrollWidth == innerWidth == 812` for signed-in (actions 152 px) and signed-out (actions 206 px) |
| Focus lost after closing settings | Pressing Escape left focus on `document.body`; the opener was already inert before the panel's effect read `activeElement` | `PracticePanel` captures the opener during render (before the inert commit) and restores focus on the animation frame after the closing commit | `verify_practice_flow.py` now passes the keyboard focus assertion and continues to later steps |

## Browser checks (5 November 2026)

Playwright + Chromium were installed into `.venv-saas`; scripts mock their API and ran
against `vite` dev on `127.0.0.1:5173` with `PRACTICE_TEST_URL` set.

Script updates for outdated expectations (behaviour assertions retained):

- `verify_practice_feed.py`: at widths ≤760 it opens the navigation drawer before
  measuring, asserts the drawer closes with Escape and that focus returns to the toggle,
  and routes nav clicks through the drawer. Search is now `Search practices`; the account
  entry is `Account menu → Account`.
- `verify_compete_flow.py`: the section control is now
  `Browse sections. Section N of 3` (regular expression), keeping the section-selection
  assertions.

`scripts/verify_music_screen.py` now asserts that `errors` is empty, instruments
`getUserMedia`, `requestMIDIAccess` and `permissions.query`, and fails if any is called.
It passes: no page errors and no device permission requests.

All four scripts now progress **past** their previously reported stops and stop later on
separate drift. Each is recorded rather than masked:

| Script | Previous stop | Current stop |
| --- | --- | --- |
| `verify_practice_feed.py` | Hidden mobile navigation | Reaches the preview journey, then `Back to feed` does not exist: the preview screen has no visible Back control (browser history only) |
| `verify_practice_preview.py` | Horizontal overflow at 812×375 | Overflow assertion passes; stops at the watch-position check: the `Lesson position` control does not follow `video.currentTime` within 15 s |
| `verify_compete_flow.py` | `Section 1/3` locator | Section control passes; stops at the `1× Speed` control, whose current accessible name differs |
| `verify_practice_flow.py` | Settings focus after Escape | Focus assertion passes; stops at `group "Camera" → button "Front"`, whose current setup controls differ |

**Music fixture visual check: passed.** Both screenshots were regenerated by the
strengthened check; the phone and desktop views render the heading, reference panel,
sections and the "no camera, microphone or MIDI access" notice.

These four remaining stops are recorded as **subsequent drift needing triage**. The gate
is not closed: none of the four movement scripts runs to completion yet.


## Remaining Phase 2 work

| Slice | State |
| --- | --- |
| P2.1 migrate library/shared state from full manifests to `LessonSummary` | Not started. Still held until the browser drifts above are triaged. |
| P2.2 subject badges and filter | Gated filter and card label done; badges on all card types still to do. |
| P2.3 extend summary queries | Owned, shared, group and public projections done. |
| P2.4 dispatch music at check/preview/practice/edit | Host opens a music deep link; fixture cards not added. |
| P2.5 deep links and Back | Unchanged; music deep links handled by the host. |
| P2.6 inert music fixture cards | Not started; needs a real fixture through the import path. |
| P2.7 session and resource cleanup | Not started. |
| P2.8 capability messaging at point of use | Not started. |
| P2.9 lazy loading and bundle budget | Music screen is a lazy chunk; measured budget check still to do. |

## Verification status

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean |
| `npm --prefix apps/web test` | **235 passed** (Phase 1: 223; +7 feed-subject, +5 rendered feed) |
| `npm --prefix apps/web run build` | Passes |
| API suite | **262 passed, 13 skipped** (Phase 1: 255/13; +4 discovery, +3 pagination) |
| Movement browser scripts | **4/4 fail on later drift**; all four progress past their previous stops (see above) |
| Music screen visual check | **Passed**, strengthened: no page errors and no camera/microphone/MIDI requests |
| PostgreSQL migration of 0015/0016 | Still pending; offline SQL only |

## Acceptance rule for this phase

The Phase 2 interface work is complete only when the four movement scripts pass against
the same build and their drift is resolved in the scripts (or shown to be a real UI
regression and fixed), plus the music screen visual check. Until then, the filter stays
behind the disabled rollout capability and is not an accepted change.
