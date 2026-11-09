# Music history: Phase 6E backend foundation

10 November 2026. **Explicit save and paginated lesson/account history; default-off, unscored, no automatic uploads.**

## Scope and rollout

`MUSIC_HISTORY_ENABLED` defaults to false, independently of MIDI setup, processing,
sharing and scoring. `/api/capabilities` advertises `music_history`. While disabled,
GET/POST/DELETE music-history routes return 404 before reading their table. No deployment
setting was enabled. No learner practice request automatically saves a summary.

The API is a foundation for a later explicit **Save practice summary** action and a
personal history view in the existing account/lesson workflow. Those client controls are
not implemented in this slice. Current guide feedback truthfully remains local. Actual
scores, grades and qualification are excluded. Unscored practice summaries can be saved
independently of later scored-attempt qualification.

Migration **0020**, after 0019, creates `music_practice_attempts`; ORM metadata and the
readiness probe include the table. Apply migrations and test PostgreSQL with legacy data
before deploying this application version, even if the history flag remains off.
Offline PostgreSQL SQL rendering is not migration execution or concurrency qualification.

## Contract and endpoints

The authenticated, same-account API uses the existing session/origin/JSON request
protections. Mutations, including DELETE, require the application's JSON content type.

- `POST /api/lessons/{lesson_id}/music-attempts`: save one explicitly requested,
  completed, **unscored** repeat summary. Returns 201, including for an exact retry.
- `GET /api/lessons/{lesson_id}/music-attempts`: latest 100 summaries for the current
  account only, newest first, with server-assigned dates. Current readable access to the
  music lesson is required; no instructor/recipient can query another account's history.
- `DELETE /api/lessons/{lesson_id}/music-attempts/{uuid}`: remove the caller's own
  summary. Removal remains possible after lesson access is revoked or archived, provided
  the history gate is enabled. Another account receives 404.

The version-1 request is bounded to one aggregate per repeat:

```json
{
  "summary_version": 1,
  "status": "complete",
  "id": "97196a00-a988-4ded-b55b-a5f1bb0976ec",
  "save_requested": true,
  "revision_id": "reviewed-revision-id",
  "reference_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "rubric_version": "piano-midi-v1",
  "section_id": "all",
  "start": 0,
  "end": 8,
  "speed": 1,
  "run": 0,
  "assessment": "unscored",
  "alignment": "none",
  "note_window": {"total": 5, "eligible": 4, "matched": 2, "missing": 1, "extra": 1}
}
```

Use the actual reviewed revision/hash and either an exact teaching-section range or
`all` over the entire lesson. Run index is 0–4; speed is 0.5/0.75/1/1.25. A saved request
requires the supported piano `notes` policy, `midi` input and both `pitch`/`timing`
dimensions. Watch-only lessons cannot save MIDI correction summaries. Unknown policy
versions, stale new submissions and references without review are refused. Existing
saved exact retries remain idempotent while access is available; changing a saved UUID's
contents returns 409.

Counts are finite strict integers, 0–20,000. Eligible cannot exceed total;
matched+missing cannot exceed eligible; matched+extra cannot exceed the attack bound.
Optional notes explain why matched+missing can be less than eligible. These are
**client-reported aggregates**, not server-verified performance. Every response explicitly
marks `evidence: client-reported`; storing a summary does not certify its accuracy.

`note_window.eligible/total` describes reference notes with complete comparison windows.
It is not observed-input coverage, a score or an accuracy percentage. No arbitrary
coverage fraction is accepted. No raw MIDI events, note names, timing traces, device
identifiers, numeric calibration data, scores or arbitrary extra fields are accepted.
The endpoint refuses interrupted/incomplete status. Client-side qualification flags
cannot be supplied to turn these summaries into scored evidence.

## Limits, retries and compatibility

A separate 5,000-summary account quota counts saved music repeats, not note events and
not movement attempts. PostgreSQL account-row locking serializes quota checks; the
summary UUID is unique. Identical retries do not consume quota and work when full.
Different content with the same UUID returns 409. A database collision may return 409;
a later exact retry recovers a concurrently saved identical request. SQLite tests do
not qualify PostgreSQL locking behavior.

Saving at the limit leaves practice usable; deleting one's own summary frees a slot.
The existing pose-v1 payload, movement quota and movement response are unchanged. Its
history endpoint now explicitly refuses music revisions; music does not masquerade as
a pose score. The new history routes refuse body revisions.

## Follow-on work

1. Add explicit save/retry/delete and account-private history UI using the capability.
   Preserve the same UUID and exact payload on retries; changing content uses a new UUID.
   Saving remains optional; never upload automatically on completion or device connection.
2. Test migration 0015–0020 with legacy data on disposable PostgreSQL; exercise concurrent
   quota/idempotency behavior before enabling the persistence pilot.
3. Collect actual monitored-input coverage, author separately reviewed assessment spans
   and qualify exercise thresholds/false-correction rates on physical keyboards before
   scoring. The existing policy editor authorizes unscored note feedback only.
4. A future scored contract must have its own version and trusted qualification evidence;
   do not add a score to this unscored version or reinterpret existing saved summaries.

Tests cover default-off gating, exact identity/retries, request bounds and rejected raw
fields, quota, deletion, body/music separation, cross-account isolation and removal after
access revocation. Future recipient access is simulated directly in tests because real
music publishing/sharing remains blocked. No model, commercial artifact or physical
keyboard was qualified by this work.


Verification of the 97c73a3 continuation: full configured Python suite **296 passed,
13 skipped**; latest complete-only history checks **3 passed**; web suite **277 passed**.
TypeScript/production build and bundle check pass. Browser checks for instructor review
(including guitar policy availability), local feedback/reference-window wording and the
movement feed pass. All three lesson-schema artifacts are current. Migration SQL renders
through 0020; no PostgreSQL migration or physical-device qualification was performed.
No commit, push, deployed flag change or automatic learner upload was performed.


