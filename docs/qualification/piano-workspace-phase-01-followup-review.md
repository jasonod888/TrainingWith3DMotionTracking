# Piano correction workspace — Phase 1 follow-up review

Reviewed: 13 November 2026.
Submission: `28f37cec87ef6894ff06af8ac5c3d99be6d3ad6f` (parent `4583e74`).
Decision: **GO — Phase 1 accepted; Phase 2 may proceed.**

This supersedes the CHANGES REQUIRED decision on the initial submission. It authorises the Phase 2 shared-document/command/selection/history work only, not later phases, deployment or publication. The owner has already instructed the developer to proceed; this review confirms that proceeding is appropriate.

## Evidence reviewed

- Inspected the exact follow-up commit, which contains audit documentation/evidence only, with no product-code changes.
- Read the revised ownership, occurrence-scope, non-destructive overlap, accidental/respelling, nullable-field, alignment and legacy-save contracts.
- Confirmed raw test/audit evidence is now included as tracked text files.
- Independently executed the repaired committed destructive audit with the tracked 20-occurrence fixture: **exit 0**, covering the D1–D12 classifications and safe controls. The import-path failure from R1 is resolved.
- Independently emitted fixture notation and ran the existing server validator: builder output **ACCEPTED**; deliberately mismatched pitch **REFUSED**.
- Did not rerun the complete web/API suites or real-draft service checks in this follow-up. Their full-suite results remain the developer's supplied evidence. The previous review independently ran 13 notation/editor tests successfully.

## Resolution of prior blockers

| Item | Decision |
| --- | --- |
| R1: reproduction paths and missing evidence | Resolved sufficiently for the audit gate; committed fixture path now runs independently |
| R2: ownership/scope contradictions and destructive replacement | Resolved: explicit many-to-one ownership, occurrence split-or-reject, no destructive replacement in Phase 2 |
| R3: accidental/respelling and unknown fields | Resolved: sounding pitch changes distinguished from spelling; legacy nulls preserved |
| R4: alignment representation and misleading accuracy claim | Resolved for Phase 1: internal held passages represented; quantisation residual labelled correctly; implementation qualification remains Phase 4 |
| R5: legacy saves and version compatibility | Resolved: retained notation must validate; stale notation rejected; v2 kept away from v1-only save endpoints |

## Phase 2 review expectations

- One shared document, stable occurrence selection and bounded history; no normal-page replacement or new save protocol yet.
- No collateral occurrence deletion, chord-wide onset rewrite or implicit beat snapping of recorded seconds.
- Written duration remains independent of recorded duration. Generated ties may still render; unavailable manual tie/merge actions must not invalidate existing tied documents.
- Multi-mapping/chord changes split safely or reject atomically. No-op, failure and cancelled preview leave data/history/dirty state unchanged.
- Validate against both representative fixtures and the real repeated-note/arpeggiated-chord data when accessible.
- Submit the exact Phase 2 code identity, focused behavioural tests and harness instructions; stop for review before Phase 3.

## Clarifications to retain for later phases (not blockers to Phase 2)

- Alignment passage joins must be continuous in score ticks unless a separately specified discontinuity is intentional. Merely requiring non-decreasing ticks permits jumps. Define shared boundary ownership and inverse priority explicitly: the held tick also exists at adjacent timed endpoints, so seeking that tick must deterministically use the documented hold-start policy.
- With a non-zero global offset, video time outside the stored mapping domain needs an explicit boundary hold/clamp policy; offset must not be applied twice.
- Fixture save/reload, API compatibility and live cursor tests belong to their planned persistence/playback gates. Phase 2 should demonstrate command-level or serialisation behaviour without claiming the later end-to-end features are finished.
- The current audit validator prints ACCEPTED/REFUSED results but does not fail its process when an expected result changes. Before treating it as an automated acceptance check, make expected outcomes assertions or check its structured output. This does not invalidate the observed results reviewed here.

No product files were modified by this review. Developer work already in progress should continue within Phase 2 scope.
