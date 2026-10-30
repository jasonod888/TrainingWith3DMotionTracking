# Mobile-first everyday workflow: phased implementation plan

Status: proposed, revised after a source cross-check. Prepared 30 October 2026 and verified against the current source the same day. Documentation only; no application changes are made by this plan.

This plan refines the existing application around casual creation, sharing and practice. It preserves the Mimic Interface, conversion pipeline, private storage, versioning, access controls and advanced teaching capabilities. Its W0–W8 phase names are independent of the previous SaaS and Mimic phases.

## Relationship to existing plans

This plan extends, and in one respect deliberately reverses, the earlier documents:

- It keeps the product model in `requirement/advanced requireement.txt` and the build baseline in `requirement/saas-implementation-plan.md`: accounts, private library, immutable revisions, durable conversion jobs, free sharing and instructor tools.
- It reverses the earlier launch decision to defer public discovery. Tagged public moves and Explore are now in scope for W6. That is a scope decision, not a wording change, and should be recorded as one.
- It keeps voluntary payments, course bundles, marketplace checkout and payouts deferred (formerly Phase 7). Nothing here requires payment tables or entitlements.
- It keeps the earlier privacy stance: no server retention of learner camera video by default. W3's export is a device handoff; server transcoding is an explicit opt-in exception.
- Until the earlier plan is revised, this plan governs the everyday product workflow and the earlier plan still governs infrastructure, data migration and operational release gates. Reconcile Phase 4 of `requirement/saas-implementation-plan.md` when this plan is approved.

## 1. Product outcome

A person using only a phone can add a video, check and accept its 3D animation, keep it private or share it with friends/a group/everyone, try the move, record a take and save that video. No teaching setup, participation dashboard, detailed section editor or desktop handoff is required.

Desktop offers the same everyday experience, with an optional Studio for more involved work. Mobile also retains essential group, privacy and access management. Screen size changes presentation; it does not define account permissions.

The primary journey is:

**Add video → Prepare 3D move → Check it → Looks good → Try it / Share → Record a take → Watch / Save video / Try again.**

After acceptance the move is private automatically. Share offers Friends, A group and Public. The user never has to share before practising.

## 2. Current foundation and gaps

| Area | Reuse | Refine or add |
| --- | --- | --- |
| Upload | Authenticated file selection, trimming, resumable parts, conversion status/retry | Short mobile steps, stable processing card and return destination |
| Review | Source/3D player and section editor | Explicit reconstruction acceptance separate from timing edits |
| Practice | Viewport shell, camera setup, calibration, controls, loops, voice, pairing | Casual entry actions and a clearly visible Record a take action |
| Recording | Bounded local capture and reference replay | Save/export, unsaved-take protection, capability-aware recovery |
| Sharing | Private assets, email invitations, link access, immutable shared revision | Friendly sharing sheet and multiple independent audience grants |
| Groups | Existing account/lesson authorization | Actual groups, membership and group collections |
| Public content | Existing reporting/moderation foundations | Public-safe asset projection, creator identity, tags, discovery and public access rules |
| Advanced tools | Detailed editor, reviewed publication, access/activity management | Optional Studio presentation; preserve existing behavior and data |

The current app has no actual group/tag/public discovery model. An existing link-access lesson still requires sign-in/joining and is not a public listing. Recording currently has replay, not a dedicated in-app Save video flow; the current in-memory take is removed on exit/replacement. Converted source previews and camera recordings currently have no audio.

The prior Mimic verification document lists physical-phone, TV, live recording/video-transfer, enlarged-text and human-feedback gates that remain open. This plan must complete the relevant gates rather than assuming they were passed.

### 2.1 Verified current behaviour that this plan changes

The gaps below were confirmed in the current source, not inferred from screens. They are the concrete starting point for W1–W3.

