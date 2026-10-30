# Phase 4 — Teaching and sharing

30 October 2026. Implemented and verified locally. Physical Android/iPhone camera/voice testing and Railway/AWS deployment remain deferred by the user. Pricing and synchronized groups are outside this checkpoint.

Teachers publish an explicitly reviewed, rights-acknowledged immutable revision. Subsequent section/title edits remain private until republished. Students receive read-only access to that published manifest and its exact private assets; owner editing remains protected by the API. Both roles use the same `LessonWorkspace` and `MimicInterface`. Playback controls and voice navigation consume the saved section boundaries from the existing whole-rig splitting workflow.

Email invitations are bound to the receiving verified account and expire after seven days for acceptance. Accepted access lasts until revoked, unpublished, archived or disabled. Link access requires verified sign-in and explicit joining; links can be forwarded and expire after 30 days. Only token hashes are stored. Generating a replacement link invalidates prior link grants. Revoked learners cannot rejoin through a link; teachers can restore access with a new email invitation. Replaced or revoked invitations cannot restore a newer grant. Tokens enter through URL fragments and are removed from the address bar, including same-tab navigation.

Authorization is checked for each manifest, progress and media request. Unpublishing, archiving, operator disablement or revocation blocks new requests. Bytes already delivered to a browser cannot be recalled. Teacher participation summaries use actual accepted grants and recent practice activity; they do not collect camera frames or pose scores. Learners can submit one report per lesson/account. Operator review is local and reversible:

```powershell
.venv-saas/Scripts/python.exe scripts/moderate_saas_lesson.py
.venv-saas/Scripts/python.exe scripts/moderate_saas_lesson.py --lesson-id ID
.venv-saas/Scripts/python.exe scripts/moderate_saas_lesson.py --lesson-id ID --enable
```

Verification:

- 36 API tests passed, including published/draft separation, read-only students, private progress, invitation email mismatch and expiry, revocation/reinvitation, link rotation/expiry, old token rejection and report/disable handling.
- Six opt-in infrastructure tests passed against real local PostgreSQL and private S3-compatible storage, including publication, acceptance, exact media bytes, reconnect and revocation. SMTP is mocked in this integration fixture; actual Mailpit delivery was checked separately through the running app.
- Real local HTTP/browser checks used an original synthetic lesson and disposable teacher/learner accounts. Invitation delivery, browser joining, shared collection, reused Mimic Interface, private draft updates, republishing, media denial after revocation/unpublishing, reinvitation and reporting passed. No real training media was published as part of these tests.
- Frontend type checking and production build passed. Owner sharing and learner library fit 320/360/390/768/1024/1440 CSS-pixel widths without horizontal overflow. This is responsive viewport verification, not physical-phone certification.
- Final `form-saas:phase4` CPU image built locally. Real email verification, account isolation, private asset ranges, packaged tracking assets and saved practice position passed; account sessions, revisions and private media survived application/database/storage restart.

Phase 3 additionally passed real browser upload, GPU conversion, invalid-source rejection and forced worker interruption/recovery with exactly one resulting lesson. See `phase-3-verification.md`. The worker remains independent of the CPU web image and has no database/storage credentials. Local ignored `.local/qa/` contains disposable test evidence and screenshots; credentials and raw invitation links are not committed.

Before a public pilot: finish physical-device acceptance, approved cloud deployment and recovery rehearsal, retention/backup/monitoring operations, and the later hardening phase. No cloud resources were created.
