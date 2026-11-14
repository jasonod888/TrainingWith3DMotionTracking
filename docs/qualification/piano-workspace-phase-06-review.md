# Phase 6 review: CHANGES REQUIRED

Reviewed 14 November 2026. Submission: `8d92b53f6b3a9e8d224d338c7cdaaa0c6a704af5`, branch `phase6/visual-editing`, compared with accepted Phase 5 `97f6af5`.

**Decision: Phase 6 is not accepted. Phase 7 must remain stopped.** Continue the original implementation plan; this review does not request library adoption or replacement of the architecture.

## Independent verification

| Check | Result |
| --- | --- |
| Submitted `tests/workspace-gestures.test.tsx` | 8/8 pass, normal exit; React act warnings in replacement test |
| TypeScript (`node node_modules/typescript/bin/tsc --noEmit`, in apps/web) | Pass |
| Submitted browser scenarios, rerun using installed Chrome | Pass: pitch/time/resize, Escape, sheet drag, keyboard replacement, insertion/duplicate, fixture save/reopen |
| Independent edge-case reproducer, completed eight-test revision | 0/8 pass; all eight expose defects below; normal test-run exit 1 |
| Complete 462-test suite | Developer-reported, not independently rerun in this review |
| Real 1,338-note gesture save/reopen | Not established by the submitted browser script: it uses the four-note frames demo and the 20-occurrence Phase 1 fixture |

Independent reproducer: `apps/web/tests/workspace-phase6-review-repro.tsx`. It is deliberately outside the normal `*.test.tsx` filename pattern, so reviewing failures does not silently change the ordinary suite. Run from apps/web with `node --import tsx --test tests/workspace-phase6-review-repro.tsx` in an approved test environment.

Browser wrapper: `docs/qualification/piano-workspace-phase-06-review/check-submission.py`. Run from the repository root using the existing Python environment with Playwright, with Vite at 127.0.0.1:5173. It runs the submitted script with `channel='chrome'` because the Playwright-managed Chromium executable is absent here, and redirects captures to the review directory. Results: `piano-workspace-phase-06-review/browser.json` and `captures/`.

Evidence qualification: a later experimental extension adding a mocked-draft component case stalled after printing the same eight failures. A follow-up tool action was rejected by automatic approval review, which reported an unverified HTTPS export to a Visual Studio telemetry endpoint with unknown payload. It was not retried or bypassed. The experimental cases were removed from the review artifact; the retained reproducer is the eight-case version whose completed run is recorded above. `piano-workspace-phase-06-review/reproducer.txt` is the partial follow-up output, not a clean completed-suite log. Do not count the removed cases as automated evidence.

## R1 — cancel and dispose the pointer transaction safely (high)

Locations: `TimeRoll.tsx:164-185`, `:211-246`; `ContinuousScore.tsx:150-211`.

Both surfaces register the global `pointercancel` listener to the same `onEnd` function as pointerup. `onEnd` calls the commit path. Element-level React cancellation covers some events, but cancellation reaching the global listener can commit the preview. There is no lost-pointer-capture cancellation handler, no gesture-listener teardown on component unmount, and no pointer-id ownership check.

Four independent failures:

1. Roll: C4 drag upward, dispatch pointercancel at window: recorded pitch becomes 62 instead of staying 60.
2. Score: C4 drag upward, window pointercancel: written pitch becomes D4.
3. Unmount a TimeRoll mid-drag, then window pointerup: its old host still receives a pitch command.
4. Dispatch lostpointercapture during a roll drag, then pointerup: pitch commits instead of cancelling.

Required: one gesture lifecycle with distinct commit/cancel functions, owned pointer id, capture-element tracking, cleanup on cancellation/lost capture/unmount/reference replacement, and no command/history on cancellation. Ensure element and global handlers cannot double-commit. A normal release should still commit once. Test roll and sheet, not just Escape on an attached note.

## R2 — make sheet movement match its engraving and return-to-origin semantics (high)

Locations: `ContinuousScore.tsx:20`, `:178-201`, `:327-329`; `gestures.ts:46-58`.

Staff lines are 10 SVG units apart and diatonic positions are 5 units apart. Drag arithmetic uses 12 CSS pixels per diatonic step. Independent probe: moving C4 upward by 10 px produces D4 (62), although moving one staff line should produce E4 (64). The candidate label also uses a different displacement and the notehead itself stays in its original position during preview.

Separately, `if (Math.abs(dy) < 5) return` leaves the previous candidate in the drag state. C-sharp4 dragged up 12 px, returned exactly to its starting point and released still emits a D4 command. This is an unintended pitch edit, not just a preview defect.

Required: transform pointer coordinates into the SVG/staff coordinate system, use the actual line/space geometry, preview the candidate at that location, and recompute/reset when returning to origin. Zero-step movement must preserve the original pitch and authored accidental, not derive a new natural from the key signature. Test upward/downward moves, return to zero, accidentals, key signatures and scaled rendering.

## R3 — route every insertion through the shared timing boundary (high)

Locations: `TimeRoll.tsx:249-257`, `:328-337`; `PianoWorkspaceHarness.tsx:343-349`, `:1193-1205`; `correction.ts:545-546`.

Independent probe: with +0.5 s offset, clicking at x=180 produces a ghost at x=210 (60 px/s). `placeGhost` stores source time directly as performance time, then rendering adds the offset again. The playhead insertion buttons likewise pass `playhead` directly as stored onset. Clicking an existing roll note uses its stored onset instead, so entry paths disagree.

