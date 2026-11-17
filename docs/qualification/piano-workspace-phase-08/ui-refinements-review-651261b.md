# UI refinements review — 651261b

## Decision

The three requested refinements are substantially implemented, but do not accept this commit as a complete regression-free delivery yet. One coordinate-origin regression needs correction: the widened correction-score gutter and the cursor/ruler/navigation helpers disagree by 54 pixels.

This submission covers the accordion, complete vertical-drag preview and musical context. It does not complete the later shared-timeline/Follow playback plan. That work is present as uncommitted changes and must be reviewed separately at its final identity.

## Review identity and isolation

- Submitted HEAD: `651261bc841f39c5c11d4e25210ff3ac381ab9c1`, branch `phase8/formatted-score`.
- The active working tree contains later timeline changes. This review inspected committed source and ran checks in an extracted copy of the submitted commit, without applying or reverting the developer's working changes.
- No product code was changed by this review.

## Confirmed implementation

- Roll accordion starts collapsed, remains mounted/hidden, and exposes aria-expanded/aria-controls through a native button.
- Vertical preview positions now feed chord stem/flags, ledger/dot/accidental positions and tie endpoint geometry.
- Both staves have meter; conventional key signatures come from the shared key definition; an outside-staff key caption replaces the floating key letter.
- Supplied desktop and drag captures visibly show these improvements. Supplied mobile capture retains substantial existing sticky-control/inspector obstruction; it is not evidence of complete physical-device usability, and this review does not newly certify it.

## Required correction: use one score context width everywhere

`ContinuousScore.tsx` changes `CONTEXT_WIDTH` from 62 to 116. Noteheads, barlines, pinned context and paper layout use 116. However, `viewport.ts` still defaults `SCORE_CONTEXT_WIDTH` to 62, and the score calls `xForTick`/`tickAtX` without passing its changed width.

Affected committed call sites include:

- Playhead x1/x2.
- Ruler click-to-seek.
- Linked-navigation scroll target.
- User-scroll tick reporting.

The linked target calculation subtracts the new width from a position calculated with the old one, so the error is not confined to cursor cosmetics.

### Independent geometry result

Using the committed `buildNotation`, `layoutMeasures`, `xForTick` and `tickAtX`, with one E4 note at 0 seconds, duration 0.5 seconds, document duration 4 seconds and bpm 120:

| Measurement | Actual default helper | Required using score width 116 |
| --- | --- | --- |
| Cursor at tick 0 | x = 76 | x = 130 |
| Cursor error | -54 px | 0 px |
| Ruler decode at x = 195 (tick 960) | tick 1758 | tick 960 |

This reproducer ran against the isolated commit and does not depend on browser timing or the future shared-timeline implementation.

### Completion criteria

1. Centralize/pass the authoritative score context width consistently across drawing, mapping, navigation and inverse ruler mapping. Do not fix the cursor with an isolated +54 offset.
2. Verify tick -> displayed x -> decoded tick at start/interior/boundaries and after nonzero scrolling.
3. Verify seeking a visible musical position selects the intended time, and linked scrolling uses the same origin.
4. Add a focused regression that would fail if the context width changes again without updating the coordinate consumers.
5. Preserve accordion state, complete drag previews, key/meter rendering, formatted-mode cancellation and saved/export agreement.

If the ongoing shared-timeline migration removes these old consumers, the final integrated submission can close this issue there with the same regression evidence. There is no need to discard current work or implement two competing navigation fixes.

## Independent verification and limits

- New application tests: 2 passed — accordion preservation; sheet head/stem preview and cancellation.
- TypeScript: passed in the isolated commit copy.
- Geometry probe: reproduced the two numeric mismatches above.
- Reviewed committed diff, new browser-check source and supplied desktop/mobile/drag captures.
- Browser reruns were attempted but did not complete and were stopped. No independent browser pass is claimed for this submission.
- The full 510-test suite, production build, 6 original probes, 3 edge probes, saved/reopened lifecycle journey and 16 Phase 7 scripts were not independently repeated here; their pass results remain developer-reported.

The removed second half of the mode-switch unit test asserted that a normal drag commits after returning to correction. The retained browser edge probe checks cancellation/late release, not that exact post-return recovery assertion. Existing general editing tests may supply related coverage; the final timeline package should explicitly cover a successful normal edit after return, in a separate bounded test if combining both transactions causes test cleanup problems. A test harness/listener hang should be diagnosed as such rather than described as coverage-equivalent removal.

## Next developer goal

Complete the ongoing shared timeline/Follow delivery against its plan, including closure of this coordinate-origin regression and preservation of the three UI refinements. Submit one final commit with focused mapping, interaction and lifecycle evidence. Do not rerun the entire long matrix after every cosmetic edit: finish the intended changes, run focused checks while iterating, then perform the required integrated validation once against the final state.

Phase 8's earlier acceptance is not revoked by this review. The new refinements/navigation delivery remains under review. The inactive occurrence policy, physical hardware qualification and unauthorised deployment/release status remain unchanged.
