# Owner music review and finalisation

Implemented 5 November 2026 as a private review milestone. This does not enable music
processing, install a model, publish a lesson, implement scored feedback or complete the
whole Phase 5 publishing workflow.

## Instructor flow

The existing conversion card shows **Review music**. Draft lessons with no revision are
included in the card's ready-to-review filter. It opens `?page=music-review&id=<lesson>`
under the same account and app shell. Refresh restores this destination, and sign-in
retains the return link.

The lazy review screen plays the retained private instructor video, displays fixture
warnings, and supports note pitch/start/length corrections, optional notes, add/remove,
and contiguous teaching sections. Notes are paginated in groups of 50. Proposed passage
spans are preserved; this initial reviewed reference remains unscored. Edits reset the
explicit review confirmation. A failed save retains corrections and can be retried.

Saving opens the existing private music preview destination. That preview remains the
current metadata placeholder; an animated guide and learner practice player are later
milestones. Further editing of an already reviewed reference also remains follow-on work.

## Server contract

`POST /api/lessons/{lesson_id}/music-draft/review` accepts an owner request with:

- exact draft id and original reference SHA-256;
- reviewed title, bounded note events/passages and contiguous teaching sections;
- explicit `confirm_reviewed: true`.

The server locks the lesson/draft, refuses stale drafts and cross-instrument replacements,
and validates note ends as well as attacks. Note ids must be unique. It creates a new
immutable reference JSON and v2 manifest, plus `MusicReview` audit evidence and a
`music-review` acceptance for that exact revision. The assessment policy is **none**;
input modes are **none** and scoring dimensions empty. Model provenance and original
draft identity survive finalisation.

Retries with the same normalized request return the same revision. A conflicting request
for an already reviewed draft returns 409. A replacement creates the next revision and
does not overwrite the old reference/source or advance the published pointer.

Migration **0019** adds `music_reviews`. The record ties draft, lesson, reviewed revision,
reviewer and review time to original/reviewed reference hashes and the request fingerprint.
The original proposal document remains intact; its status becomes `reviewed`.

Music publishing stays blocked by the existing guards. Finalisation is never a shortcut
through public-media or sharing qualification.

## Review corrections made to 84b0130

1. Completed draft retries previously returned a lesson id before checking attempt
   identity. They now require the matching worker credential and attempt token.
2. Draft handoff used `lessons/<id>/reference.json`, which could overwrite an earlier
   reference. Each draft now receives a unique reference key, and each reviewed reference
   has its own immutable key.
3. Handoff deleted the uploaded instructor clip after saving only the note proposal.
   It now copies the source to a unique private lesson asset before upload cleanup,
   preserving its byte identity. Draft owners can stream that asset without a manifest;
   other accounts cannot. Old drafts whose source was already deleted show an explicit
   unavailable message; this work cannot restore deleted media.
4. Draft note durations could extend beyond the clip and duplicate ids were accepted.
   Both are rejected, and draft duration is bound in both directions to the leased clip.
5. A replacement could change piano to guitar without updating lesson identity.
   Creation, draft handoff and review now refuse that mismatch; a different instrument
   requires a new lesson.
6. No-revision drafts were filtered out of conversion cards. The existing feed now keeps
   them visible and routes them to owner review without loading a body manifest.
7. Adapter event handling now safely handles empty MIDI instrument lists, clips note
   boundaries, and fails explicitly on excessive note counts rather than silently
   truncating. A short fractional fixture regression is covered. These tests use stubs;
   they do not qualify Basic Pitch's actual output or checkpoint.

## Verification

| Check | Result |
| --- | --- |
| Full configured Python run | 282 passed, 13 skipped |
| Updated review/handoff tests | 4 passed, including source retention, wrong-attempt retries, owner-only access, exact review identity, stale drafts, immutable replacements, and private-only finalisation |
| Adapter tests after added edge cases | 5 passed; two newly added cases were run separately from the full run |
| Web suite | 248 passed, including normalized draft-reader and malformed-payload regressions |
| TypeScript / production build | Passed |
| Schema artifacts | All 3 current |
| Migration rendering | Offline SQL reaches 0019; no live database was migrated |
| Review browser | Passed: feed card -> refreshable owner review -> video playback -> corrected notes/sections -> confirmation reset -> failed-save retry -> private preview; no camera/microphone/MIDI requests |
| Movement feed and mixed discovery browser checks | Passed |
| Visual review | Phone and desktop screenshots captured; phone review layout inspected without horizontal overflow |
| Initial JS/CSS gzip | 128,921 bytes versus 126,758 at the Phase 2 checkpoint; within the existing 16 KiB allowance |

Across the full and targeted runs, 284 distinct Python tests passed, with the existing 13
skips. This is the combined API/avatar count, not an API-only count. PostgreSQL row-lock
behavior and migration against legacy rows are still deployment qualification work.

## Next

Proceed with the Phase 4 adapter artifact selection and benchmarking, the music guide/
playback surface, and the remaining review editing operations. Before enabling real music
creation, pin code and checkpoint identities with commercially usable terms, exercise the
actual model, finish worker deployment/resource checks, apply 0015–0019 to disposable
PostgreSQL with legacy data, and complete the target browser/device preparation matrix.
Keep music processing disabled while these proceed in parallel. No new model, production
flag, database deployment, commit or push was performed by this continuation.
