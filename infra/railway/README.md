# Railway staging deployment

Use a **separate** project for this application. Do not repurpose the user's existing projects or databases. Creation of new chargeable resources requires explicit approval.

1. Create the application service, PostgreSQL service, and private bucket.
2. Deploy from repository root; `railway.toml` selects the CPU Dockerfile, a single predeploy migration, and `/health/ready`.
3. Set `ENVIRONMENT=staging`, `DATABASE_URL` from the PostgreSQL service, and bucket endpoint/region/name/addressing style/credentials through Railway variable references. Use the variable names in `.env.example`.
4. Leave `DEMO_ENABLED=false` unless deliberately providing rights-cleared demonstration media. The image contains no downloaded demonstration, model weights, or credentials.
5. Check liveness and readiness, restart the service, and verify the revision tables persist. Railway readiness probes run during deployment; add continuous monitoring in the pilot-hardening phase.
6. Record project/service/deployment IDs and test evidence, but never commit secrets or full variable dumps.

Phase 1 also requires `PUBLIC_URL=https://your-browser-domain`, `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_STARTTLS=true`, `SMTP_USERNAME`, `SMTP_PASSWORD` and an approved `MAIL_FROM`. Secure session cookies are automatic outside development. Run all Alembic migrations before routing traffic. No Railway resources have been provisioned or tested; the user has deferred deployment.

The GPU image is separate. The Phase 3 worker now uses outbound authenticated HTTPS claims, heartbeats and bounded asset transfer; it needs no inbound home-machine port and receives no database/bucket credentials. Run it on separately approved GPU capacity against the public HTTPS API origin. Create/revoke its scoped credential with `scripts/manage_saas_worker.py`; keep the generated environment file in deployment secrets. Persist job records in PostgreSQL and objects in the private bucket. API temporary upload spooling is disposable and must be writable by UID 10001; no lesson depends on that local disk. Review retention and schedule the dry-run-first conversion cleanup before unattended operation.

All migrations through `0006` are required for upload jobs, worker credentials, published revisions, invitations, grants and reports. Invitations use the configured SMTP provider and `PUBLIC_URL`. Browser upload parts and private media use same-origin API routes, so the bucket may retain its internal endpoint. Railway deployment remains untested; local Docker tests establish container portability only.

Inference placement is independent of this hosting target. Set `CONVERSION_PROVIDER=local` to keep using the home GPU over outbound HTTPS; no GPU inference runs in the web service. Replicate/fal require a separate lightweight dispatcher and an explicitly verified custom pipeline. See `docs/processing-providers.md` for configuration, secrets, held submission reservations and recovery. No cloud deployment or paid provider has been activated.