| Observed behaviour | Consequence for this plan |
| --- | --- |
| A finished conversion is removed from the in-progress list: `ready_for_review` rows are filtered out, and the "Ready to edit" label is defined but never rendered. The library is refreshed silently. | W2's persistent card and "Ready to check" action do not exist today; readiness depends on the user noticing a new card. |
| The review route is the section editor; its primary action is Save. There is no acceptance action. Publishing requires a `reviewed` checkbox that is validated but never stored as an acceptance record. | W1/W2 add a real acceptance state rather than relabelling the editor. |
| There is no move-detail screen: opening a card goes straight to practice, and review is reachable only through Edit. | W2 needs a post-acceptance destination for Try it now and Share instead of overloading the player or the editor. |
| Sharing is a single `distribution` per move (`private`/`invite`/`link`) with one grant row per (move, account). There is no group, tag or public listing entity, and every animation/source asset passes through the authenticated `readable_lesson` check. | W1/W4/W5/W6 need new reason records and a public-safe read path, not just new screens. |
| Recording is in-memory and single-take, capped at 2 minutes or 32 MB, revoked on exit or when the next take starts, and reachable only through More → Recording. Replay is a native `<video controls>`; no download action exists anywhere in the web source. | W3's take resource, save flow and unsaved-take protection are all new work. |
| Each conversion finalisation creates a new move. There is no "replace this move's clip" path. | W2's regeneration requirement needs a lesson-scoped replacement attempt. |
| Attempt summaries are readable only by the account that recorded them; an owner sees access state and last-active only. | W4 can keep casual sharing free of reporting; Studio reporting is participation, not scores. |
| Upload requires an account; signed-out users can still practise the demonstration. Invitations require the matching verified email; link access still needs sign-in and acceptance. | W2/W4 keep the gating but change the explanation and the recipient flow. |
| Camera capture requests no audio, and the worker strips source audio. | W0's video-only export decision matches the current capture path; no audio work is implied. |

## 3. Experience rules

- Everyday creation, review, sharing, practice and video saving must be complete on mobile.
- Keep the existing no-page-scroll practice contract. Review, recording and sharing use short bounded steps. Browsing collections can use familiar vertical scrolling.
- Prefer one primary action per step. Keep advanced adjustments secondary and preserve choices when going back.
- Use everyday language in the default experience. Retain technical identifiers and current internal lesson APIs where useful; a wording change does not require renaming the entire backend.
- Keep account/profile controls secondary to moves and practice. Require sign-in before costly upload/processing as today, and explain it as keeping the user's moves rather than introducing a role or workspace; preserve the intended action across sign-in and email verification.
- Show processing readiness, acceptance and sharing as distinct states. A successful conversion is not evidence that the user accepted the reconstruction.
- Camera use, recording, microphone use, saved practice summaries and publishing have distinct choices. Sharing a move never shares the learner's take or scores automatically.
- Use the same account for fun and teaching. Studio is optional. Essential access removal and privacy controls remain on mobile.
- Existing data, published snapshots and invitation validity must survive migration without widening access.

## 4. Proposed navigation and language

At the first release, lead with **My moves**, a prominent **Add video** action and an avatar for account controls. Add **Groups** when groups work and **Explore** when public discovery works. Do not display empty or disabled future destinations. Desktop adds a persistent Studio entry only after the user enables teaching tools.

| Existing everyday wording | Proposed wording |
| --- | --- |
| Create lesson | Add a video |
| Lesson name | Name your move (optional initially) |
| Ready to edit | Ready to check |
| Lesson editor | Adjust your move |
| Ready to teach? | Share this move |
| Publish reviewed version | Update shared move |
| Your learners | People with access |
| Join lesson | Try this move |

Studio can continue to use precise teaching terminology where it helps instructors. Do not replace accurate tracking limitations with promotional coaching claims.

## W0 — Confirm the interaction design and product contracts

Purpose: settle the small number of decisions that affect every later phase.

### Deliverables

- Annotated, clickable layouts for a new mobile user, returning user, invited friend, group member and Studio user. Cover phone portrait/landscape and desktop.
- Screen inventory: My moves, Add video, processing status, Check your move, post-acceptance actions, sharing sheet, group collection, public detail, practice, take review/save and Studio entry.
- Error/recovery layouts for interrupted upload, poor reconstruction, expired invitation, removed group access, recording failure, storage pressure and cancelled saving.
- Final terminology and navigation specification. Default post-acceptance actions are Try it now and Share; the private state is visible without demanding another decision.
- Define a group initially as a shared collection for asynchronous practice. No live classroom synchronization, chat or group video calls are required.
- Define initial export as learner-camera video. Its audio behavior must be explicit: retain the current video-only capture for the initial export milestone. Sound capture, source music and comparison-video composition are separately scoped extensions, not implicit promises.
- Define public content as the accepted 3D move plus approved public metadata and a safe preview. Original uploaded footage is private unless the creator separately chooses an expressly supported source-sharing feature.
- Observe the proposed flow with a small representative pilot, including casual users and one instructor. Record confusion and revise the layouts.

