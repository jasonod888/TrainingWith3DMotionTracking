# Phase 7 software correction review — CHANGES REQUIRED

Reviewed 14 November 2026. Commit `f00680526b2ec5dc7a7839b6bf599c65a2c0b9d5`, branch `phase7/normal-route`.

**No Phase 7 GO. Phase 8 remains stopped.** The two prior settings probes pass, but the newly introduced verification integration has reproduced data-integrity defects. The committed revision editor also does not match the reported loader/navigation changes. This is not yet a hardware-only block.

## Independent checks

| Check | Result |
| --- | --- |
| Existing settings reload/recovery probe | Pass: Corrected section / notes restored |
| Existing passage-map coherence probe | Pass: incompatible relabelling is refused, kind remains playing |
| TypeScript | Clean, exit 0 |
| New verification browser cases | **0/3 pass**, normal exit 1 |
| Web 471 / Phase 6 6+8 / full editing and normal-route scripts | Developer-reported this review, not independently repeated |

The passage result verifies a safe rejection, not a completed passage editing feature. Keep this limitation visible; do not describe all passage editing as supported.

Verification diagnostic: `docs/qualification/piano-workspace-phase-07-review/check-verification.py`, results `verification-results.json` alongside it. It drives the real normal-route workspace and real verification parser using controlled report/decision responses and the tracked 20-occurrence fixture. It makes no live server decision or real lesson mutation. Run from the repository root with `.venv-saas/Scripts/python.exe`, Vite at 127.0.0.1:5173. These fixtures establish client behaviour, not real-backend acceptance coverage.

## V1 — verification findings are not atomic (high)

Location: `PianoWorkspaceHarness.tsx`, `applyFinding`, especially the local `run` helper and merge/split branches.

Every command is preflighted against the same original `document`, then individually dispatched against the evolving reducer state. Rejected commands are silently skipped. A whole finding has neither an all-or-nothing result nor one coherent history transaction.

Browser reproduction: accept a legitimate merge of duplicate attacks fx-08/fx-09 at 2 s. Starting count **20** becomes **18**, while the controlled server decision contains **19**. Both source notes were deleted and the merged replacement is absent. Insertion was checked against the original document, where a same-pitch/same-onset note still existed, so it rejected after deletes had already been dispatched.

Required:

- Stage the complete finding against an evolving candidate document, validate every operation, and commit one atomic result/history entry only when all operations are representable.
- A rejection must preserve the original document, selection, IDs and history; surface its reason. Disable unsupported operations honestly until safely supported.
- Preserve server-defined occurrence IDs and relevant metadata. The existing server/working-edit contract uses deterministic `vf-*` IDs for inserted/merged/split notes; generic `insert-note` currently generates unrelated authored IDs. Do not silently accept a different performance identity than the decision response.
- Pass explicit written placement through the current alignment; do not reintroduce tempo-only score placement for verification insertions after explanations/anchors.
- Test merge, split and compound findings where a later step fails, plus undo/redo and save/reopen. No partially applied decision may be labelled successfully applied.

## V2 — stale finding overwrites manual corrections (high)

The new translator ignores each edit's `before` snapshot. The existing `working-edits.ts` contract checks relevant fields before applying a proposal; the new integration bypasses that protection.

Browser reproduction: proposal says pitch **60 -> 62**. Manually correct the working note to **61**, then Accept. The workspace changes it to **62** without reporting the conflict.

Required: compare finding preconditions with the current live document before accepting/applying. Reject or explicitly resolve overlapping local changes; preserve unrelated authored work. Revalidate after asynchronous decision responses too: the callback captures the document from the click, while the user can continue editing during the request. Do not approve a server decision and then quietly skip a local edit it cannot represent. Test local same-field edits, unrelated edits, in-flight changes, stale report/token, and unsupported voice allocation.

## V3 — Accept -> Reject does not reconcile the working document (high)

Browser reproduction: Accept changes pitch **60 -> 62**. Reject updates the diagnostic decision; the controlled server state returns pitch **60**, but the working note remains **62**. `decideFinding` only applies local edits for `accepted`; rejected decisions do not reconcile/revert.

Required: implement guarded decision transitions, including Accept -> Reject/clear where supported by the API, repeated acceptance, existing decisions on initial load, and concurrent decisions. Preserve manual changes made after acceptance; never blindly overwrite the document with a returned event list or rebuild authored notation. Maintain an explicit conflict/reconciliation state when necessary and prevent an inconsistent save from being presented as complete. Test decision history separately from musical undo so either action cannot silently disagree with the server.

The conflict reload path also needs to reconcile the token deliberately: it updates the displayed verification state but not the save token. Define when that token can safely advance after examining live local work, rather than allowing repeated unexplained save conflicts.

## V4 — revision-path claim is not present in this commit (required)

`MusicLessonEditor.tsx` still fetches the reference, hashes/parses it, builds piano notation and creates the `notes` array before mounting `PianoWorkspaceHarness`. The piano render is still gated on `manifest.subject === 'piano' && notation`. It has not stopped after loading the manifest.

`refreshReviewed` now returns a parsed manifest, but the piano `onSaved` callback calls `void refreshReviewed()` and ignores that return value. There is no await followed by a live dirty/signature check or navigation completion in that path. The old app callback is consequently not reached by this piano refresh. The handoff's claim that revision navigation waits and re-checks live dirty state does not match the committed implementation.

Required: implement the intended shared loading/controller boundary and explicit safe post-save behaviour, or correct the design/handoff to a deliberate stay-mounted editor with a working exit/preview flow. Then drive **library -> private revision editor -> revision POST with exact base_revision_id -> save/reopen**, including delayed POST and delayed manifest refresh with newer edits. Check access/release semantics and preserve settings. Do not mark C4 resolved from a review-URL saved-reference load.

## Remaining settings validation

The happy-path recovery fix is confirmed. Still qualify the full section contract: `readRecovery` currently permits gaps, does not enforce first start=0 or final end=clip duration, and does not check duplicate section IDs. Shared-boundary controls clamp against the clip rather than both adjacent sections, allowing a boundary to collapse/invert a neighbour. Use the actual section invariants consistently and add boundary/split/remove/invalid-checkpoint tests. Do not rely on a later server rejection to make settings valid.

## Qualification still outstanding

- Physical touch qualification remains BLOCKED until hardware is available; it cannot be replaced by synthetic PointerEvents or a computed sticky style.
- Loaded-video qualification is a separate software test that can run in a desktop browser with a valid local video fixture. Lack of a physical touch device does not block testing play/pause/seek/rate/end, the single clock, both cursors, loaded-media performance and the original header-overlap issue.
- Keep reporting mocked dev-server timing as such. Provide the previously requested upper-bound/interactive evidence before treating performance as qualified.

Fix V1-V4 and the remaining validation/evidence gaps, retain the passing settings and Phase 6 checks, then submit the actual revision journey and video qualification. If only physical touch remains after that, submit a clearly bounded hardware-only block for the owner/device lab. Phase 8 still waits for final Phase 7 acceptance.

No product code, Git branch, commit, publication or real server data was changed during this review.
