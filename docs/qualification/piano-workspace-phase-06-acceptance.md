# Phase 6 acceptance — GO for Phase 7

Reviewed: 14 November 2026.
Accepted commit: `0dee2e0c4fe0ef88048d9ee7729150a911c8fb71`.
Branch: `phase6/visual-editing`.

**Decision: GO. Phase 7 (normal review workflow integration and device qualification) may begin.** This approves the visual-correction phase on the identified tree; it does not approve deployment, publication, Phase 8, or adoption of another library.

## Independent evidence

| Check | Result |
| --- | --- |
| Code review against correction items F1–F6 | Addressed at the isolated-workspace phase boundary, with focus integration explicitly required below |
| Reviewer Chrome correction script | 6/6 pass; normal exit 0 |
| Broader submitted editing script rerun in installed Chrome | Pass; normal exit 0, no failed assertions |
| Independent TypeScript check | Clean; exit 0 |
| Original eight reviewer component probes | Developer-reported 8/8; not independently rerun in this review |
| Complete web suite | Developer-reported 471 pass; not independently rerun in this review |

The browser runs use controlled API routes. They are workspace integration evidence, not authenticated live-backend saves. No real lesson was modified. Server persistence contract evidence remains the previously accepted Phase 5 evidence.

Reviewer commands, from repository root unless stated otherwise:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-06-review/check-correction.py
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-06-review/check-submission.py
# From apps/web:
& 'C:/Program Files/nodejs/node.exe' node_modules/typescript/bin/tsc --noEmit
```

The wrapper uses installed Chrome because the Playwright-managed Chromium binary is absent here; it redirects captures instead of overwriting the developer's submitted captures. Independent results are in `piano-workspace-phase-06-review/correction-results.json` and `browser.json`. Prior limitations on additional Node test execution are not counted as passing test evidence.

## Verified outcomes

- **Independent durations:** 0.25-second recorded length with a half-note choice produces 960 written ticks; recording and notation remain separate.
- **Replacement/history:** Ctrl+Z does not modify the selected attack while Replace is active.
- **Written-position scope:** default note scope leaves the other chord member at tick 1920, rather than silently moving it to 2160. Unsupported note-scoped chord moves reject explicitly; Whole written event is a deliberate separate choice. Unapplied field state is rebound to selection.
- **Offset boundary:** placement requiring negative stored onset does not insert; note count remains 4.
- **Pointer ownership:** foreign pointer release leaves committed pitch unchanged. Commit/cancel entry points now guard the pointer id, in addition to global handlers.
- **Sheet gesture:** candidate head moves from cy 84 to 79; the broader script confirms C4 -> D4 committed, with Escape and other gesture checks still passing.
- **Other correction journeys:** pitch/time drag, recorded-length resize, explicit keyboard replacement, ghost insertion, duplicate warning, accidentals versus enharmonic respelling, chord isolation and overlap picker all pass the browser checks.
- **Long-data round trip:** the controlled 1,338-note draft saves and reopens the bp-1 pitch correction 69 -> 72, with unchanged count and exact target onset. The script compares every unrelated submitted performance event with its original and finds no differences. This is structured value equality, not a literal serialized-byte comparison.

## Accepted limits and Phase 7 requirements

The following are not reasons to reopen Phase 6, but they must be handled honestly in integration:

1. **Keyboard focus ownership:** `workspaceActive` currently becomes true after a pointerdown inside the harness and never resets on an outside click/focus transfer. The key handler also calls preventDefault before checking ownership. That is limited in a full-page isolated harness, but is insufficient when integrated with other controls. In Phase 7, derive ownership from actual focus/active surface, support keyboard-only entry, release it on focus transfer, and do not consume shortcuts belonging to unrelated UI. Verify Delete/Backspace, Ctrl/Cmd+Z and redo, typing/contenteditable controls, and dialogs.
2. **Real device qualification:** mouse-driven pointer evidence does not establish physical touch usability. Phase 7 must verify actual touch pan/edit separation, pointer loss/cancellation, inspector/video placement and absence of stuck audition voices on at least one physical touch device.
3. **Normal routes and lifecycle:** initial draft review and saved-reference revision editing must use the same document, safe commands, selection/history, video clock and persistence/recovery contracts. Requalify reference changes, navigation, save failures and verification conflicts after extracting the harness controller. Do not copy state into a second editor.
4. **User-facing copy:** replace harness-era statements such as "writes nothing", "has no save", "Offset not saved", old phase labels and phase-number hints before exposing the editor on the normal review page. Explain actual unsaved-versus-saved state.
5. **Explicit musical limits:** a note-scoped written move of a chord member currently rejects instead of allocating a free voice. Keep the rejection and scope labels honest; do not advertise a split action that is unavailable. Independent tie-segment splitting and per-candidate audition remain unimplemented and must not appear as supported. No library parity claim is made.
6. **Final engraving/export:** formatted output remains Phase 8, using the same authored document, not a second note dataset. No library pivot is authorized by this GO.

Phase 7 should also carry the existing plan's header-overlap, responsive layout, accessibility, guitar regression and unsaved-navigation checks. Submit Phase 7 with route-level evidence, physical-device coverage and long-recording performance results, then stop for review.

No product code, Git branch, commit, publication or deployment was changed during this review.
