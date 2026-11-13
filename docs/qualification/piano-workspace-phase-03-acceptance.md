# Piano correction workspace — Phase 3 acceptance

Reviewed: 13 November 2026.
Accepted submission: `e2405882d7b79fefa694baf4b88152fb5dc3a779`.
Decision: **GO — Phase 3 accepted; Phase 4 may begin.**

This supersedes the CHANGES REQUIRED decision for `86b3d3a`. Approval covers the isolated correction layout/viewports and authorises the next shared-playback/alignment phase only. It is not approval to replace the normal review/save workflow or deploy/publish the application.

## Independent verification

- Inspected the actual reveal-request, width lifecycle, pitch-canvas, score-value, harness and CSS changes.
- Reran the complete web test suite: **410 passed, 0 failed**, approximately 9.9 seconds on this run.
- Ran TypeScript checking: **passed**.
- Reran the committed Phase 3 reviewer reproducer: **4/4 PASS**.
- Ran an additional component probe using the new request-token API: a selected note with an active reveal token does **not** reverse a later manual pan; incrementing the token explicitly reveals the note again. **Passed**.
- Inspected the refreshed desktop and 390-pixel PNG captures: desktop arrangement is retained; the narrow keyboard now visibly uses the shorter range and improved proportions. Written heads/rests/dots are visibly distinguished in the score.
- Inspected the updated capture script and structured evidence: assertions and nonzero failure handling are present; stored receipt has no failures/console errors and reports 36 desktop versus 22 mobile white keys.
- Did not independently rerun live service capture, production build, physical-device checks or the actual-recording playback. Those remain developer-supplied evidence or later-phase qualifications, not fresh reviewer results.

## Resolution of the previous blockers

| Item | Accepted correction |
| --- | --- |
| R1: manual navigation reversed by selection | Explicit per-token reveal requests; viewport changes are not themselves reveal requests; reselect/Reveal provides a deliberate navigation action |
| R2: width measurement missed async host | Callback-ref lifecycle observes a newly attached node and supports replacement/resizing; loaded mobile layout selects the compact range |
| R3: low pitches outside fixed SVG | Scrollable pitch canvas, aligned label gutter, sticky ruler and pitch-aware reveal; low/high notes exist inside the accessible canvas |
| R4: written values lost by new renderer | Hollow/filled noteheads, stem rules, flag counts, dots and rest glyphs distinguish supported segment values; ambiguous multi-occurrence notes no longer silently pick the first repetition |

No blocking findings remain for the Phase 3 gate. This does not qualify final print engraving, full touch interaction, all future alignment cases or production review integration.

## Non-blocking evidence/qualification notes

- The old standalone reproducer still passes obsolete `revealOccurrenceId` / `revealTick` props; update it to the current token API before using it as ongoing regression protection. Independent token-based verification above and the new component suite provide current evidence, so this is not a functional approval blocker.
- The captured 385 px pitch canvas describes the real recording's pitch range, not a universal height for A0–C8. Keep the distinction in handoff/benchmark descriptions; the range test uses geometry derived from the actual fixture.
- Preserve viewport musical position deliberately across future responsive resize/linked-navigation work. Current captures show the time window changing on desktop-to-mobile resize; Phase 4's shared navigation controller should choose and test an explicit resize anchor.
- Short-clip handling has improved; define the remaining sub-0.25-second/empty-document display policy if such clips are supported. This does not block the reviewed long-recording workflow.

## Phase 4 instruction

Implement **Phase 4 only** from `docs/piano-correction-workspace-phases.md`:

1. Use one source-video clock and the existing audio controller; do not create a second playback transport.
2. Add the score playhead and shared time/beat mapping, including timed/held passages, explicit estimated state and alignment anchors.
3. Light actual occurrences/keys at their exact effective recorded times; do not substitute quantised score positions for their timing.
4. Add inverse seeking, linked musical-position navigation, Follow playback, manual-pan suspension and Return to playhead. Scrolling alone must not seek the video or edit notes.
5. Apply sync offset once, with explicit boundary and held-tick inverse rules. Cover rubato/arpeggiated chords, explanation gaps, seeks and rate changes using annotated fixtures as well as the real clip.
6. Keep the harness/feature boundary. Persistence, full editing gestures and normal-workflow migration remain in their later phases.

Submit the exact Phase 4 code identity, focused mapping/transport tests and browser evidence, then stop for review before Phase 5.

Only this acceptance record was added by the reviewer; no product implementation was modified.
