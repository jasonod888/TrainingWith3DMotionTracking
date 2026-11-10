# PostgreSQL migration verification: 0015–0020

10 November 2026. Performed against a disposable PostgreSQL 16 container, not a
production database and not a deployment. This is migration-execution evidence, not a
claim that the music pilot is ready to enable.

## Environment

- `postgres:16-alpine` in Docker Desktop on Windows; database `form_verify`.
- Python 3.12, SQLAlchemy, Alembic and `psycopg` 3.2.12 from `.venv-saas`.
- Second empty database `form_fresh` for a from-zero upgrade.
- Synthetic legacy rows only: one account, one lesson, one body revision, one failed
  conversion, inserted while the schema was at **0014**. No production data was copied.

## Commands (abbreviated)

```powershell
docker run -d --name form-pg-verify -e POSTGRES_PASSWORD=verifypass -e POSTGRES_DB=form_verify -p 55432:5432 postgres:16-alpine
$env:DATABASE_URL='postgresql+psycopg://postgres:verifypass@127.0.0.1:55432/form_verify'
python -m alembic upgrade 0014
# insert the legacy account, lesson, revision and conversion with psql
python -m alembic upgrade head
python -m alembic current
```

The fresh database used `createdb form_fresh`, `alembic upgrade head` twice (the second
was a no-op), `alembic current`, and a SQLAlchemy connection to count tables and query
`music_practice_attempts`.

## Results

| Check | Result |
| --- | --- |
| Upgrade 0014 → head | Applied 0015–0020; `alembic current` reports **0020 (head)** |
| Legacy lesson | `subject = movement_other`, `experience_family = body`, `instrument = NULL` |
| Legacy revision | Backfilled to `movement_other` / `body` / `NULL`, preserving the historical label |
| Legacy conversion | Subject default applied; `preparation` empty; `media_findings` column present (NULL) |
| New tables | `music_drafts`, `music_reviews`, `music_practice_attempts` exist |
| Attempt table shape | VARCHAR(36) PK containing UUID text (not native PostgreSQL UUID), account/lesson/revision foreign keys, account and lesson indexes, JSON summary |
| Fresh database | 29 public tables, version 0020; second `upgrade head` made no change |
| ORM probe | SQLAlchemy engine connected and queried the new attempt table |

## Not covered by the original migration run

- Production or anonymized real data, including large revision/asset volumes.
- Downgrades (only forward upgrades were exercised).
- Concurrent writes, the 5,000-summary quota under PostgreSQL row locking, or idempotent
  retry races. SQLite tests still cover the logic, not PostgreSQL locking.
- Any deployed configuration or enabled feature flag.

## Conclusion

The 0015–0020 chain applies cleanly both to a legacy 0014 schema with body-era rows and to
an empty database, and the default-off history table is reachable through the ORM. This
satisfies the migration-execution gate for development. Production readiness still needs a
disposable copy of real-shaped data, downgrade/recovery rehearsal, and concurrent
quota/idempotency testing.

The container and both databases are disposable and were removed after the checks.


## Follow-up: real PostgreSQL races and backup/recovery (10 November)

Reviewed `1e05253`. Added and executed `scripts/verify_music_postgresql.py` against
PostgreSQL **16.15**, using the cached `postgres:16-alpine` image. A final reproducible
run and an earlier development run both passed; this is bounded scenario coverage,
not a long-running stress test. Exact image ID, app commit, harness SHA-256 and the final
results are retained in `docs/qualification/music-postgresql-concurrency-2026-11-10.json`.
The harness was also independently re-run on this checkout: it passed in under ten seconds
with the same quota, retry, downgrade/empty-upgrade and dump/restore outcomes.

Run from the repository root:

```powershell
.venv-saas/Scripts/python.exe scripts/verify_music_postgresql.py
```

The harness creates its own randomly named, labelled container bound only to loopback,
with no host volumes or image downloads. It does not accept an external database URL.
Cleanup verifies the container label before removing that container. No deployed database
or application configuration was touched. The temporary dump and databases disappear
with the container; the durable record contains no credentials or real performances.

The synthetic dataset has four accounts, four music lessons/revisions and 4,999 summary
rows for the quota account before the race. Reviewed reference metadata and real login
session fixtures are seeded; HTTP requests use the real session/CSRF/origin checks and
real independent database transactions, with no auth or database dependency overrides.
No real reference media, transcription or MIDI hardware is exercised.

Barriers make all competing requests reach account-lock acquisition together. The cross-
account collision additionally synchronizes the actual inserts, forcing the unique-key
conflict path rather than merely issuing sequential requests.

| Scenario | Executed result |
| --- | --- |
| Four distinct saves with 4,999 existing summaries | Exactly one 201 and three 409 responses; account count stops at 5,000 |
| Exact retry at quota | 201, no additional row; a new summary still receives 409 |
| Four identical concurrent retries | Four 201 responses, one stored row |
| Same account/UUID, differing payloads | One 201 and one 409, one new row |
| Two accounts force the same UUID at insert | One 201 and one 409, one stored row across both accounts |
| Cursor boundary deleted between pages | Subsequent page continues with the expected next rows on PostgreSQL |
| Backup | Full custom-format `pg_dump` of all synthetic tables at 0020 |
| Downgrade 0020 → 0019, then upgrade | History table disappears as designed; upgrade recreates an empty table; accounts/lessons/revision manifests remain intact |
| Restore into a fresh second database | All 5,002 remaining summaries, account/lesson/revision counts, exact summary identities/content/timestamps and revision-manifest digests match the pre-downgrade snapshot |
| Readiness probe and cleanup | Restored ORM/database probe passes; disposable container removed |

The downgrade is deliberately **data-destructive for music history**. Merely upgrading
again cannot recover those rows. The separate fresh-database restore proves recovery
from the pre-downgrade backup; it is not an approval to downgrade a live deployment.
Only migration 0020's downgrade was exercised here, not downgrades 0015–0019.

### Remaining scope

The original development migration-execution gate plus the bounded quota/retry and
backup/restore cases now have real PostgreSQL evidence. Unscored pilot development can
continue. Still open: representative deployment topology/connection pressure, large
lesson/revision/asset volumes, sustained load, older downgrade chains, actual operational
backup/restore timing/retention and anonymized real-shaped data. The near-quota dataset
is a useful bound check, not a claim of production-scale performance.

No application code changed in this follow-up, so the full Python/web suites were not
rerun. The new executable harness itself passed and compiled. Physical-keyboard,
commercial model and scoring qualification remain separate; all deployed flags remain
unchanged.
