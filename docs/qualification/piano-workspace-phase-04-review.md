# Piano correction workspace — Phase 4 review

Reviewed: 13 November 2026.
Submission: `09fef39fabd853759b592332b7bce57bec305991`.
Decision: **CHANGES REQUIRED — Phase 5 is not authorised.**

The isolated workspace now contains substantial shared mapping/navigation work. However, numerical agreement between two cursors derived from the same mapping does not prove agreement with the keyboard, written note positions, audio or the current video frame. The failures below concern Phase 4's core outcome.

## Independent verification

- Read the full handoff, alignment module, harness clock/state, surface diffs, navigation geometry, tests and capture-script assertions.
- Independently reran all 11 alignment/activation tests: **11 passed, 0 failed**.
- Ran TypeScript checking: **passed**.
- Independently reproduced offset activation mismatch using the actual harness in the `?demo=arpeggio` mode through React/JSDOM.
- Independently reproduced explanation score-position mismatch, acceptance of invalid alignment structures and incorrect inverse boundary handling using the submitted exports.
- Did not independently rerun the complete 421-test suite, production build or authenticated browser capture. Those remain developer-reported evidence.
- No product code or authentication data was changed during review.

## R1 — Keyboard activation and keyboard selection ignore sync offset (high)

Location: `PianoWorkspaceHarness.tsx`, `activePitches` and `selectKey`.

The roll/score use `occurrenceIntervals(document, offsetSeconds)` and shared active IDs. The keyboard still derives active pitches and candidate occurrences from raw `note.onset`, without offset.

Actual harness reproduction: `?demo=arpeggio`, offset **+0.5 s**, fixture clock **2.25 s**. Result: **0 active roll notes, 0 active score notes, 3 active keys**. Effective attacks begin at 2.5 s, so no key should light yet. Clicking a key in this interval can also select an occurrence that is not sounding at the effective source time.

Required: derive keyboard highlights and key-selection candidate IDs from the same offset-aware occurrence intervals as the other views. Cover positive/negative offsets, exact start/end boundaries, overlapping repeated pitches, and selection after offset changes. Assert occurrence identities across views, not just total counts.

## R2 — Explanation mapping compresses time but the written score does not (high)

Location: harness draft/demo construction (`buildNotation`) and `alignmentFromSpans` integration.

`alignmentFromSpans` correctly holds the cursor during speech, but the score is still built from absolute recording seconds using a continuous tempo. Notes after an explanation retain the speech duration as a written-time gap. The map and engraved event positions therefore describe different musical timelines.

Actual demo logic, 120 BPM, playing 0–4 s / explanation 4–7 s / playing 7–12 s:

| Quantity for the note played at 8 s | Actual |
| --- | --- |
| Mapped cursor tick at 8 s | 4,800 |
| Written event start built from its onset | 7,680 |
| Inverse seek to that written tick | 11 s |

The active note can light far away from its cursor, and clicking its score position/ruler seeks three seconds late. The existing explanation test checks only that the cursor holds/resumes; it never checks its relationship to the post-gap notehead.

Required: establish one coherent score-time domain for events, alignment and engraved geometry. A span-aware initial score interpretation can omit explanation time while preserving exact performance seconds. Preserve authored written positions on later edits; do not silently rebuild away authored rhythm/voices to repair alignment. Test before, during and after holds, uncovered gaps, initial explanations and multiple playing passages. Verify source onset → mapped tick → actual notehead x and inverse seeking, within explicit quantisation tolerance where appropriate.

Arpeggiated chord members may share written x while lighting separately, as agreed; that legitimate timing deviation does not justify an entire explanation-duration mismatch.

## R3 — Alignment validation permits holes and jumps; inverse boundary can seek forwards (high)

Location: `packages/music-notation/alignment.ts`, `alignmentProblem`, `alignmentFromSpans`, `tickToSeconds`; also `viewport.ts` inverse geometry boundaries.

Independent examples accepted with `alignmentProblem(...) === null` for a 12-second clip:

- A single passage covering only **[2, 10]**: start and tail are missing.
- Timed passages **[0, 3]** and **[5, 12]**: a hole is silently accepted.
- Adjacent timed passages whose score endpoints are **3840** then **5000**: an unreported cursor jump is accepted.

The agreed contract requires passages to tile the clip and cursor joins to be continuous except for a separately specified intentional discontinuity. Merely checking non-decreasing values is insufficient. `alignmentFromSpans` also needs to reject/report overlapping or malformed spans rather than return an invalid list that the harness uses without validation.