Static integration finding: `commitAdd` supplies no `startTicks`; `insertNote` therefore defaults to stored onset divided by constant-tempo seconds-per-tick. Existing notes were built using the explanation-aware score clock. In the explanation demo, a note at 8 s belongs at tick 4800; the insertion fallback calculates 7680. Anchored maps also require the current map, not a tempo-only fallback. This additional example was not executed as a completed component test in this review.

Required: source time -> stored onset by subtracting offset exactly once, validate unsupported negative/boundary targets, map that placement into written ticks through the current alignment, and pass explicit written values to the safe insertion command. Cover roll placement, current-playhead insertion, keyboard insertion and add-to-chord consistently. Apply the declared snap rule; define/reject insertion within held speech passages rather than inventing score time. Do not change the safe generic command defaults for unrelated callers without regression tests.

## R4 — enforce exclusive editing modes and truthful results (high)

Locations: `PianoWorkspaceHarness.tsx:320-325`, `:1042`, `:1057`, `:1116`, `:1190-1220`.

Independent probe: select C4, enter Replace pitch, drag that roll note upward: it changes to D4 while Replace remains active. Only the inspector fieldset is disabled. Roll, sheet, insertion actions and undo/redo remain editable. Add and Replace are independently enabled booleans, allowing overlapping transactions.

Static result issue: replacement clears the mode and announces success regardless of whether the command rejected (for example a duplicate chord pitch or unavailable voice). Insertion similarly closes its ghost after dispatch without inspecting the outcome.

Required: a single explicit mode policy. While replacing, preserve a fixed valid target and disable/cancel incompatible editing actions across all surfaces, including history/reopen as appropriate. Cancel modes on reference/target invalidation. Entering Add should not coexist with Replace or a live drag. Rejections must retain a useful correction state and show the rejection, never a success message. Test conflicting actions and rejected commits.

## R5 — distinguish ties from multiple recorded occurrences (high; code-inspected)

Locations: `PianoWorkspaceHarness.tsx:1120-1123`, `:1181-1182`, `:1265-1281`; `correction.ts:285-336`.

`linkedOccurrences` is `note.performance_ids.length`. The new inspector labels that number as tied segments and says pitch replacement/delete apply to all of them. These are different relationships:

- One sustained recorded occurrence can have several tied written segments, but its count is 1 and the message is absent.
- Two distinct attacks quantised into one written note have count 2, even with no ties, and are incorrectly labelled as two tied segments.
- The accepted pitch command is occurrence-scoped and splits a shared mapping; it does not change all those attacks. The two deletion buttons also have different actual scopes.

Required: derive tie/segment information from written segments and logical identity; separately label the number of recorded occurrences. Preserve Phase 2's selected-occurrence isolation. State precisely which linked written segments follow a pitch edit and whether deletion targets one attack or the entire logical note. Test both a single attack tied across a barline and a logical note owning multiple attacks. Independent segment splitting need not be implemented to pass this item; honest scope is required.

## R6 — complete the agreed correction controls and gate evidence (medium)

The Phase 6 gate says every section 6 journey passes. Some required capabilities are absent rather than proven:

- Add ghost has no proposed recorded-length/written-value controls; `lastWrittenTicks` starts at 480 and is only assigned the existing ghost ticks at commit, so the user cannot choose another insertion value through this flow. The ghost width is always 0.25 s even though the initial quarter at 120 BPM commits as 0.5 s. Show the actual proposed length and remembered written choice, with explicit scope.
- Written beat-position control is explicitly omitted, although section 6.6 requires it and the command layer already supports written moves. Implement an explicit inspector control with safe rejection/history, without moving recorded onset implicitly.
- Delete and Ctrl/Cmd+Z / redo shortcuts are not wired; the new global key handlers only cover Escape and Enter. Add the scoped shortcuts and protect typing fields. Broader physical-device/accessibility qualification can remain Phase 7.
- Provide surface-level evidence for sharp/flat/natural versus respelling, chord-member isolation, overlap candidate selection and safe tied scope; command-unit tests alone do not prove UI wiring.
- The required saved/reopened long-example gesture correction is not in this submission's browser script. Supply a reproducible long-data path (controlled routes using the real extracted data are acceptable if clearly labelled), with before/after occurrence counts, exact timing, mapping integrity and unrelated-note preservation. No need to mutate the owner's real lesson to obtain this evidence.

Duplicate validation should use one documented tolerance: the ghost marks a collision within 1 ms, the harness blocks within 10 ms, and the command checks within 1 microsecond. Currently a green ghost can be refused as a duplicate. Make preview and commit agree without hiding distinct recorded attacks.

## Resubmission gate

Fix R1-R6 and submit one correction identity with:

1. The eight retained reviewer probes passing, with assertions preserved or justified equivalent coverage.
2. Additional automated tests for timing-map insertion, truthful mode rejections, the two tie/mapping cases and missing controls/shortcuts.
3. Submitted basic interaction/browser checks still passing, plus long-example correction/save/reopen evidence.
4. Normal web/TypeScript/build checks in an approved environment, separating developer-reported and independently executed results.

Screenshots versus video, lack of physical touch testing at this stage, no independent tie splitting and no per-candidate audition are not by themselves reasons for this rejection. The functional defects above are. No product fixes, library changes, normal-route replacement, commits or deployment were performed during this review.
