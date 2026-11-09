# Music history: Phase 6E backend foundation

9 November 2026. **Implemented behind a default-off gate. No history UI or automatic uploads.**

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