### Exit gate

Every core task has a complete phone path, clear ownership/audience and a recovery path. The designs do not require a section editor or Studio for ordinary sharing or saving. Establish device/performance budgets from real devices before calling the release mobile-ready.

## W1 — Add acceptance, audience and ownership foundations

Purpose: support the simple interface with explicit domain rules, before changing what users can share.

### System work

- Add a revision-bound acceptance record: move/revision, accepting owner, time, the quality warnings that were shown, and the outcome. Track conversion readiness independently. Later edits that change the actual reference require acceptance of the resulting revision before new distribution.
- Model an accepted shareable release separately from the owner's working revision. Sharing points to an exact accepted revision; private edits never silently change what recipients are following.
- Introduce independent audience grants for people and groups, plus an explicit public listing state. Support several friends and groups on one move without copying or reconverting motion assets.
- The current schema stores one grant per (move, account) with a single `source` and link `generation`. Independent reasons therefore need separate reason records (direct, group, public) or evaluation outside that row; accepting a group or public reason must not overwrite or revoke an existing direct invitation/link grant. Preserve link generation, rotation and expiry semantics exactly.
- Keep one authority for "the version recipients follow". `Lesson.published_revision_id` already serves that role; add acceptance without creating a second competing "current shared version" field, and state explicitly whether that column continues to point at accepted releases.
- Treat group membership as one access reason and direct invitations as another. Authorization evaluates all active reasons, with owner archive/operator disablement taking precedence.
- Keep collection placement separate from access. Adding a public move to a private group's collection does not make that move private; removing direct friend access cannot remove access that still exists through a group or public listing.
- Define asset exposure profiles for owner, authorized recipient and public visitor. Public responses omit private source media, source identifiers, private thumbnails, invitations, account email and attempt history.
- Keep capture, local takes, optional account summaries and shared reference content as distinct resources. Exporting a learner's camera-only take must not silently upload it or distribute it with the move.

### Migration and compatibility

- Use additive migrations and a compatibility layer around the existing `Lesson`, revisions, grants and publication APIs. Keep the current learning manifest/playback contracts unless a versioned extension is necessary.
- Preserve existing published revisions and their existing audiences. Treat those publications as legacy accepted releases: no separate acceptance record exists in the current data model, so do not invent one, and do not manufacture acceptance for private drafts.
- Existing private moves remain private. Existing link lessons remain link-access lessons, not public listings. Keep token expiry/rotation/revocation semantics until an explicit migration changes them.
- Make all create/accept/share requests idempotent and revision-checked. Concurrent edits return a recoverable conflict instead of sharing the wrong version.
- Evaluate central permissions for manifests, assets, receiver pairing and summary APIs. Do not introduce a separate, weaker permission implementation for public/group screens.

### Exit gate

Migration fixtures prove that no existing audience is broadened. Permission tests cover multiple simultaneous access reasons, archived/disabled content, accepted versus draft revisions, wrong-account requests and original-media exclusion. Old and new UI can coexist during rollout.

## W2 — Deliver Add video → Check → Accept → Try

Purpose: complete the creation journey with minimal decisions.

### UX work

- Split upload into short steps: choose clip, optional trim, Create 3D move. Suggest a name; permit renaming after creation. Hide numeric timing precision under Adjust. A cleared name is valid: assign a neutral server-side fallback and never gate conversion on naming.
- Show one persistent processing card across the upload screen and My moves. Use meaningful language such as Uploading, Preparing your 3D move, Ready to check and Try again.
- When processing finishes, show a clear Check your move action. Never interrupt an active recording/practice session with automatic navigation. The card must survive its ready state; today `ready_for_review` rows are filtered out of the list and the user only sees a silently refreshed library card.
- Check your move opens a large 3D preview, source comparison, playback and viewing-angle controls. Looks good is primary. Adjust clip, Choose another video and More adjustments are secondary.
- Explain a reconstruction problem honestly. Timing/section editing cannot repair incorrect body geometry; changing the clip or regenerating is the appropriate alternative.
- Looks good records acceptance of the exact revision and leaves the move private, then shows Try it now and Share. Until sharing phases are enabled, show only functioning destinations.

