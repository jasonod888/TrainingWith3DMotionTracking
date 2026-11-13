# Piano correction workspace — Phase 2 acceptance

Reviewed: 13 November 2026.
Accepted code: `d461b16bea504e7bfecb36685831fc64fbae0bf5`.
Decision: **GO — Phase 2 accepted; Phase 3 may begin.**

This supersedes the CHANGES REQUIRED decisions for `35b27e2` and `a42294c`. Approval covers the isolated correction foundation and authorises the next layout/viewport phase only. It is not approval for production replacement, persistence, deployment or publication.

## Independent verification

- Inspected the correction commit and actual changes to scope validation, authored-spelling preservation, transaction selection and retained-history accounting.
- Reran the original reviewer reproducer: **8/8 PASS**, including the corrected occurrence-scoped accidental invocation and checks for both the target and untouched occurrence.
- Reran the follow-up reviewer reproducer: **3/3 PASS**.
- Reran the focused correction-command/reducer suites: **49 passed, 0 failed**.
- Ran TypeScript checking: **passed**.
- Reran the complete web suite: **388 passed, 0 failed** (approximately 7.4 seconds on this run).
- The focused real-size synthetic test retained 19,484 bytes of patches for 20 edits versus a 1,416,868-character document; approximately 811 ms for the edit loop on that run. It does not constitute a physical-device or heap-memory benchmark.
- Did not rerun live browser captures, the actual-recording benchmark, API suites or production build during this acceptance. No backend files changed in this correction. Existing browser/real-recording evidence remains developer-reported and is not relabelled as independently rerun.

## Gate decisions

| Requirement | Accepted behaviour |
| --- | --- |
| Note-only versus event-wide edits | Scope and target pairing enforced by discriminated type and runtime rejection; a note-only request cannot silently become whole-chord editing |
| Same-key pitch selection | Unchanged pitch with omitted spelling preserves authored enharmonic spelling and creates no edit/history entry |
| Selection with undo/redo | Compact before/after selection retained per patch; undo restores transaction-start selection and redo restores transaction-end selection, revalidated against the corresponding document |
| Occurrence correction | Accidental and pitch edits target occurrences; mappings split or reject rather than modifying repetitions implicitly |
| Time and written value | Recorded seconds remain separate from written duration; performance-only timing/length edits do not claim to realign the engraved score |
| Failure/no-op behaviour | Reviewed invalid-input and no-op regressions pass; no collateral deletion through ordinary correction commands |
| History | Patch-based history, undo/redo retention reported separately in UTF-8 bytes; oversized-single-patch retention explicitly documented |
| Existing workflows | Legacy editor remains isolated; no ordinary review replacement or new persistence claim |

No outstanding blocking findings remain for the Phase 2 gate. This does not imply every future gesture, alignment case or notation edge case is qualified.

## Phase 3 instruction

Implement **Phase 3 only** from `docs/piano-correction-workspace-phases.md`:

1. Keep the isolated harness/feature boundary and the approved command/controller foundation.
2. Arrange keyboard above the readable piano roll and continuous horizontally scrollable grand-staff strip, with the smaller reference video and inspector alongside.
3. Default to approximately 10 seconds visible in the roll; provide zoom, fixed context/rulers and whole-clip overview rather than fitting the full recording into one viewport.
4. Cull/virtualise the long roll/score and keep corresponding selection discoverable. Prepare shared viewport interfaces without claiming the full Phase 4 alignment/playback/linked-follow behaviour.
5. Provide desktop and narrow-screen evidence, real long-example rendering and measured viewport behaviour. Keep page-level horizontal overflow absent, and one video/one document authority.

Do not migrate the normal production review or reviewed-save routes prematurely. Complete playback/alignment, persistence and full editing gestures at their respective gates; normal workflow integration remains Phase 7. Stop after the Phase 3 submission for review before Phase 4.

Only this acceptance record was added by the reviewer; no product implementation was changed.
