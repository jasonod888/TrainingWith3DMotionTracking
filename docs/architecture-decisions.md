# Foundation contracts and decisions

- One account can learn and teach; identity and paid entitlements do not yet exist in Phase 0.
- A stable lesson owns immutable motion revisions. Draft edits must not mutate a revision used in an active student session.
- Sections are logical intervals on one rig animation. The player never cuts the mesh or duplicates GLBs. Section IDs, not labels or duration, identify progress.
- One controller handles buttons and keyboard now, voice later. It holds exact end poses, resumes manual pauses, clamps final navigation and blocks movement commands while calibrating.
- `apps/api/contracts.py` owns the versioned manifest schema. `packages/lesson-schema` contains its JSON Schema, TypeScript projection, validators and an explicitly synthetic fixture. Media engine adapters must preserve declared coordinates, units and timing.
- Asset keys are relative object keys. Provider URLs are generated only after access checks when account-backed lessons arrive. Phase 0 exposes only an explicitly enabled, allowlisted demonstration directory.
- Discovery and access are independent contracts. New private lesson access must default to owner-only. Publication, invitations and bearer share links are Phase 4.
- Job success requires verification. Terminal success/cancellation is not automatically reopened; retries create isolated attempts with leases in Phase 3.
- Web/API runtime has no dependency on CUDA. PostgreSQL is the portable queue authority. Object storage has a small S3-compatible interface.
- No mandatory cloud dependency for UI preview. A missing database/storage returns a truthful non-ready status rather than pretending the application is deployable.
- Original prototype remains untouched during migration; React state does not drive the Three.js rendering frame loop.
