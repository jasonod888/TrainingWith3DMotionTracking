# Piano workspace: staged library adoption and fallback plan

Prepared: 14 November 2026.
Decision status: strategy proposal; no library migration implemented.
Current implementation checkpoint: `8d92b53f6b3a9e8d224d338c7cdaaa0c6a704af5`, branch `phase6/visual-editing`.
Phase 6 is submitted but has not been independently accepted. Phase 5 is accepted at `97f6af5`.

## 1. Objective

Deliver the intended keyboard + scrolling piano roll + scrolling sheet workspace with reliable editing and professional notation. Reuse an external library only when a working comparison demonstrates a worthwhile improvement in usability, engraving quality, supported musical features or maintenance effort.

Preserve the existing implementation as a usable comparison and rollback path. Keep the tested document, safe commands, exact performance timing, shared selection/history, video alignment and persistence/recovery work. The initial library trials must not change the production storage schema or replace the normal review page.

Pause Phase 7 while reviewing Phase 6 and making this adoption decision. This plan does not grant Phase 6 acceptance, normal-route integration or deployment approval.

## 2. What we already own and should retain

| Existing work | Intended disposition |
| --- | --- |
| Performance occurrence ids, written logical notes and mapping invariants | Retain as canonical document and identities |
| Safe correction commands and scope validation | Retain; external gestures request these commands |
| Shared selection, transactional undo/redo | Retain as workspace authority |
| Exact seconds, recorded duration versus written duration | Retain; do not replace with MIDI quantisation |
| Explanation holds, alignment anchors, offset and video clock | Retain; adapt rendered geometry to the existing map |
| Server integrity checks, private revision saves and idempotency | Retain |
| Verification/conflict handling and account/source/base-scoped recovery | Retain |
| Existing keyboard/inspector and Phase 6 mode controls | Reuse where they satisfy the reviewed UX |
| Custom sheet and roll surfaces | Preserve as baseline/fallback; replace individually only after qualification |
| Tests, fixtures and evidence scripts | Reuse as an implementation-independent acceptance suite |

The current `@form/music-notation` package is internal project code. External renderers/editors are adapters around this foundation, unless a separately reviewed migration proves that replacing a specific internal function is beneficial and safe.

## 3. Candidate roles

| Candidate | Trial role | Evidence so far | Main integration question |
| --- | --- | --- | --- |
| VexFlow 5 | Alternative sheet renderer with our editing interactions | Real recording rendered; per-glyph hit geometry and virtual horizontal strip exercised | Can Phase 6 gestures, selection and cursors use VexFlow geometry cleanly? |
| Signal | Alternative piano-roll surface/gesture implementation | Seven actual-source editing-engine checks passed; full visual UI not benchmarked | Can its visual feature run locally and send commands into our workspace without bringing a second authority? |
| Smoosic | Alternative richer sheet editor | Real score imported/rendered; horizontal mode and chord selection work | Can its UI actions be intercepted before its default destructive score mutations, while preserving occurrence mappings? |

VexFlow and Smoosic are competing sheet strategies. Smoosic already uses its own VexFlow fork; do not automatically add two independent notation renderers to the same sheet view. Signal can be paired with either sheet strategy or with our custom sheet, if it passes its own gate.

Previous findings live in `docs/qualification/vexflow-evaluation/report.md` and `docs/qualification/editor-comparison/report.md`. Engine timings are not UI benchmarks. Smoosic's tested duration stretch consumed/replaced a neighbouring note; that operation must not be adopted unchanged.

## 4. Stage A — preserve and review the baseline

Developer work:

1. Preserve the submitted Phase 6 commit with a clearly named baseline branch/tag, for example `baseline/piano-workspace-phase6-custom`. Confirm that the referenced commit contains the intended product implementation and required evidence. Do not fold unrelated evaluation artifacts or large dependency caches into that checkpoint.
2. Keep `phase6/visual-editing` available. Conduct comparison work in a separate branch/worktree so the baseline and shared workspace remain reviewable.
3. Review Phase 6 against the existing plan: edit isolation, tie/logical-note scope, cancellation/pointer loss, one gesture/one history entry, explicit replacement/insertion, exact timing and save/reopen. Record known baseline defects; do not call the checkpoint accepted simply because it is backed up.
4. Capture the same short editing tasks on the real recording and controlled fixtures. Record engraving quality, number of steps, selection ambiguity, responsiveness and save fidelity. These are the comparison baseline.