### System work

- Add stable deep links/routes for processing, review and accepted moves. Browser Back, refresh, sign-in return and cross-device reopening must resolve to the right state.
- Reuse resumable upload and conversion jobs. Cancel/retry/back must not cause duplicate processing or external-provider charges. Recovery may require reselecting the original local file; do not promise unrestricted background upload on phones.
- Persist acceptance centrally. Metadata changes such as title/tags do not require a new inference run. Clip regeneration creates an isolated processing attempt and preserves the previous accepted move until replacement is confirmed.
- Make clip replacement lesson-scoped. Conversion finalisation currently always creates a new move, so naively re-uploading duplicates the library item; add a replacement attempt that produces a new revision for the existing move and keeps the previous accepted release until the new one is accepted.
- Permit an empty working title. `lessons.title` is required today; define a neutral fallback and treat rename as metadata that never enqueues processing.
- Keep background completion discoverable through the in-app card; notifications are optional and separately activated.

### Exit gate

A phone user can create and accept a move without opening the section editor. Refresh during processing and return after sign-in preserve the destination. Duplicate taps cannot accept/share another revision or enqueue duplicate conversion. Poor results have a usable recovery path.

## W3 — Deliver Record a take → Watch → Save video

Purpose: complete the casual user's tangible outcome before expanding social features.

### UX work

- Promote Record a take out of settings into the practice entry/transport. Keep ordinary camera-free watching and unrecorded practice available.
- Reuse camera readiness and countdown. Starting a take is deliberate and clearly indicated, with an always-reachable Stop action. Recording depends on an active camera and completed height calibration; make the disabled state say so and offer Enable camera.
- After completion or manual Stop, present a bounded take-review state with Watch my take, Save video and Try again. Keep detailed scoring secondary and optional for the casual path.
- Preserve a usable partial take after an interruption where possible, identifying it as partial. Do not require successful scoring or exact section completion to save a recording.
- Starting another take or leaving with an unsaved take offers Save first, Keep draft when supported, or Discard. Do not overwrite the previous unsaved take merely because practice restarts.

### Capture/export system work

- Replace the single disposable object-URL lifecycle with a bounded take resource carrying capture format, timing map, revision reference, duration, size and status. Keep camera-owned recording independent of audience/publication.
- Implement a save/export state machine: recording, finalizing, preview-ready, preparing-file, ready-to-save, handed-to-device, failed/discarded. A browser handoff is not proof that a file reached Photos/Gallery; use accurate success text.
- Fix explicit take limits rather than inheriting today's silent 2-minute / 32 MB stop; show remaining time while recording, finalize at the limit with an explanation, and never truncate without telling the user.
- Detect file-sharing capability before offering the share sheet (for example `navigator.canShare` with files) and keep download as the fallback. On iOS, saving to Photos is a share-sheet action, not a guaranteed download; word the result accordingly.
- Export a neutral filename and minimal metadata: no account email and no private move identifiers.
- Prefer a broadly playable format when the device can produce it, offer the supported share/download path, and provide a clear fallback. Do not promise universal MP4 output from every browser recorder.
- If broader compatibility needs server transcoding, make upload of the learner's take an explicit choice. Use separate bounded export jobs/private temporary assets; apply retry, cancellation and expiry without re-running 3D inference.
- Keep microphone capture off for this milestone and describe the video-only output. Countdown/metronome output is not automatically a soundtrack.
- Support same-device recovery using browser storage only where practical, with quota/error handling and deliberate discard. Do not promise recovery after browser eviction, device cleanup or a crash before data was persisted. Scope recovered drafts appropriately to the user on shared devices.
- Maintain capture-to-reference timing metadata for replay, including speed changes and interruptions. Either record a time map or deliberately finalize a take before a timing-mode change.
- On source-access revocation, keep an existing learner-only video available to its learner. Any export containing instructor/source content must use the relevant authorized content policy and current permissions.

### Exit gate

Actual target phones and desktop browsers can record, manually stop, preview and save a playable file. Validate duration, rotation/reflection, timing, file size and stated audio behavior. Test cancellation, leaving/replacing a take, backgrounding, storage pressure and recording errors. The no-scroll practice contract still holds. No silent recording upload occurs.

W2 and W3 together form the first release milestone: the entire personal creation-and-video-saving loop works on a phone.

## W4 — Simplify sharing with individual friends

