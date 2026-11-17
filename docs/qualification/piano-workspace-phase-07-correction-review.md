# Phase 7 correction review — CHANGES REQUIRED

Reviewed 14 November 2026. Submission `6aa4747b934761267a09508f5025040a0ca1143a`, branch `phase7/normal-route`.

**Phase 7 is not accepted; Phase 8 remains stopped.** This is progress on the integration defects, but it is not yet a hardware-only block. New settings need recovery/alignment fixes, and previously requested verification and revision-entry work is still incomplete.

## Independently confirmed progress

| Check | Result |
| --- | --- |
| Normal-route workspace stylesheet | Pass: stylesheet loaded, grid display, green note fill |
| App Form home after pitch edit | Pass: confirmation appears, dismiss retains workspace |
| Saved-only review entry with draft 404 | Pass: shared workspace opens saved reference |
| TypeScript | Clean, exit 0 |
| New settings recovery/map checks | **0/2 pass**, normal browser-run exit 1 |
| 471-test suite / Phase 6 probes / full submitted route script | Developer-reported this round; not independently rerun |

The first three checks are from `piano-workspace-phase-07-review/check-integration.py` and `integration-results.json`. The diagnostic's draft-load count is informational; development StrictMode may repeat loads, so it is not an exact-count gate. Its older note describing parent/child state applies to the previous implementation; review the new mode dispatcher separately from the still-duplicated revision editor.

New checks: `piano-workspace-phase-07-review/check-settings.py`, with results in `settings-results.json`. Run from repository root using `.venv-saas/Scripts/python.exe`, Vite at 127.0.0.1:5173. Controlled API routes and the extracted long draft; no real lessons were changed. An initial run had an ambiguous test locator for two playhead elements; the corrected script targets the alignment readout specifically and completes with two failed assertions.

## C1 — recover the new persisted settings (high)

Browser reproduction: open normal review, rename the teaching section to **Corrected section**, choose MIDI assessment (`notes`), wait for the checkpoint, reload and Restore local checkpoint.

Actual restored values: **Whole lesson / none**. The edited section and assessment are lost.

`workspaceSignature` correctly includes `sectionsDraft` and `assessmentPolicy`, but `writeRecovery` and `RecoveryCheckpoint` do not. Neither restore path restores them. A recovery banner therefore offers an incomplete snapshot of the edits the app marks as recoverable.

Required:

- Extend the versioned checkpoint with validated teaching sections and assessment, including matching/older-base restoration and retained save-failure work.
- Preserve compatibility with older checkpoints explicitly; do not silently treat missing new fields as recovered edits.
- Test settings-only edits, mixed note/settings edits, reload, failed save, delayed save and saved-only revision recovery. Restore must reset confirmation and stay dirty until the full restored state is saved.
- Verify settings save/reopen through the actual revision manifest, not only that the panel exists.

## C2 — make passage edits coherent with score/alignment (high)

Browser reproduction after restoring a checkpoint: set the source clock to **1 s**, then change the first full-clip passage to **Explanation**. UI accepts the new kind, but the mapped cursor remains at tick **1160**, unchanged from Playing. An explanation-only clip should not continue advancing score time; alternatively an incompatible passage edit should be rejected explicitly.

Cause: `alignment = mapState ?? ...` continues to use the restored map. The new passage handlers only update `spans`; they never reconcile `mapState`, anchors or written placement. On a freshly built map, recomputing the map alone can instead leave previously engraved notes in the old score-time domain. Changing spans is not just a metadata text edit.

Required: validate and commit passage/map/score changes as one consistent operation, or reject unsupported changes with a useful explanation. Preserve exact recorded seconds and authored notation; do not silently regenerate corrections or discard anchors. Define valid transitions when a proposed explanation contains recorded notes. Exercise saved, recovered, estimated and anchored maps, playhead/seek/insertion after the change, undo/cancel policy and save/reopen. The retained two-case script permits either an honest rejection or a correctly committed map; it does not require unsafe automatic rewriting.

Teaching section and passage validity also need UI-level tests. Section boundary changes currently change only one side of a shared boundary; Remove merely drops a section and can leave a gap. Add passage after a full-length playing span creates an overlapping final second. Preserve required coverage/order through valid operations, or show clear validation and refuse commit/save; do not rely on a server 422 as the editing flow. Include first/last section constraints, shared boundaries, split/remove and held/timed passage joins.

## C3 — finish verification capability rather than marking R4 complete (required)

The disclosed absence of findings/accept/reject/concurrent-decision UI remains an unfulfilled R4 requirement. A token and 409 message do not replace the removed workflow.

Render findings in the compact diagnostic flow, preserve accepted/rejected decisions and reconcile their performance with authored notation. Test a concurrent decision during local editing and a verification conflict without losing the working document or recovery. Do not introduce a second independent event array or silently rebuild corrected notation. This is product-code work and cannot be resolved by a physical touch test.

## C4 — qualify and simplify the actual private-revision path (required)

The new initial-review dispatcher is an improvement, and versioned manifest reads address the earlier protocol defect. However, `MusicLessonEditor` still loads/parses notation and creates note/section state before returning the workspace, which then loads/parses again. Remove the unused piano editing authority from that path or pass one validated load result through the shared controller.

Drive the real library action -> piano revision editor -> revision POST with exact `base_revision_id` -> reopened revision. Assert access/release semantics, one current working document/video, settings preservation and conflicts. The review URL's saved-only load is not evidence of the library action.

Delayed-save protection must be exercised here too. The initial review now stays mounted and the callback distinguishes older submitted snapshots, addressing the reported initial-review concern. The revision wrapper still asynchronously refreshes a manifest and then calls the app's navigate-on-save callback. Test edits made both while the POST is pending and after its acknowledgement while the refresh GET is pending; the earlier `current` boolean must not authorize later navigation over newer work. Re-check live identity/signature at the navigation boundary or keep the editor mounted.

## C5 — complete hardware and loaded-media qualification (still BLOCKED)

No waiver is granted for physical touch testing. After correcting C1-C4, run the recorded device/OS/browser matrix specified in the original Phase 7 review: tap versus pan/edit, pointer loss, two-finger interaction, orientation, numeric alternatives, inspector/toolbar reachability, audition cleanup and save/recovery/navigation.

The current performance evidence remains a mocked dev-server run without playable video. Qualify loaded video playback/seek/rate, both cursors and the original header-overlap issue on the normal page. Add actual interactive timing and the planned upper-bound fixture results rather than treating DOMContentLoaded or the presence of virtualised nodes as a full performance result.

If hardware is unavailable after software qualification, submit the corrected code/evidence and leave the physical-device item explicitly BLOCKED for an owner/device-lab run. Phase 8 still requires a final Phase 7 GO.

## Resubmission

Complete C1-C4 with targeted tests and rerun the original integration checks plus the new settings checks; then provide C5 qualification or an explicit remaining hardware block. Keep developer-reported and independent results distinct. The existing Phase 6 architecture remains accepted; no library pivot or restart is requested. No product code, Git branch, commit or release was changed during this review.