Gate: a reproducible custom baseline, known limitations, preserved commit, and no Phase 7 work. Baseline review and library trials can proceed without waiting for unrelated visual refinements, but correctness defects must remain visible in the comparison.

## 5. Stage B — introduce a narrow surface boundary

Refactor only enough to make the sheet and roll interchangeable. Demonstrate that the custom surfaces still behave identically before adopting an external surface.

The workspace owns:

- Immutable document input and stable occurrence/logical/segment identities.
- Selection and active occurrence ids.
- Video-derived time, offset, alignment, playback controls and audition.
- A command dispatcher, status/rejection reporting and history.
- Viewport/reveal/follow requests and saved/recovery state.

Each surface adapter owns:

- Drawing, hit geometry and its internal layout cache.
- Pointer/keyboard interpretation and an ephemeral gesture preview.
- Mapping between its native objects and workspace ids.
- Geometry needed for cursor placement and musical-position navigation.

A surface reports selection, audition and gesture requests to the host. Preview is temporary: it does not dirty/save the document or create history. A completed gesture issues one validated command; Escape or pointer loss issues none. On rejection, the adapter returns to the canonical document and shows the reason.

External score/song objects may be disposable projections or gesture previews. They must not become an independently saved note dataset. Suppress external autoplay, independent transport and local-storage persistence where they conflict with the host. Shared undo/redo must not compete with a library's history.

Use development-only composition switches, conceptually:

- Sheet: `custom`, `vexflow`, or `smoosic`.
- Roll: `custom` or `signal`.

Mount only the chosen surface. Do not keep several hidden editors running their own clocks/listeners. Switch only after cancelling active gestures/modes, preserving document, selection, playhead and musical viewport. Renderer switching must not change the document or create a migration/save.

Gate: the custom/custom composition passes its previous checks through the new boundary; save format and normal routes are unchanged.

## 6. Stage C — bounded adoption trials

### C1. VexFlow sheet trial: first implementation candidate

- Convert existing written segments to VexFlow notation; retain ids and the original performance data outside the renderer.
- Use individual engraved notehead bounds, including displaced chord heads, rather than one event box.
- Carry over selected/sounding highlights, explicit ambiguity handling, pitch previews and Phase 6 commands.
- Supply rendered tick-to-x geometry for the score cursor, inverse seeking, reveal and linked scrolling. Engraved spacing is not a uniform seconds axis.
- Keep virtualised measure rendering and update engraving separately from frame-rate cursor/highlight changes.
- Demonstrate a real chord-member correction and written-duration change, undo/redo and save/reopen.

Gate: prefer this over custom sheet drawing only if notation/readability or maintenance benefit is clear and all correctness invariants remain intact.

### C2. Signal visual piano-roll trial

- Build/mount the visual feature locally from pinned source. Hosted access being blocked is not a visual-performance result.
- Identify the minimum required providers, geometry and interaction modules; record dependencies and modifications.
- Preserve a stable Signal numeric-id ↔ workspace occurrence-id map.
- Route drag/resize/insert/delete results into our commands. If Signal needs an internal Song/Track, treat it as a controlled projection and reset it from the host after accepted or rejected transactions.
- Test Snap Off, exact seconds, one chord member, repeated pitches, cancellation and a single undo entry per gesture.
- Measure drawing/interaction on the real recording. Do not use model-only microbenchmarks to claim smoother UI.

Gate: adopt only if the actual visual feature improves the baseline enough to justify its providers, projection and maintenance cost. If extraction becomes an extensive fork, retain our roll unless a demonstrated usability benefit warrants it.

### C3. Smoosic sheet-editor trial

- Use its library/custom-UI capabilities and pin its own VexFlow dependency expectations.
- Prove stable mapping across import, chord selection, ties, duration changes and object replacement. Plain MusicXML interchange is not sufficient to preserve recorded occurrence ownership.
- Intercept duration and other edit intents before destructive mutations reach canonical state. The previously observed neighbouring-note replacement is a mandatory regression case.
- Compare its built-in controls against the simpler instructor-correction UX; remove unrelated composition controls and independent playback/storage/history.
- Verify its first-click chord selection versus subsequent individual-pitch selection fits our UX, or quantify the customisation needed.