Purpose: make sharing a normal social action while preserving precise access.

### UX work

- Replace the everyday publish dashboard with a short sharing sheet. Friends is the first enabled audience; groups and public appear only when implemented.
- Allow selecting known people or entering an invitation address. Phone contact access is not required. Show the selected recipients and accepted move preview before sending.
- Hide revision terminology, participation counts, publication generations and learner management from this path. Show a readable audience summary and a small Manage access action.
- Provide device sharing/copying for an appropriate invitation link without confusing delivery with permissions. Distinguish person-bound invitations from an optional Anyone with the link mode; the latter is not named Private friends.
- Make the recipient flow short: open invitation, sign in with the intended identity when needed, accept, Try this move. Preserve the invitation across verification and return navigation.
- Show public previews without sign-in only for content designed to be public. Private invitation metadata must not become an anonymous information leak.

### System work

- Reuse hashed, expiring invitations and account-bound acceptance. Separate reviewed-content confirmation from recipient selection; the owner accepts the reconstruction once, while a concise permission-to-share confirmation remains at the meaningful sharing action.
- Make access grants idempotent per audience/release. Add the notifications/delivery transaction boundary required to show Sent, Pending or delivery failure accurately. Today the invitation row is committed before mail is attempted and a failed send leaves a revocable pending invitation; email delivery is not proof of receipt, so label states accordingly.
- Casual sharing does not automatically create a teacher participation dashboard. Preserve existing Studio reporting under its disclosed policy; do not silently erase historical activity or change recipients' privacy expectations.
- Updating the shared move is an explicit action against another accepted revision. Display an ordinary update notice to recipients instead of exposing revision IDs.

### Exit gate

An owner invites one or several friends entirely on mobile. The right recipient reaches practice; a wrong account cannot open a private invite. Delivery errors and expired links have clear recovery. Access removal works, with remaining group/public access explained when applicable.

## W5 — Add simple groups and shared collections

Purpose: let people practise the same moves together without introducing a classroom product.

### UX work

- Add Groups navigation when functional. Group creation requires a name and optional image/description, then invites.
- Initial roles: owner, optional admin and member. Keep the everyday UI focused on Members, Moves and Add a move.
- The owner chooses whether all members or only admins can add moves. Adding someone else's private move requires its creator's sharing permission; it is not an implicit copy or re-share right.
- Share to a group selects existing groups, with Create group available in the same phone flow. Show who in the group will be able to open the move.
- Group members can open a move, practise and save their own take. No performance upload, leaderboard, chat or scheduled live room is required.
- Keep leaving a group, removing a member and removing a shared move usable on mobile.

### System work

- Add group, membership, invitation and group-move association records. Motion data remains owned by its creator and referenced by accepted release; group collection entries do not duplicate assets. Keep the two group ideas distinct: sharing a move to a group creates an access reason for its members, while adding an already-public move to a group collection is presentation only and grants nothing. Do not conflate them in schema or UI.
- Membership acceptance, expiry, owner/admin operations and concurrent invitations need explicit transaction rules. Removing an association does not archive the creator's move.
- Re-evaluate group authorization on every protected read. A removed member loses that access reason promptly, while other legitimate direct/public access remains effective.
- Prevent orphan ownership: an owner leaving must transfer ownership to an accepting eligible member or explicitly close the group under a defined retention policy.
- Group presence or membership does not broadcast camera frames, scores, calibration, recordings or live playback state. Existing paired-display sessions remain single-learner sessions.

### Exit gate

Users create, invite, join, contribute where allowed, practise, remove access and leave on a phone. Tests cover simultaneous membership changes, ownership transfer, duplicate membership, private re-sharing, overlapping access reasons and creator archive/revocation. No group operation makes a move public.

## W6 — Add public moves, tags and Explore

Purpose: support deliberate public sharing and useful discovery without requiring a social network.

### UX work

- Enable Public in the sharing sheet. Show a preview of exactly what a visitor will see, the creator's public name and a concise Everyone can view explanation.
- Require a title and a small number of useful tags; offer suggestions for movement type, style and level, with creator review. Keep private users free of public-profile setup.
- Use a public display name/handle, never the account email as attribution. Set up this identity inline the first time it is needed.
- Add Explore with search, tag filters and a simple recent/curated collection. A personalized recommendation system is unnecessary for the first public release.
- Public detail offers Watch and Try this move. Saving to a personal collection can require sign-in; public viewing need not expose sign-in barriers meant for private invitations.
- Provide reporting, hiding/unlisting and public-profile management through straightforward actions. Public sharing of learner performances remains outside this release.