Independent inverse boundary reproduction: in the valid explanation map above, `tickToSeconds(map, -1)` returns **7 s**, the last timed passage's start, rather than the start boundary. Apply explicit first/last-domain clamping and hold-start priority. Also guard ruler geometry at content x/tick outside the score domain so the “no containing box → last box” fallback cannot jump to the final measure for a position before the beginning.

Required coverage: first/last coverage, source gaps/overlaps, score continuity, negative ticks, unsupported kind/mode/basis, finite bounds, invalid spans, held-tick endpoint priority and numeric inverse expectations. Validate maps before consumption; return clear failures, not accidental extrapolation or silent jumps.

## R4 — Complete the Phase 4 anchor-authoring flow (scope blocker)

The phased delivery document explicitly assigns **“Implement monotonic alignment anchors and an advanced ‘Align beat to video’ flow with validation/history”** to Phase 4. The Phase 3 acceptance record reiterated alignment anchors. Moving the UI to Phase 6/7 was not approved.

`addAnchor` is currently a standalone function; the harness never calls it, never stores an authored map, and recomputes estimated alignment from document/spans. There is no way for the instructor to correct an estimated alignment, no mapping history, and no annotated rubato-fixture authoring evidence.

Required for this gate: a compact advanced action to pause/seek the source, choose a score beat/tick, preview and apply an alignment point, show anchored/estimated status, reject invalid placement visibly, and undo/redo the mapping without changing performance timing. Support removal/replacement or clearly specified equivalents that allow correcting a mistaken point. Preserve authored anchors across unrelated pitch/velocity edits. Keep this local and unsaved until Phase 5; no backend work is requested.

One-anchor/estimated versus anchored rules must be explicit and consistent with the prior contract, rather than an unexplained mode change. Use an annotated fixture to demonstrate known beat times and resulting notehead/cursor mapping, not only self-consistency of the conversion formula.

## R5 — Existing original/piano source player is not connected (scope blocker)

Phase 4 explicitly requires connecting the existing video/source-player controller and preserving Original/Piano audio selection semantics. The handoff claims `usePianoSourcePlayer` still owns audio mapping, but the harness does not import/use that hook, load the verified preview asset, render its audio element, or offer those source modes. It only has source video plus separate single-note audition.

Required: wire the existing source-player/verified-preview pathway into this isolated workspace, retaining one source clock and the current error/unavailable behaviour. Verify play/pause/seek/rate/source switches under offsets. Stop audition when source playback begins and stop media/audition correctly on source change/unmount. No server save implementation is needed; unavailable-preview drafts can remain Original-only with honest messaging, but the supported Piano path needs a fixture/test.

Correct the handoff's controller claim to match the actual code and evidence.

## R6 — Measured visual-clock behaviour must meet the agreed target (medium, required timing evidence)

The harness updates the entire React workspace at approximately 20 Hz (minimum 50 ms between paints). That still rerenders the surrounding inspector; it also deliberately permits multiple displayed frames of lag at ordinary 60 Hz and can omit short note activations between paints. A pure helper test with notes 12 ms apart is not a test of rendered transitions.

The agreed specification targets at most one displayed frame of visual-clock disagreement, accounting for source/display frame rate. The browser script compares the two rendered cursors to each other, not their timestamp against the current video frame, and initially only at time-window start 0. Its roll conversion also adds window.start to an x already expressed in absolute content seconds, so later-window checks would double-count the start.

Required: separate frame-sensitive cursor/active-note rendering from low-frequency inspector updates, or supply measurements supporting a reviewed timing policy change. Measure actual source-versus-visual timestamps while playing, seeking and changing rate, including a nonzero viewport and offsets. Test short-note transitions with a controlled media clock. Compare occurrence identities and all three views. Distinguish frame-limit visibility from an artificial 50 ms throttle.

## Fixture/evidence correction

The audit established that **89 real chord events have staggered recorded onsets**, with up to 92.8 ms spread. Saying the real recording has “no arpeggio” is not supported. Use the synthetic fixture for controlled ground truth, while keeping real staggered-chord cases in qualification and labelling whether musical arpeggiation versus decoder jitter is unknown.

## Follow-up request

Submit a Phase 4 correction commit addressing R1–R6, updated handoff and focused integration/component tests. Include annotated post-explanation and offset examples, mapping-authoring history and verified source-player coverage. Keep the workspace isolated; do not start persistence or Phase 5 yet.

Reviewer diagnostic script: `docs/qualification/piano-workspace-phase-04-review-repro.ts`. It exercises the actual arpeggio harness and submitted map functions without authenticated services; its failing checks are examples, not the whole acceptance matrix.
