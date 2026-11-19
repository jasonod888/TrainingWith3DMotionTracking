# Act platform rollout and rollback runbook

## 1. Scope

Migrations `0026`–`0029` introduced Acts, plan-scoped practice progress, publication
roles and lesson likes. This runbook covers expand/migrate/contract, rollback, the four
temporary flags, and the pre/post deployment checks.

## 2. Migration sequence

### Expand
1. Take the normal database backup/snapshot.
2. Apply `alembic upgrade head` (`0026` → `0027` → `0028` → `0029`). All are additive:
   - `0026` Act/editor lifecycle columns and workflow support.
   - `0027` plan-scoped practice progress.
   - `0028` publication roles/readiness fields.
   - `0029` `lesson_likes` with unique `(lesson_id, account_id)`.
3. Deploy the new API and web build **without** enabling any new public surface.

### Migrate
1. Verify `/api/capabilities`:
   - `phase: 9`
   - `rollout` values match intended deployment
   - `acts` includes `drawing` when enabled
   - `lesson_formats` still `[1, 2]` for legacy clients.
2. Backfill/observe:
   - existing publications have explicit roles or are intentionally unlisted;
   - no music release is public until `public_music_enabled` is deliberately set;
   - likes table has no duplicate pairs (`uq_lesson_like`).
3. Smoke owner, invite, link, group, public and moderation journeys.

### Contract (only after the compatibility window)
1. Confirm no supported client relies on removed fields.
2. Remove deprecated compatibility shims/flags in a dedicated change.
3. Only then drop retired columns/tables (`alembic downgrade` is for rollback, not cleanup).

## 3. Temporary rollout flags

All are read from the environment per request, default `true`, and only gate surfaces.

| Flag | Env | Default | Removal condition |
| --- | --- | --- | --- |
| `act_drawing_enabled` | `ACT_DRAWING_ENABLED` | `true` | One production release cycle of drawing and no older client in the support window. |
| `public_music_enabled` | `PUBLIC_MUSIC_ENABLED` | `true` | Piano/guitar public playback and assets pass browser acceptance; Phase 5 compatibility window closed. |
| `social_likes_enabled` | `SOCIAL_LIKES_ENABLED` | `true` | Likes stable for a full migration cycle and rollback to a like-less release no longer supported. |
| `social_recommendations_enabled` | `SOCIAL_RECOMMENDATIONS_ENABLED` | `true` | Deterministic policy accepted two cycles and response covered by the public contract. |

Behavior when off:

- `act_drawing_enabled=0`: drawing create/save returns 404; drawing is excluded from
  discovery/recommendations; drawing public detail/assets/likes return 404. Stored
  revisions, acceptances, publications and likes are untouched.
- `public_music_enabled=0`: music excluded from discovery/recommendations; music public
  detail/assets return 404. Owner/invite/group access is unaffected.
- `social_likes_enabled=0`: like PUT/POST/DELETE return 404; existing like rows and counts
  remain; re-enabling is idempotent.
- `social_recommendations_enabled=0`: `/api/public/recommendations` returns 404; discovery
  continues newest-first.

Do not turn historical branches (e.g. body progress) into permanent settings. If a flag
outlives its removal condition, delete it rather than adding another.

## 4. Rollback

### Fast surface rollback (preferred)
Set the relevant env flag to `0` and restart. No migration or data mutation is required.
Verify the endpoint returns 404 and `/api/capabilities` reflects the flag.

### Application rollback
1. Roll back API/web to the previous image.
2. Keep migrations applied if the previous build tolerates additive columns/tables
   (`0026`–`0029` are additive). Do not downgrade unless the previous build cannot start.
3. If downgrade is unavoidable, downgrade in reverse order and verify:
   - `0029` removes only `lesson_likes` (historical likes intentionally lost);
   - `0028` removes role/readiness fields;
   - `0027` removes plan-scoped progress;
   - `0026` removes Act columns.
4. Restore the backup if any step reports loss beyond the documented table/column.

### Data invariants during rollback
- Never rewrite accepted revisions or `published_revision_id`.
- Never convert a drawing document into a body/piano manifest.
- Unlisting or moderation hiding is reversible; deletion is not.

## 5. Compatibility window

- Body v1 remains readable by all supported clients.
- Music v2 requires format negotiation; keep it private until the public music gate is
  deliberately enabled.
- Drawing v3 is served to clients that can parse it; older clients show the neutral
  unsupported message, never a body fallback.
- `X-Lesson-Formats` semantics: callers advertise document versions they can parse;
  servers must not downgrade a specialized document to a different schema.

## 6. Verification checklist

- [ ] `alembic upgrade head`; `alembic current` shows `0029`.
- [ ] `/api/capabilities`: phase 9, expected rollout values, descriptor version 1.
- [ ] Owner: create/edit/accept/publish/unlist on body, piano, drawing.
- [ ] Invited learner: accept → read; revoke → detail/assets 404.
- [ ] Linked recipient: accept → read; rotate/unpublish → 404.
- [ ] Group member: read; removed member → 404.
- [ ] Public visitor: listed detail/assets 200; unlist → 404; moderation hide → 404.
- [ ] Owner still reads an immutable revision after each access loss.
- [ ] Likes: idempotent, count preserved across flag off/on, 404 when disabled.
- [ ] Drawing flag off: create/discovery/detail/like 404; revisions unchanged; on restores.
- [ ] Public music flag off: music discovery/detail/assets 404; on restores.
- [ ] `pytest tests/api/test_rollout_acceptance.py` and the focused suites pass.
- [ ] `npm --prefix apps/web run build`; chunk graph still excludes the review harness
      from the practice path.
- [ ] Logs show no 500s on 404 paths; no revision/job mutation from flag changes.

## 7. Deferred live checks

Database migration on Postgres (SQLite tests cover the SQLAlchemy paths), real browser
media/permission behavior, public music playback, and production frame/memory budgets
must be verified against the deployment environment before enabling each surface.
