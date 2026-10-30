# AWS portability boundary

The Phase 0 CPU application uses standard Docker, PostgreSQL and private S3 APIs. It has no Railway SDK dependency. Deploy the same CPU image on ECS/Fargate, use RDS PostgreSQL, and configure S3 through environment settings. Leave `STORAGE_ENDPOINT` unset for AWS and use `STORAGE_ADDRESSING_STYLE=virtual`.

Use an ECS task IAM role for bucket permissions rather than static access keys. Run the Alembic migration as a one-off task before shifting application traffic. Do not build GPU dependencies into the API service.

The CUDA worker belongs on GPU-capable EC2/ECS capacity after Linux verification. Cloud infrastructure provisioning, migration rehearsal, backups, DNS cutover and rollback are Phase 6; these have not been implemented or tested by the foundation.
