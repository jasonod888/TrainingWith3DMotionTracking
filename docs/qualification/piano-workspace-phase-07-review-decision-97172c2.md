# Review decision — 97172c2: proceed to Phase 8 development

Reviewed 16 November 2026 (Singapore).
Branch `phase7/normal-route`; submitted commit `97172c24c3014c18f4bf09a594d76d97adf5deac`.

## Decision

**GO for Phase 8 development, using this commit as the preserved Phase 7 baseline.** This applies the owner's later direction that Phase 8 may proceed while Phase 7 remains formally open. It supersedes the earlier blanket development hold for this baseline; it does not certify full Phase 7 acceptance, activate the 5,000-occurrence restriction or authorise deployment/release.

The three previously reproduced blockers were retested independently and now pass. No data-loss, save-corruption or cross-view disagreement was reproduced in these targeted checks that would prevent development of the read-only formatted score. This is a bounded development decision, not a guarantee that all editor behaviours are defect-free.

## Independent evidence on the submitted tree

| Check | Result |
|---|---|
| Approval-enabled read-only metadata | Pass: offset and assessment unchanged, clean state retained, downloaded authored state unchanged |
| Legacy API write with notation omitted | Pass: approved 5,001-occurrence write refused; temporary API test included in the eight-test run |
| Corrupted-onset verifier control | Pass: genuine pitch edit accepted, unintended +10 ms onset rejected |
| Read-only mutation families | Pass: tested offset, assessment, section add, save, anchor apply/reset and gesture; document/authored state/history/checkpoint unchanged; zero write requests |
| Read-only verification finding | Pass: finding rendered; Accept/Reject generate zero write requests |
| Saved-point eviction | Pass: exact document and saved identity restored with 499 retained entries |
| Python policy/verifier and legacy-route tests | 8 passed |
| TypeScript | Clean |
| Submitted performance JSON | All 60 path-runs inspected: sample/counter and percentile arithmetic consistent; reported commit/undo/redo/preview gates pass |

The 497-test web suite, production build, full 16-script result and fresh timing execution remain developer-reported for this review. The timing dataset was audited, not independently remeasured. DOM/frame-boundary timing is not a painted-frame guarantee. The previously blocked full-regression action was not retried or bypassed.

## Phase 7 carry-forward record — fixed, separate from Phase 8

1. **Owner approval and activation:** the reduced 5,000-occurrence/512-measure interactive policy remains inactive. Do not turn it on or deploy it without explicit approval. Production remains unrestricted, so do not describe all existing 20k data as interactively qualified.
2. **Pre-activation server policy audit:** code inspection shows review/revision guards currently use proposed count and are installed in shared music routes without a piano-only subject condition. Before activation, demonstrate that a pre-existing over-limit lesson cannot be edited by submitting a smaller candidate and that unrelated guitar behaviour is retained. Verification candidate growth/current working-state policy also needs the already-agreed boundary checks. These are inactive-policy activation conditions, not newly imposed prerequisites for formatted-score development.
3. **Hardware:** H1-H9 remain NOT RUN. The owner/device tester must perform them on the final suitable build; emulation is supplemental. Keep this isolated as HARDWARE BLOCKED, not a reason for repeated Phase 7 software-only submissions.
4. **Final acceptance:** retain the existing regression evidence and meaningful coverage of exact timing/insertion/notation scope. No complete 3x20 performance rerun is requested merely to start Phase 8. Rerun affected checks if Phase 8 changes the command/history/alignment/save implementation; perform the agreed final qualification before release.

These deferred items do not authorise data loss, broken saving or divergent note views. Any reproducible critical defect in those paths must be repaired before relying on the affected data in the final score. Do not silently delete or waive any deferred item.

## Phase 8 scope — use the original plan

Read `docs/piano-correction-workspace-phases.md`, Phase 8. Implement:

- A read-only formatted score, with wrapped systems/pages, title, grand staves and correct clef/key/time context, note values, accidentals and ties at line/page breaks.
- The **same working notation document** as correction mode. Rendering caches are allowed; no second independently editable note dataset or new transcription pass.
- Return to correction restores selection and viewport; preview switching changes no notes and loses no unsaved work.
- Preserve existing MusicXML export and label formats accurately. If PDF is provided, inspect actual pagination; printing the continuous editing strip is not a finished formatted score.
- Demonstrate a corrected pitch, written duration and spelling consistently in correction view, formatted view and export, plus saved/reopened agreement on the real recording.

Use a separate Phase 8 branch/checkpoint based on the reviewed commit so the current editor is recoverable. Do not discard Phase 7 work, migrate libraries or fold unrelated UI features into this scope. No implementation work or Git mutation was performed by the reviewer in granting this decision.

## Exact developer instruction

> Phase 8 development is authorised from 97172c2 under the owner's agreed deferral of full Phase 7 acceptance. Preserve that baseline and the carry-forward record above. Build the original read-only formatted-score scope from the existing shared document; do not reopen the entire Phase 7 optimisation exercise. Demonstrate correct score/export/correction agreement and preserved editing state. Keep the reduced limit inactive, hardware qualification open and deployment unauthorised. Submit Phase 8 with its focused evidence and the unchanged explicit Phase 7 carry-forward status.