## Delivered: explicit Save summary and private history controls

The reviewed piano guide now consumes the `music_history` capability (default off):

- **Save summary** appears on a completed, analysed repeat only when the local feedback
  gate is satisfied (reviewed reference, `piano-midi-v1` notes policy, MIDI input selected)
  and the capability is on. Nothing is uploaded automatically on completion, connection
  or page load. The button sends one bounded unscored aggregate with `save_requested: true`;
  success, a server error and **Retry save** are shown inline.
- A retry reuses the same summary UUID and exact payload. A different summary or a changed
  run requires a new UUID, as the API contract requires.
- **View music history** loads the caller's own latest summaries on demand, newest first,
  showing date, run, section, speed and the client-reported counts. **Delete** removes the
  caller's own row and refreshes the list. Quota, validation and unavailable-history
  errors are shown verbatim.
- While the capability is off, neither control renders and no history request is made.
  The page still states that feedback is local and unscored.

Verification: `scripts/verify_music_history.py` covers no automatic upload, explicit save,
temporary-failure retry with a stable id, history listing, delete, and capability-off
hiding; `verify_music_feedback.py` continues to assert that ordinary practice makes no
persistence calls. Full API suite 296 passed / 13 skipped; web 277 passed; build, bundle
and the other music browser checks pass.

Limits: history is per lesson, not yet in the account destination; there is no pagination
beyond the API's latest 100; summaries remain client-reported evidence, not scores; and
the pilot stays disabled in deployment.


## 10 November: review of 7d91d58, session-safe saves and account pagination

This section supersedes earlier UI-status/100-row limitations. The existing Account
screen now offers **View all music history**, gated by `music_history`, and lesson history
uses the same paginated panel. Reading is explicit: entering Account, opening a lesson,
finishing practice and connecting MIDI do not open history or upload performance.
A successful explicit save refreshes a history panel only if the learner already opened
it. Account/lesson history modules load lazily; capability-off screens keep existing
movement controls. No second login, scored history or separate account destination.

Fixed a review finding: repeat number and range were reused across separate practice
sessions, allowing a new performance to inherit "saved" state. Save identity is now
session-specific, allocated only on explicit save. The first request freezes its payload;
retries reuse that object and UUID. A synchronous in-flight guard prevents duplicate
clicks. Changing practice session or reference invalidates UI callbacks from old saves;
late responses cannot label a new run as saved. A save already accepted by the server
can still complete after leaving: use history to inspect it; no background save or
cross-reload retry queue is introduced. The guide now accurately explains that choosing
Save summary sends an aggregate, instead of always claiming nothing has been sent.

### Additive paginated reads

- `GET /api/music-attempts?limit=20&cursor=...` returns the authenticated account's own
  summaries across lessons as `{items, next_cursor}`.
- `GET /api/lessons/{lesson_id}/music-attempts/page?limit=20&cursor=...` returns the same
  shape scoped to a currently readable lesson. The legacy GET without `/page` remains
  a latest-100 array, so existing clients retain their contract.
- Limit is 1–100. Cursors encode the last `(created_at, UUID)` pair; ordering is newest
  date then descending UUID. Equal timestamps, deleting the cursor row and newer inserts
  cannot cause the offset-based skips that an offset list would. Newer summaries above
  the cursor appear on Refresh. Cursor contents are validated but are not permission
  grants: every query is always scoped to the authenticated account.

Rows add `lesson_id` and an immutable-revision title only when the caller still has the
relevant lesson access (or owns the active lesson). Archived/revoked/unreadable revisions
show **Lesson unavailable** without disclosing a lesson title. The learner's own aggregate
remains available in account history and can be deleted through the existing private
DELETE route. An instructor still cannot read another learner's history. No protected
lesson document or media is fetched just to render unavailable history.

Client responses are runtime-validated and copied before rendering. Load More failures
retain existing rows and retry the same cursor. Refresh/exit invalidates stale reads;
deletions cannot be overwritten by an older read. Request dates are normalized to UTC.
Invalid cursors and out-of-range limits return 422. The capability gates both new reads;
no new table, migration, upload type or scored payload is introduced in this continuation.

Browser evidence covers exact retry payloads, distinct sessions, a delayed save response
arriving during another session, explicit account reads, unavailable-title display,
page failure/retry with preserved rows and cursor, page exhaustion, deletion, phone/
desktop overflow and capability-off no-read behavior. API tests cover tied dates,
deleted cursor boundaries, newer inserts, account isolation and unavailable lessons.

Next: qualify PostgreSQL migrations/concurrent writes and physical input monitoring in
parallel. Actual measured observation coverage, assessment spans and device-qualified
thresholds still gate scoring. Existing unscored summaries must never be reinterpreted
as grades. Model/commercial artifact qualification remains separate.


Verification for this continuation: full configured Python suite **297 passed,
13 skipped**; web suite **279 passed**. TypeScript/production build, bundle check and
all three lesson-schema artifacts pass. Browser checks pass for enhanced music history,
local feedback, instructor review and the movement feed. Phone and desktop history
screenshots are recorded and the phone layout was visually checked. Initial JS/CSS is
129,114 gzip bytes; the music screen static closure is 14,046 gzip bytes, within budget.
No physical-keyboard test, model installation/qualification or deployed flag change was
performed. Migrations 0015–0020 were exercised separately on a disposable PostgreSQL 16
database; see [`music-postgresql-verification.md`](music-postgresql-verification.md).
