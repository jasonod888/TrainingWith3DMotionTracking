# Everyday workflow implementation record

Updated 31 October 2026 after review and corrective implementation. The everyday creation, acceptance, sharing, group and practice screens are implemented. W8 physical-device and hosted-service qualification is still open; this is not a claim of production qualification.

## Correctness fixes

- Public projections and both public-only asset routes omit original-video thumbnails. The conversion thumbnail is a source frame, so public cards use a neutral fallback until a separate 3D-only poster exists. Paired displays and shared-library responses use the same media projection.
- Removing or leaving a group revokes accepted invitation tokens. An already-consumed token cannot recreate membership. Joining remains idempotent while membership exists. Owner self-transfer is harmless, and group admins may remove shared moves as advertised.
- Recording intent is cleared by session cancellation, settings, section changes, seeking, calibration interruption, backgrounding and exit. Ordinary Play cannot inherit a cancelled recording request.
- Watch opens the existing take. Record another requires deliberate replacement of an unsaved take. Parent navigation and browser closing protect an unsaved take. Export filenames are neutral and contain no private move title.
- Saving distinguishes share-sheet completion and download request from confirmed saving. The take stays available; the user can confirm that they saved a copy. Recording time/file limits finalize the take with an explanation. Review uses the accessible practice panel with Escape, focus trapping and a bounded video area.
- The recording action has a properly scoped dark background, readable foreground and visible focus state.
- `lessons.published_revision_id` is the authority for all recipient audiences. Public metadata edits retain it. Explicit release updates advance the shared version for everyone. Adding audiences does not silently advance an existing release. Owners can practise a listed release while editing a newer private draft.
- Stable query-based destinations support refresh and browser Back without requiring an additional server rewrite. Private move/group destinations recheck access. Pending invitations and authentication return paths live in session storage for 30 minutes; secrets are removed from URL fragments. Same-origin tabs can transfer the pending return context when verification opens separately. Cross-device users must reopen their original invitation; no secret is copied into a normal route.
- Check, move and public previews play continuously across section boundaries and expose an accessible position slider.
- Friend invitations retain only failed recipients for retry and recognise already-pending invitations without resending them. Failed email delivery revokes the unusable pending token so it can be retried. Group managers can view, resend and cancel pending invitations.

## Workflow completion

- Group owners choose whether all members or only managers may contribute. A public collection entry (`group_public_moves`) is separate from a private group permission (`group_lessons`). Withdrawing a public listing removes collection-only access without changing private grants. Both can coexist independently.
- Create a group directly from the share sheet. Public moves can be kept in group collections. Explore has load-more pagination and public detail has a shareable stable link.
- Ready conversion cards remain actionable until the latest move has been checked.
- Studio retains individual participation counts, recent activity, access removal and release state. Counts explicitly exclude public viewers and group attendance. Everyday sharing remains simple.
- Move check/detail/public and Studio load separately; the initial entry is approximately 306 kB raw / 94 kB gzip, down from the reviewed 929 kB / 254 kB. The 3D viewer remains a larger separately loaded bundle.

## Migration and rollout

Apply Alembic through `0012` before starting this build against an existing database. This adds contribution policy and public collection associations and consolidates release pointers. Where old public and private releases differed, the existing friends/groups release wins; public-only moves adopt their accepted public release. Owners should review affected public listings after migration. Consolidation is not reversed on downgrade.

The `0009` offline PostgreSQL SQL now includes the legacy acceptance backfill rather than silently skipping it. Readiness checks require the new columns/table. The infrastructure migration assertion expects `0012`.

## Verification

- API regression suite: 76 passed after the final collection-table refactor. The public suite was rerun after the final metadata-preservation fix.
- Interface/controller tests: 23 passed, including cancelled recording intent and continuous multi-section preview.
- Pose/voice tests: 30 passed.
- Production TypeScript/build passed; migration SQL renders through `0012`.
- Disposable migration test verifies release consolidation and new defaults without touching application data.
- Browser checks with synthetic content: Explore refresh and Back; practice refresh; Add video → sign in → upload return; Check refresh; full two-part preview completion; acceptance → Try/Share; group creation inside sharing; desktop Studio activity/access. Desktop (1280 × 800), portrait (320 × 480), and landscape (812 × 375) practice layouts fit. At 320 × 480, practice has no horizontal or vertical page overflow and the recording control has dark background/readable foreground. No real camera or microphone was enabled.

## Still open

- Physical iPhone/Android capture, share/download cancellation and saved-file playback, TV/casting, enlarged text and human usability qualification.
- Full PostgreSQL migration/backfill execution and hosted storage/CDN withdrawal checks; offline SQL and isolated migration logic are not substitutes.
- GPU conversion with real source media after these changes.
- A rendered 3D public poster, creator-profile management, public-account/minor policy and staged rollout controls remain product/operational work; they are not represented as completed by this fix pass.
- Takes are bounded, in-memory resources. Browser/process termination can lose them. The interface says this; durable local draft recovery remains future work.

No existing camera, voice, pairing, section editing or conversion capabilities were removed.
