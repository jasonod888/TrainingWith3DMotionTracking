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
| Attempt table shape | UUID id PK, account/lesson/revision foreign keys, account and lesson indexes, JSON summary |
| Fresh database | 29 public tables, version 0020; second `upgrade head` made no change |
| ORM probe | SQLAlchemy engine connected and queried the new attempt table |

## Not covered

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
