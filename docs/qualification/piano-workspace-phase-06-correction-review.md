# Phase 6 correction review — CHANGES REQUIRED

Date: 14 November 2026. Reviewed code: `7bad6cb1ffabc634730998c0361202e77d7cbc94`, branch `phase6/visual-editing`.

**Phase 7 remains stopped.** Several original defects are addressed, including separate global cancel/commit handlers, unmount listener cleanup, geometry-based pitch calculation, explicit mapping on insertion, and separate tie/occurrence labels. However, six additional browser checks fail on this correction tree. These are implementation gaps in the original plan, not a reason to restart or adopt another library.

## Evidence

| Check | Result |
| --- | --- |
| Independent TypeScript check | Clean, exit 0 |
| New independent installed-Chrome diagnostic | Six checks executed; 0/6 pass, normal exit 1 |
| Developer's eight original reviewer probes | Reported 8/8; not independently rerun this review |
| Developer's web suite | Reported 468 pass; not independently rerun this review |
| Submitted browser JSON | Inspected; includes long-data fixture round trip, but has a false-positive sheet-drag assertion described below |

Browser reproducer: `docs/qualification/piano-workspace-phase-06-review/check-correction.py`.
Results: `docs/qualification/piano-workspace-phase-06-review/correction-results.json`.

Run from repository root with Vite at 127.0.0.1:5173:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-06-review/check-correction.py
```

This exercises the local frames demo with actual Chrome, intercepts API requests with 404, makes no real lesson changes, and uses no authenticated save. Normal exit 1 means assertions failed, not a runner hang. Full Node suites were not independently repeated; earlier automatic-approval restrictions on additional test execution remain a limitation, not passing evidence.

## F1 — the chosen written duration is ignored (high)

`PianoWorkspaceHarness.tsx`, `commitAdd` and `insertAtPlayhead`.

Browser reproduction: Add note, set recorded length to **0.25 s**, choose **Half / 960 ticks**, place at 3.5 s and insert. Inspector reports **recorded 0.250 s / written 240 ticks**. The requested written value was discarded.

Cause: the insertion command includes `durationSeconds` and `startTicks`, but omits `durationTicks`. The engine correctly falls back to a tempo-derived written duration. The new journey test uses recorded 1 s with a half note at 120 BPM, so its two independent values coincidentally agree and conceal the missing field.

Required: pass the explicitly chosen written ticks independently from recorded seconds for every applicable insertion entry point, including the remembered playhead path. Test deliberately different values, undo/redo and save/reopen. Do not re-couple written and recorded duration.

## F2 — history shortcuts bypass exclusive modes (high)

`PianoWorkspaceHarness.tsx`, global history key handler and mode controls.

Browser reproduction: select C4, raise to C-sharp4, enter Replace pitch, press Ctrl+Z. Pitch changes **61 -> 60** while the replacement banner stays active. The disabled Undo toolbar button therefore does not enforce the mode policy.

Required: enforce the same transaction policy for buttons, keyboard shortcuts and controller actions. Block or explicitly cancel incompatible modes before undo/redo; do not allow a stale replacement target/pitch snapshot. Cover Ctrl/Cmd+Z, redo variants, Add mode, and reference replacement. The claim that history/reopen are disabled during both modes is also wider than the implementation: toolbar disable conditions currently check Replace only. Scope shortcuts to the focused workspace rather than every non-input element on window before normal-route integration.

## F3 — written-position control silently moves the whole chord (high)

`PianoWorkspaceHarness.tsx`, Written beat position group.

Browser reproduction: frames demo, select C4 in the C/E/G chord, change written start **1920 -> 2160** and apply. Select sibling E4: its written start is now **2160** too. The control has no event-scope label/choice; the nearby written-value scope defaults to "This note". The command always targets `selection.eventId`.

Required: make the scope explicit and honour it. For a selected-note move, use the established split/free-voice-or-reject policy, preserving sibling notation and all recorded onsets. If exposing whole-event movement, label it as such and require that scope explicitly. Never infer an event-wide mutation from a selected-note control.

Also reset or bind `writtenStartDraft` on selection/document changes. At present the field remounts showing the new note's value, while an earlier draft remains in component state and can be applied to the new selection. Test switching selection with an unapplied draft.

## F4 — negative insertion is silently clamped before validation (high)

`PianoWorkspaceHarness.tsx`, `onGhostPlace`; shared insertion validation boundary.

Browser reproduction: offset **+0.5 s**, Add note, click source time **0.1 s**, then Insert. This would require a stored onset of **-0.4 s**. Instead of rejection, note count rises **4 -> 5**, with the inserted note stored at **0.000 s**. Rendering places it at source 0.5 s rather than the clicked 0.1 s.

Cause: the ghost callback clamps `seconds - offsetSeconds` to zero before `insertionPlacement` validates it. The helper's direct negative-input unit test does not exercise this UI path.

Required: preserve the attempted placement for validation and show an invalid ghost/reason; reject unsupported negative stored onset without committing. Do not silently move the requested placement. Test positive/negative offsets and both clip ends through the actual surface. Test held-passage join boundaries too, with a consistent interval policy.

## F5 — element pointerup still commits another pointer's drag (high)

`TimeRoll.tsx` `commitDrag`, `ContinuousScore.tsx` `commitSheetDrag`, and their element handlers.

The new global handlers check pointer ownership, but the element-level commit handlers do not.

Browser reproduction using native PointerEvents: pointer 31 begins and moves the C4 drag, then pointer **99** sends pointerup on the same element. Pitch commits **60 -> 62**. Another finger/stylus interaction can therefore finish the wrong transaction. Element pointercancel also ignores ownership, so the converse cancellation path needs review.

Required: check the active pointer id inside commit/cancel entry points, not just the global wrapper; refuse foreign pointers without losing the original transaction. Do not overwrite an active transaction on a second pointerdown. Cover both surfaces and ensure the owning pointer still commits exactly once after a foreign event.

## F6 — sheet candidate preview and acceptance assertion remain incorrect (medium)

`ContinuousScore.tsx` notehead/label rendering; `scripts/check-editing.py` sheet-drag check.

Browser reproduction: drag C4 upward one staff space. Candidate label becomes **D4**, but the head's `cy` remains **84 -> 84**. The head does not preview the candidate location. The label still uses `cy - 10 + steps * 6`, moving downward for positive upward pitch steps and using a different spacing from the 5-unit staff step. This contradicts the correction handoff's claim that candidate head and label move to the engraved position.

The committed browser JSON records sheet drag **"C4, quarter" -> "C4, quarter, selected"**, yet reports success. Its assertion compares the complete aria-label; merely adding "selected" passes without a pitch change. At the old 12 px movement, the new geometry can request an existing chord pitch and reject safely, which is not evidence of a successful drag.

Required: render a candidate head/ghost at the actual staff position with matching label geometry, and assert sounding pitch/spelling for a successful non-colliding drag, not selection-label inequality. Add a separate collision/rejection check. Correct the handoff's stale C4->D4 claim and distinguish the two outcomes.

## Resubmission

Fix F1-F6; retain the original eight reviewer assertions and existing checks. Run the new six browser assertions without weakening their intended contracts (equivalent end-to-end coverage is acceptable if documented). Add tests with independent written/recorded durations, foreign pointer events, selection changes with unapplied inspector drafts, and exclusive-mode shortcuts. Re-run the long fixture save/reopen after those edits and inspect complete unrelated-note integrity rather than only one sibling sample.

Physical touch qualification, independent tie splitting and per-candidate audition remain at their previously agreed scope; their absence alone does not block this correction review. No product code, storage schema, Git branch, commit or release was changed during review.
