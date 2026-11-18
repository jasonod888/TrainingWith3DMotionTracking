# Guitar implementation: verification of the 11 review findings

Rechecked the current working tree on 18 November 2026 against `guitar-plan-implementation-review-2026-11-18.md`. No application fixes were made during this recheck.

**Result: 9 findings resolved in the inspected code and targeted checks; 2 partially resolved. The previously reported playback test failure also remains.** This is not a claim of full live-browser or API acceptance: the limits below still apply.

| Original finding | Status | Evidence |
| --- | --- | --- |
| 1. Invalid chord edits poison workspace recovery | **Partial** | Blank names now normalize to `Chord`, but the UI still permits more than 100 shapes and invalid arrays are silently replaced with `[]` in recovery and server-save payloads. |
| 2. Stale recovery skips chord validation | **Resolved** | `peekRecovery` and `readRecovery` share `normalizeCheckpointShapes`; a malformed fret array now makes stale peek return null. |
| 3. Unplayable pitches become open-first-string TAB | **Resolved** | Score resolution returns null and renders an explicit unplayable marker; TimeRoll likewise marks unplayable notes without a fret. Regression test passes. |
| 4. Finger assignments depend on IDs and omit sustained notes | **Resolved for the reported cases** | Assignment calculates context across the chord/strum window and includes sounding durations. Original descending-fret chord, ID-renaming, and held-note probes pass. |
| 5. Invalid tuning types escape backend validation | **Resolved** | A string type guard precedes dictionary lookup; arrays, objects, booleans, and unknown tuning IDs raise ValueError. Frontend null handling now agrees with the server. |
| 6. Practice lacks finger-colored roll and follow wiring | **Resolved in wiring** | Practice now mounts TimeRoll and TAB with clock/alignment/layout, cursor fallback, and shared scrolling/follow state. Full long-piece browser acceptance was not performed. |
| 7. Frets above 15 disappear | **Resolved** | Editor/practice use 24 frets; the neck also expands to supplied marker frets. High-fret regression test passes. |
| 8. Watch ignores saved setup | **Partial** | Enhanced neck consumes saved notation and both save routes synchronize instrument metadata. Basic/error/loading fallback still uses the old standard-only guide. |
| 9. Selection/playback removes finger fill | **Resolved** | Finger fill is now inline for selected and active notes; state is shown by border/brightness. Selected-bar regression test passes. |
| 10. Finger names/numbers missing from labels/tooltips | **Resolved** | Visible fret labels, titles, and accessible labels now include finger information. Regression test passes. |
| 11. Missing capo badges | **Resolved** | Roll and TAB visibly render capo badges; tests cover capo 2. |

## Remaining gap A: chord overflow silently deletes chord data

References:

- `apps/web/src/music/workspace/PianoWorkspaceHarness.tsx:3138`: Add shape is disabled only for read-only mode; it has no 100-shape guard.
- `apps/web/src/music/workspace/recovery.ts:54`: `sanitizeGuitarChords` returns null for arrays longer than 100.
- `apps/web/src/music/workspace/PianoWorkspaceHarness.tsx:1522`: recovery writes `sanitizeGuitarChords(guitarChords) ?? []`.
- `apps/web/src/music/workspace/PianoWorkspaceHarness.tsx:1867`: saving sends the same empty-array fallback.

The blank-name part of original finding 1 is fixed. Clearing a name no longer prevents notation recovery. However, adding shape 101 is still allowed, and the new sanitation fallback converts the entire collection to an empty array. A crash loses every chord; saving can persist an empty chord collection and mark the workspace saved even though the UI previously held shapes.

Executed reproduction using the same sanitation expression:

```text
101 chords normalize: null
101 chords autosave expression restored count: 0
blank name restored: Chord
```

This remains a high-priority authored-data-loss gap. Prevent shape 101, and refuse invalid save state with a clear error rather than silently substituting an empty collection. Recovery should preserve the last valid chord collection while retaining the rest of the checkpoint. Other sanitizer failures can reach the same destructive fallback.

## Remaining gap B: Watch's fallback still ignores saved positions/setup

References:

- `apps/web/src/music/renderers/InstrumentGuideStage.tsx:17`: the original `guitarGuide(reference.instrument, active)` still supplies the fallback model.
- In the same component, `savedPositions` and `savedSetup` are passed only to the enhanced `GuitarNeckGuide`; `legacy` still receives the original model.
- `apps/web/src/music/renderers/LegacyInstrumentGuide.tsx:12`: the fallback labels itself “Guitar guide, standard tuning” and uses standard string labels.
- `apps/web/src/music/renderers/guide-view-model.ts:6`: the old guide rejects nonstandard tuning/capo support.

Executed server-render probe: a saved Drop D reference with low D2 at string 6/fret 0, and `guitarLibrary=false`, produced:

```text
legacy standard tuning label: true
active fret markers: 0
saved tuning notice: Markers use the saved drop d positions.
```

Thus the caption claims saved positions are being used while the displayed basic guide contains none and still names standard tuning. This path is used when the enhanced guide is disabled and as its loading/error fallback.

Pass the same setup-aware resolved model and labels into every Watch renderer, including fallback paths. The enhanced renderer and instrument metadata synchronization are improvements, but original finding 8 is not fully closed.

## Verification

- TypeScript `tsc --noEmit`: **passed**.
- Six relevant test files: **90 tests, 89 passed, 1 failed**. Files: guitar notation, guitar surfaces, music reference, workspace state, music practice runtime, and correction commands. Full captured output: `outputs/guitar-review-recheck-tests.log`.
- The failure remains `music-practice-runtime.test.tsx:168`: the guitar playback test expects a `1.25×` settings choice, while `PianoPracticeWorkspace` declares speeds `[0.25, 0.5, 0.75, 1]`. This is an unresolved test/product-capability mismatch; it does not establish that basic playback fails, but the later assertions in that test are not reached.
- Independent probes confirmed the original chord assignment/held-note cases, blank-name recovery, stale malformed-chord rejection, malformed backend tuning type rejection, the 101-chord data loss, and the Watch fallback inconsistency.
- API edit/review tests were attempted again and still cannot collect because the selected Python `.venv` lacks `fastapi`. Backend helper probes passed independently. HTTP integration is therefore unverified.
- No live audio/browser acceptance session or full repository test run was performed.

## Smaller items from the original report

The implementation still uses `GUITAR_FINGER_PALETTE` rather than the plan's named metadata API, and capo remains a numeric input. Those are minor contract/UX differences, not blockers for the reported runtime fixes. Policies for existing saved chord shapes after retuning and for simultaneous remapping onto the same string remain product decisions rather than newly confirmed defects.
