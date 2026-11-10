# Reviewed-lesson editing and assessable passages

10 November 2026. Owners can now reopen a reviewed music lesson, correct it, and save a
new immutable revision. The shared release is unchanged until the owner explicitly updates
it.

## Revision editing

`POST /api/lessons/{id}/music-revision` accepts:

- `base_revision_id` (must be the current latest reviewed revision);
- `title`, note events, passages, teaching sections and assessment policy;
- `confirm_reviewed: true`.

The server validates the owner, music family, reviewed/accepted base revision, event and
passage bounds, contiguous sections and the supported policy. It writes a new reference
JSON with a new hash, a v2 manifest referencing the same instructor video, a new
`LessonRevision`, and an owner acceptance for that exact new revision. Migration **0021**
adds `music_revision_edits` audit rows (base/new revision, editor, request hash, reference
digests). Retries with the same base and request return the same revision; a different
edit for an already-edited base returns 409.

The lesson's `published_revision_id` is deliberately untouched. Learners with access keep
the old revision and its reference. The share screen shows **Update shared version** when
the accepted revision differs from the shared one; only that action changes what learners
receive. Unpublishing/revocation semantics are unchanged.

Client: an owned music card offers **Edit lesson**. The lazy editor loads the latest
revision and its reviewed reference (verifying the asset digest), edits title, notes,
sections, policy and passages, then saves. Any change resets the confirmation. The editor
is not a second review of an unreviewed draft: it requires a saved reviewed lesson.

## Assessable passages

A music passage now carries `kind: 'playing' | 'explanation'` (default `playing` for older
references). The review/edit UI labels them. Feedback and matching:

- only **playing** passages can produce matched/missing/extra corrections;
- input in explanation passages is ignored rather than counted as extra;
- explanation notes are excluded from eligibility/coverage counts;
- with no passages, existing behaviour is preserved.

The guide still shows all notes; it does not claim explanation passages are played. This is
not the same as measured observation coverage, and it does not enable scoring.

## Verification

| Check | Result |
| --- | --- |
| `tests/api/test_music_edit.py` | **Passed**: new revision/hash/audit, contiguous sections, learner keeps old release, idempotent retry, changed retry 409, explicit update switches learner to new revision |
| `scripts/verify_music_edit.py` | **Passed**: edit title/pitch/passage kind, save posts the base revision, preview shows the edit |
| `music-feedback.test.mjs` | Explanation-passage exclusion (notes and input) |
| Web suite | **283 passed**; TypeScript, build and bundle checks pass (music screen within budget) |
| Full API suite | **323 passed, 13 skipped** |

## Limits

- No side-by-side diff/history browser or rollback UI; revisions are immutable but shown
  only as the current lesson and, for learners, the published revision.
- No co-editor roles; only the owner.
- Policy editing is limited to watch-only/MIDI note feedback with the existing dimensions.
- Scoring, physical qualification and public/link/group music release remain disabled.


## Boundary and metadata corrections (10 November 2026)

- Overlapping passages are rejected by the server contract, the client reference reader
  and the edit path (422).
- A note or attack whose onset tolerance window crosses a playing/explanation boundary is
  **unassessed**, not missing or extra. It is excluded from corrections and from the
  eligible denominator. Inputs near a boundary are ignored rather than reported as extra.
- Title-only and other partial edits preserve the instructor's existing `velocity` and
  `confidence` values; the editor no longer clears or drops them. New notes start with
  null values until a later editor exposes them.
- `verify_music_edit.py` and focused API tests cover boundary notes, overlap refusal and a
  title-only edit retaining velocity/confidence.
