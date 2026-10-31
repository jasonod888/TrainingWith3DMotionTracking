# W0 — Everyday workflow contracts

Status: accepted 30 October 2026 as the implementation baseline for `mobile-first-workflow-plan.md`. The annotated layouts are represented by the delivered screens; this record fixes the domain decisions those screens depend on.

## Decisions

| Decision | Contract |
| --- | --- |
| Acceptance | One disposable acceptance record per (move, revision), created by the owner after viewing that revision. It records the reviewer, time, warnings shown and source. Acceptance never runs inference and never changes the manifest. |
| Shared release | `lessons.published_revision_id` remains the single pointer to the revision recipients follow. A release must have an acceptance record. Legacy publications are backfilled by migration; publishing a revision without one records an acceptance with source `publish` for backward compatibility. |
| Private edits | Saving sections, renaming or changing tags does not alter the shared release. A later publish/update points at another accepted revision. |
| Audience reasons | Access is evaluated from independent reasons: owner, direct grant (invite/link), group membership, public listing. Reasons are additive and revoking one never revokes another. Link grants keep `share_generation`, expiry and rotation semantics. |
| Group vs collection | Sharing a move to a group is an access reason for its members. Adding an already-public move to a group collection is presentation only. The two are separate records and separate UI actions. |
| Public listing | Public means the accepted shared release plus public metadata (title, creator display name, description, bounded tags) and a public-safe preview. Source video, account email, invitations, attempts and scores are never public. Withdrawing public listing does not delete private grants. |
| Public media | Public visitors may load animation, landmarks and a public-safe thumbnail. The authenticated asset route keeps serving source video only to owner/direct/group reasons. |
| Recording | A take is a bounded local resource owned by the learner. Export is a device handoff (share sheet where supported, download fallback); no silent upload. Video-only for this milestone; no audio capture. |
| Take limits | Explicit product limits replace today's silent 2-minute/32 MB stop. Remaining time is visible; reaching a limit finalizes the take with an explanation. |
| Naming | Naming is optional at creation. An empty title receives a neutral server fallback and can be renamed later without processing. |
| Studio | Studio is an optional presentation of existing editing/administration. It is not a separate account, role or permission source. |

## Screen inventory

My moves · Add video · processing card (uploading/queued/preparing/ready-to-check/failed) · Check your move · post-acceptance actions · sharing sheet · group collection · public detail · practice · take review/save · Studio entry.

Every screen above has a phone path. Only precision multi-section editing, bulk organisation, large access tables and detailed reporting are desktop-optimised inside Studio; basic trimming, acceptance, friend/group sharing, public tagging, group management and saving a take remain fully available on mobile.

## Recovery inventory

Interrupted upload (resume with the original file), poor reconstruction (adjust clip or choose another video; timing edits cannot repair geometry), expired invitation, removed group access, recording failure (practice still works), storage pressure (discard or save first), cancelled saving (take retained until explicitly discarded).

## Exit gate

- No everyday task needs the section editor or Studio.
- Acceptance, release, audiences and public listing are distinct states with distinct permissions.
- Unknown or stale state resolves to a recoverable screen rather than a silent redirect.
- Device budgets are recorded during W8 qualification on real phones.
