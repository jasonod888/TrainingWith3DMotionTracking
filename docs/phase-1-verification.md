# Phase 1 — Accounts and permanent private lessons

Date: 30 October 2026. Status: **implemented; local acceptance checks passed**.

## Delivered

- Registration, email verification/resend, sign-in/out and password recovery/reset.
- Salted scrypt passwords; opaque HTTP-only cookie sessions backed by PostgreSQL; hashed, expiring, single-use email tokens. Reset revokes every account session.
- Allowed-origin/JSON/application-header write protection, session-bound CSRF tokens, shared database authentication throttles, validation responses that do not echo passwords/tokens.
- HTTPS/Secure cookies and encrypted SMTP required for hosted environments; development mail stays in local Mailpit.
- Owner-only library, manifest and byte-range media routes. S3 remains private. No Railway-specific SDK, public bucket or container-local persistence.
- Trusted fixture importer with file/hash/size checks, plus a controlled button that copies only the configured demonstration into the verified user's private library.
- Immutable lesson/section revisions with optimistic conflict rejection; central Save and lesson renaming. Public demonstration drafts are still clearly session-only.
- Explicit, validated import of same-animation prototype browser sections; never an automatic migration of browser storage.
- Archive hides a lesson and rejects new manifest/media requests immediately. Private objects and revision history remain retained; no permanent purge runs in this phase.
- Minimal account screens, private library states, protected lesson loading, and responsive editor. Original MVP source remains unchanged.

## Evidence

| Check | Result |
| --- | --- |
| API/contract/authentication suite | 27 passed |
| Playback/controller/synthetic GLB suite | 9 passed |
| Original MVP suite | 29 passed |
| Real PostgreSQL/private S3 integration | 5 passed |
| Migration 0001 → 0002 | Applied to real local PostgreSQL |
| Simultaneous edits from independent connections | Exactly one save succeeded; the other returned 409 |
| Cross-account access | Other account cannot list/read/edit/archive another owner's lesson or retrieve its media |
| Private media and seeking | Anonymous S3 request rejected; authorized byte range returned exact expected bytes |
| Verification email | Delivered to actual local Mailpit; verification succeeds once and replay is rejected |
| Session/reset boundaries | Unverified/expired/revoked sessions denied; reset invalidates all sessions; expired/reused tokens denied |
| Request protections | Wrong Origin, missing application header, missing CSRF and non-JSON writes rejected |
| CPU container | Final image built; local email/sign-in/private library tested inside the image |
| Restart and fresh-client reopen | Account, session, revision and media survived PostgreSQL/storage/API restart and reopened in a fresh client |
| Browser persistence | Renamed real lesson and first section saved; survived full reload, sign-out and sign-in |
| Responsive checks | Library/editor at 320/360/390/768/1024/1440 CSS pixels; account layouts checked across the same responsive range |
| Mobile refinements | Compact labelled icon navigation; smallest transport layout has no horizontal overflow |
| Build/type check | Passed; deferred Three.js chunk warning remains |

70 automated tests passed across these suites. Deployment scripts add real HTTP/restart checks; they do not use SQLite as a substitute for the PostgreSQL gate. Unit tests use isolated SQLite files and fake object storage, while the five explicitly opted-in infrastructure tests use the real local services.

Local evidence (ignored by Git): `.local/qa/phase-1-deployment.json`, `phase-1-responsive.json`, `phase-1-library-mobile.png`, `phase-1-library-desktop.png`, `phase-1-editor-mobile.png`, `phase-1-register-mobile.png`. Disposable preview accounts use non-deliverable example addresses and the local mailbox. No external email or cloud resources were used.

## Boundaries and next phase

Railway and AWS configuration is retained but hosted deployment is untested and remains deferred. Camera/voice integration, calibrated comparison, practice resume and real-device lifecycle verification are Phase 2. No claim of testing physical Android/iPhone devices is made.

Archived data is retained until a deliberate retention/cleanup policy is implemented. Imported reference media is for local development; hosting it requires appropriate rights. Existing downloaded bytes cannot be recalled by archival. Authentication operational limits and email delivery monitoring need the later pilot-hardening review before public launch.

Security design references: [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
