# Railway staging deployment

Use a **separate** project for this application. Do not repurpose the user's existing projects or databases. Creation of new chargeable resources requires explicit approval.

1. Create the application service, PostgreSQL service, and private bucket.
2. Deploy from repository root; `railway.toml` selects the CPU Dockerfile, a single predeploy migration, and `/health/ready`.
3. Set `ENVIRONMENT=staging`, `DATABASE_URL` from the PostgreSQL service, and bucket endpoint/region/name/addressing style/credentials through Railway variable references. Use the variable names in `.env.example`.
4. Leave `DEMO_ENABLED=false` unless deliberately providing rights-cleared demonstration media. The image contains no downloaded demonstration, model weights, or credentials.
5. Check liveness and readiness, restart the service, and verify the revision tables persist. Railway readiness probes run during deployment; add continuous monitoring in the pilot-hardening phase.
6. Record project/service/deployment IDs and test evidence, but never commit secrets or full variable dumps.

The GPU image is separate. The current native worker and eventual outbound HTTPS worker protocol do not require exposing a home-machine port. Hosted worker integration is Phase 3.
