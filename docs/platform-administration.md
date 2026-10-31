# Platform administration

Platform roles are independent of group membership and Studio. Existing accounts migrate to `member`; nobody becomes an administrator automatically.

| Role | Permissions |
| --- | --- |
| Member | Existing personal, sharing and group permissions |
| Admin | View account and operational metadata; suspend/restore Members; queue Member deletion; revoke Member sessions; send standard verification/reset emails; archive/restore groups; moderate reported public listings; inspect/retry/cancel processing; view their own administrative activity |
| Super Admin | All Admin permissions; manage administrative accounts and platform roles; see all administrative activity; open/close registration |

Administrative roles never bypass lesson ownership or private asset permissions. Practice scores, practice progress, recordings, password hashes, authenticator secrets and session tokens are not exposed in the dashboard. Account details show up to 100 recent moves, memberships, jobs and administrative entries; main lists have pagination.

## Enable the first Super Admin

1. Apply the migrations to the intended deployment database:

   ```powershell
   .venv-saas/Scripts/python.exe -m alembic upgrade head
   ```

2. Register your own account through the app and verify its email.
3. Run the following on the deployment host, using its database configuration and your real email:

   ```powershell
   .venv-saas/Scripts/python.exe scripts/manage_platform_admin.py bootstrap --email "your-account@example.com" --reason "Initial platform owner"
   ```

4. Sign in again, open **Account → Administration**, confirm your password, and add the displayed setup key to an authenticator app. Enter its six-digit code to finish enrollment.

Bootstrap only works when no Super Admin exists. Subsequent appointments happen inside Administration. Role and status updates invalidate the target's sessions and outstanding email tokens. The last active, verified Super Admin cannot be demoted, suspended or queued for deletion. Changes serialize through a database lock so concurrent requests cannot remove both remaining owners.

## Administrative authentication and recovery

Administrative endpoints require both the normal verified-account session and a session-specific authenticator verification. Verification lasts 30 minutes; a new browser or new sign-in requires a new code. Codes use TOTP (SHA-1, six digits, 30 seconds, one step clock tolerance), are rate limited and cannot be replayed after acceptance. Enrollment requires password confirmation; no replacement key is exposed once enrolled.

If an administrator loses their authenticator, an operator with deployment access must verify their identity and run:

```powershell
.venv-saas/Scripts/python.exe scripts/manage_platform_admin.py reset-mfa --email "your-account@example.com" --reason "Identity verified; lost authenticator"
```

This revokes every session and records operator recovery in the activity log. The administrator then signs in and enrolls again. There is no browser-based MFA bypass or account impersonation. Protect production database access and backups: TOTP enrollment secrets must remain available to the verifier and are stored in the accounts table. Use encrypted storage/backups and restrict database access to service operators.

## Status and retention

Verification and administrative status are separate. An unverified account with normal status is displayed as **Pending verification**. The other statuses are **Active**, **Suspended** and **Deletion pending**.

Suspension and deletion pending block login and authenticated routes, revoke sessions and paired displays, and invalidate outstanding email tokens. Restoring an account does not restore an old session. Status changes do not automatically unpublish content, remove group memberships or cancel already running processing; those are separate recorded controls.

Deletion pending records a request timestamp. Keep data for at least 30 days to allow cancellation and operator review of shared-content ownership and retention requirements. This release does **not** automatically purge accounts or assets. An operator must complete any approved deletion after that review. Returning the status to Active or Suspended cancels the pending request timestamp.

## Moderation, groups and processing

Hiding a reported public listing immediately removes it from discovery, tags, public detail and public asset access. It preserves the owner's private access and existing direct/group sharing. Owners cannot undo the moderation flag by relisting. Restoring clears the moderation flag; the owner's own listing/withdrawal choices still apply. Reports on moves without public listings can be dismissed, but cannot be hidden/restored through public-listing moderation.

Archiving a group revokes its group-based access without deleting memberships or privately owned moves. Restoring the group restores its group access.

Retries follow the existing processing safety limits: failed state, fewer than three attempts, eligible error, no ambiguous provider submission, an active owner, and the owner's concurrency limit. Cancelling invalidates the worker lease. External provider work that may already have been submitted remains marked unknown; cancellation does not promise a refund or termination at the provider. Source uploads and partial outputs are retained for operator cleanup under the deployment's storage-retention policy.

Every administrative mutation requires a reason. The dashboard and API expose no audit editing or deletion. Audit metadata is committed in the same transaction as database mutations; MFA enrollment, verification, bootstrap and recovery are also recorded. Production operators should use database permissions and backup/export policies if audit immutability must extend beyond the application boundary.

## Validation

```powershell
.venv-saas/Scripts/python.exe -m pytest tests/api/test_admin.py -q
cd apps/web
npm run build
```
