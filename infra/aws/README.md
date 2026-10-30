# AWS portability boundary

The CPU application uses standard Docker, PostgreSQL and private S3 APIs. It has no Railway SDK dependency. Deploy the same CPU image on ECS/Fargate, use RDS PostgreSQL, and configure S3 through environment settings. Leave `STORAGE_ENDPOINT` unset for AWS and use `STORAGE_ADDRESSING_STYLE=virtual`.

Use an ECS task IAM role for bucket permissions rather than static access keys. Run the Alembic migration as a one-off task before shifting application traffic. Do not build GPU dependencies into the API service.

Accounts and sessions live in PostgreSQL, not process memory or a local disk. Preserve account IDs, password hashes, session/token digests and object keys during migration. Set the HTTPS `PUBLIC_URL` and an SMTP provider (for example SES SMTP with STARTTLS); store SMTP credentials in deployment secrets. Asset requests are authorized through the same API on both platforms, including byte-range streaming. There is no Railway-specific authentication or file-serving dependency.

The CUDA worker belongs on GPU-capable EC2/ECS capacity using the locally verified Linux worker image. Cloud infrastructure provisioning, migration rehearsal, backups, DNS cutover and rollback are Phase 6; these have not been implemented or tested by the foundation.

Upload/conversion and sharing use the same API/database/storage contract on both hosts. Migrate conversion/lease records, published revision IDs, grants and invitation/token digests together with accounts and private objects. Configure the outbound worker with its scoped API credential and the new HTTPS origin; revoke old worker credentials during cutover. Apply migrations through `0005`. Run dry-run retention cleanup and verify interrupted-job recovery, invitation email delivery, published media access and revocation in an approved staging environment before cutover. Local container results do not replace that cloud rehearsal.