Gate: adopt the editor only if its additional functionality saves more work than the mapping/command/UI adapter adds. If the operation boundary cannot be controlled reliably, do not use its editing engine for canonical changes. A renderer-only role must be compared with the simpler VexFlow trial rather than presumed worthwhile.

The trials are bounded proofs, not commitments to ship all libraries. Stop a trial once a critical incompatibility is demonstrated and documented; do not rewrite the accepted foundation merely to make a candidate fit.

## 7. Common comparison gate

Run the same tasks against the custom baseline and each viable candidate composition:

| Area | Required evidence |
| --- | --- |
| Musical readability | Real dense passages, two staves/voices, ties, rests, dots, accidentals and clear selected/sounding states |
| Selection | Individual chord pitches, repeated pitches, shared written notes and overlapping hit targets; explicit candidates where necessary |
| Safe editing | Pitch, onset, recorded length, written duration and respelling; neighbour preservation; invalid overlap rejection |
| Gestures/history | Real pointer interactions; Escape, pointer loss and cancellation; one completed drag/one undo; cross-view undo/redo |
| Keyboard | Audition without random edits; explicit replacement target/cancel; overlap candidates |
| Time/scroll | Nonzero viewport, independent recorded/written timing, explanation holds, positive/negative offset and shared video clock |
| Persistence | Same corrections survive the real Phase 5 payload/validation/reopen contract, including spelling and anchors |
| Recovery | Failure/conflict and delayed-save protection stay intact; renderer changes do not create alternate saves |
| Performance | Real 1,338-note clip; measured visible render, navigation and UI edit latency with equal viewport/scale/hardware; document test limits |
| Engineering cost | Adapter size, library modifications, dependencies/assets, supported APIs, upgrade risk and maintenance responsibility |

Use controlled fixtures for behaviours absent from the real recording. Physical touch-device qualification remains in Phase 7, but a candidate must expose usable touch targets and numeric alternatives. A release recommendation cannot rely on an attractive screenshot, a single-note demo or an unmounted editor package.

## 8. Stage D — select a composition and retain the fallback

Produce a short decision record with evidence and an explicit per-surface choice. Valid outcomes include custom/custom, VexFlow/custom, VexFlow/Signal or Smoosic/custom. Using every library is not a success criterion.

Keep the custom surfaces behind development switches during integration and qualification. Retain the preserved Git checkpoint regardless of which runtime path wins. Maintain one canonical document and one save format, so fallback does not require migrating or downgrading a lesson.

If a library fails to render or commit, cancel its pending gesture and reopen the same canonical document in the custom surface with an honest message. Do not silently apply a partial library state or retry a commit twice. Test switching back after an edited/saved lesson.

Avoid maintaining two equally expanding products indefinitely. During qualification, custom fallback receives necessary compatibility fixes, while new UX work targets the chosen path. After the chosen path passes normal-route/device qualification, separately decide whether to keep a supported runtime fallback or retain the custom implementation only as a Git rollback checkpoint.

## 9. Stage E — resume the original roadmap

Once Phase 6 correctness and the selected composition are accepted:

- Phase 7 integrates the chosen workspace into normal review/revision routes and qualifies devices, accessibility, navigation and performance.
- Phase 8 implements formatted final sheets and export, using the chosen notation foundation where useful.
- Re-run affected gates if a library integration changes behaviour after an earlier phase was accepted.

No normal review-page replacement, deletion of the custom path, publication or deployment is authorised by this strategy alone.

## Immediate developer handoff

Preserve `8d92b53` as the custom baseline and keep Phase 7 paused. Prepare the current editor for independent review. In a separate comparison branch, establish the minimal surface boundary and implement the VexFlow sheet trial first. Keep Signal's visual trial and Smoosic's command-adapter trial bounded and evidence-driven. Bring the comparison and per-surface recommendation back for review before committing to migration. Preserve all Phase 2–5 foundations and the custom fallback throughout.