### System work

- Build public listing/tag/profile records and an explicit publication state. Only an accepted revision with the approved public asset projection can be listed.
- Require the existing permission-to-share confirmation plus an explicit public-distribution rights acknowledgement before a move can be listed. The acknowledgement is per release, not per tag edit, and tag/title changes never enqueue conversion.
- Bound tag count and length, normalise them, and reject tag-only spam. Do not launch public listing for accounts primarily serving minors until an audience, guardian and school policy exists, consistent with the earlier release conditions.
- Produce public-safe thumbnails and manifests. Never expose private uploaded source video or a source-image thumbnail simply because the internal lesson manifest references it. Private lesson asset endpoints stay protected.
- Use bounded, paginated public queries with indexed tags, listing state and ordering. Start with deterministic search/filtering; introduce a separate search service only if measured scale justifies it.
- Extend existing moderation/reporting for public content. Owner removal or operator disablement must withdraw public detail, search entries and asset authorization consistently, including cache invalidation. Already downloaded media cannot be recalled.
- Public listing visibility and protected friend/group access remain separate. Turning public off must not inadvertently delete valid private grants. Explain that an otherwise public move remains viewable despite removal from a private group.

### Exit gate

A mobile creator can publish with tags, and another person can find/watch/try it. Inspection confirms that public responses contain no source media, account email, invitation secrets, activity reports or learner takes. Unlisting, disabling, tag edits and private/public transitions behave consistently across discovery and media delivery.

## W7 — Reorganise advanced tools into optional Studio

Purpose: retain the existing investment while simplifying what casual users encounter.

### Deliverables

- Add an explicit Enable teaching tools entry in account settings. It reveals Studio navigation; it does not create another identity or change ownership.
- Place detailed section/boundary editing, revision comparison, publication administration, large access tables and participation reporting inside Studio.
- Keep basic trimming, rename, preview, acceptance, friend/group sharing, public tagging, simple group management and access removal in the everyday phone experience.
- Desktop Studio provides roomy editing and management layouts. On mobile, offer compact essential management and a clear Open on desktop handoff for precision/bulk work. Persist selection/drafts where supported; do not promise that one device can retrieve another device's unsaved local recording.
- Preserve existing teacher-owned lessons, published snapshots, accepted invitations, progress and reporting disclosure. Enabling/disabling Studio changes navigation, not content visibility or access rights.
- Preserve one shared Mimic Interface, playback/session controller, manifest adapters and permission engine. Do not fork casual and business camera/scoring implementations.

### Exit gate

A casual user completes the entire journey without encountering a Studio dashboard. An existing instructor can still find and use all established advanced capabilities. A viewport/device change cannot grant administrative access or hide essential privacy controls.

## W8 — Qualify the complete journey and release gradually

Purpose: verify ease of use and the new access/export behavior as a whole.

### User acceptance

- Observe at least five first-time casual users and representative group/Studio users. Proposed pilot gate: at least four of five casual users complete upload → accept → record → save without verbal guidance; all can identify the current audience and find Stop/Save.
- Exercise friend and group invitation journeys from a fresh phone browser, including authentication/verification, expired invitations and returning to the intended move.
- Confirm that no casual task requires desktop access, section editing, business terminology or activation of saved scoring/history.

### Device and engineering acceptance

- Complete real iPhone Safari and Android Chrome checks using front and rear cameras, portrait/landscape, browser chrome and keyboard changes, permissions, background/resume and sustained practice.
- Test desktop browsers, paired receivers and the actual mirrored-TV setups being supported. Distinguish a demonstrated OS-mirroring path from an app-managed receiver or unimplemented native TV integration.
- Test 200% text enlargement, keyboard navigation, screen-reader announcements, contrast, touch targets and no-scroll practice controls. Record actual results and resolve failures instead of treating viewport screenshots as device proof.
- Measure time to a usable preview, processing completion, camera feedback latency, take finalization/save, memory use and sustained heat/battery behavior against W0 budgets.
- Run authorization/migration/concurrency tests against real PostgreSQL and private storage: multiple access reasons, revision races, invitation replay, public-safe media, member removal, moderation and pairing revocation.
- Verify operation and recovery: conversion/export interruption, storage exhaustion, notification failure, stale clients, restore from backups and publication rollback. Use explicit consent for any optional telemetry; do not collect recordings to measure funnel completion.
- Verify that title, tag, audience and publication changes never re-run conversion and never create, replace or revoke acceptance; only a new or replaced reference revision requires a new acceptance.

### Rollout

- Release through capability flags: acceptance flow, take export, friend sharing, groups, public discovery and Studio navigation.
- W2/W3 can launch as a personal-use milestone; add W4 friends, W5 groups and W6 public sharing as each passes its own gates. Public controls do not appear before public asset protection and moderation work.
- Rollback hides/reverts presentation while preserving acceptance and permission records. Previously public assets require explicit withdrawal/cache handling; disabling a button is not sufficient access revocation.

### Final exit gate

Everyday tasks work end to end on actual target phones and desktop, existing teaching features remain available, and the audience shown in the UI matches effective backend access. Unverified device/export/coaching capabilities remain labelled or disabled.

## 5. Implementation map

| Existing area | Planned responsibility |
| --- | --- |
| `LibraryApp.tsx` | Everyday navigation, stable destinations, accepted/pending move cards and optional Studio entry |
| `CreateLesson.tsx` | Short upload/trim flow and resumable processing recovery |
| New move-review surface; existing `LessonWorkspace.tsx` | Simple acceptance preview separated from advanced section editing |
| `PracticeWorkspace.tsx`, `MimicInterface.tsx`, shared learning engine | Direct recording entry, take review and preserved practice behavior |
| `usePracticeRecording.ts`; new take/export service | Safe take lifecycle, timing metadata, explicit save and optional recovery/transcoding |
| `ShareLesson.tsx` and new group/public surfaces | Friendly audience selection and appropriate access management |
| `permissions.py`, sharing routes and additive migrations | Central audience/revision/asset policy and backward compatibility |
| `apps/api/database.py` and migrations | Acceptance records, independent audience reasons, groups, public listing/tags/profile |
| Existing worker/provider pipeline | Reused motion conversion; no inference rerun for metadata or recording exports |
| `apps/api/conversions.py` | Clip replacement targeting an existing move instead of creating a duplicate lesson |
| Existing API/infrastructure/browser tests | Extend for acceptance, audience combinations, saving and public projections |

These are responsibilities, not a requirement to put all new UI into the existing large files. Extract focused route components and services as the work proceeds.

## 6. Dependency order and prioritisation

| Phase | Depends on | Main uncertainty/complexity |
| --- | --- | --- |
| W0 | Existing implementation review | Usability and real-device constraints |
| W1 | W0 contracts | High: backward-compatible permissions and accepted revisions |
| W2 | W1 acceptance foundation | Moderate: resumable navigation and asynchronous recovery |
| W3 | W2; W0 device experiments | High: browser capture/save formats and interruption recovery |
| W4 | W1 and W2 | Moderate: invitation delivery, identity return path, familiar sharing |
| W5 | W4 | High: group ownership, membership and overlapping access |
| W6 | W1 and W4; preferably W5 | High: public asset separation, discovery and withdrawal |
| W7 | W0; final integration after W4–W6 | Moderate: preserving instructor workflows while moving entry points |
| W8 | Begins at W0; final pass after W2–W7 | Real-device, human usability and operational evidence |

Recommended delivery sequence: **W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → final W8 qualification.** Device testing begins in W0 and continues throughout. Studio terminology cleanup can happen incrementally, but its final navigation must reflect the actual delivered capabilities.

Estimate calendar effort after the W0 capture/export experiments and W1 permission design; browser video saving and public-media protection should not be treated as small wording changes.

## 7. Scope boundaries

Required for this refinement: mobile creation/acceptance, friendly sharing, real groups, deliberate tagged public moves, practice/record/save, and preservation of advanced teaching tools.

Separate later decisions: learner-performance publishing, messaging/chat, live group classrooms, leaderboards, paid course marketplaces, source-music soundtracks, social-video imports, native TV receiver apps and validated technique/rhythm coaching. None is a prerequisite for the casual phone journey described here.

Completion means a user can perform the whole intended journey and recover from its ordinary failures. A set of responsive screens or renamed buttons alone is not completion.
