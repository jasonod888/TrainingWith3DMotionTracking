# Piano workspace: final Phase 7 completion contract

Prepared 15 November 2026 (Singapore). Baseline: `242f376d29442c561a81f5b0aa678152421612ea`, branch `phase7/normal-route`.

## 1. Purpose and authority

Finish the normal-route piano correction workspace with usable performance and an actual-device qualification. Preserve the existing keyboard, piano roll, continuous score, shared occurrence commands, source clock, alignment, history, private save and recovery architecture.

This is the single remaining-work handoff for Phase 7. It consolidates the earlier stabilisation handoff and reviews; it does not ask for their completed repairs to be implemented again. Earlier reports and the O/S/R/A matrix remain regression evidence. Historical failures recorded in those reports are not automatically current failures.

No library migration, engraving redesign, additional editing feature, deployment or Phase 8 work is requested. The developer may investigate and optimise implementation details without another permission request. A change to supported limits or acceptance targets is a product decision requiring a concrete proposal and explicit approval.

This contract freezes scope. Review may reopen an item only for a reproducible regression, data-integrity risk, failure of a check listed here, or evidence that does not support its claim. Unrelated improvements go into a separate backlog. No finite checklist guarantees that software has no defects; this document defines what must be delivered for this phase.

## 2. Starting status: do not rebuild completed work

| Area | Starting status | Required action |
|---|---|---|
| Normal review/revision integration, library journey and saved-only load | Previously passing targeted evidence | Retain and rerun regression evidence on final code |
| Verification transaction/schema/reversal/recovery matrix | Previously passing targeted evidence | Retain shared contract; rerun ordinary tests and existing browser subset |
| Async decisions A2/A3/A4 and save-refresh race A7 | Closed by targeted independent checks | Preserve; rerun after optimisation |
| Dirty-after-full-undo regression | Independently confirmed fixed at this baseline | Preserve; include saved-point/branching coverage below |
| Benchmark percentile and actual undo/redo checks | Implementation reviewed; latest timing values developer-reported | Retain corrections and deliver final reproducible measurements |
| Performance | Open: medians improved; tails and maximum remain unqualified | Complete section 3 or submit the bounded decision proposal |
| Physical touch | Hardware blocked, not a software failure | Owner/developer/device tester completes section 5 |

## 3. Workstream A: performance, with a stopping rule

### A1. Profile before changing more code

Use the production build for acceptance measurements, with the dev server only for debugging. Record the exact build command, serving command, commit, OS, CPU, RAM, browser/version, viewport and display refresh rate. Use the same reference desktop for before/after comparison; document whether CPU throttling is enabled. Do not compare a throttled baseline to an unthrottled result.

Capture browser performance traces for a representative pitch edit and the worst measured slow interaction at the real recording and maximum supported size. Separate command/clone/validation/derived notation, patch/history, React work, layout/paint, recovery serialization/storage, and GC where the trace supports attribution. Identify the dominant measured costs, then optimise those costs. Do not weaken validation, skip history/recovery, postpone required work beyond the measurement window, or disable an advertised feature to make a benchmark pass.

### A2. Exact fixtures and journeys

Use:

1. The real 209.594-second, 1,338-occurrence recording with its actual IDs and mappings.
2. A valid 20,000-occurrence fixture spanning the supported 512 measures. Include dense chords/repeated pitch, shared logical mappings, tied notes and at least one held/explanation passage. Validate fixture ownership, notation and alignment before timing it. Clearly distinguish occurrence count, written event count and rendered noteheads.
3. The existing 5k/10k fixtures when useful to locate a size-related slowdown or substantiate a supported-limit proposal; these intermediate sizes are not a replacement for the current maximum.

For the real and maximum fixtures, exercise the existing supported interactions:

| Journey | What must be observed |
|---|---|
| Roll pitch, exact-time move, recorded-length resize | Preview latency, completed command latency, one history entry, exact target values |
| Sheet pitch drag; Keyboard Replace | Same occurrence corrected through the shared command path; unrelated occurrences unchanged |
| Written duration and spelling/accidental control | Authored versus recorded independence remains correct |
| Add/delete and an existing valid detach/structural case | Successful result or the established explicit rejection; no omitted neighbour notes |
| Undo/redo | Actual document restoration/reapplication, selection validity, dirty state and retained history |
| Pan/zoom and cross-view selection/reveal | Responsive view update; no musical edit or unintended source seek |
| Loaded-video play/pause/seek/rate and Follow | Both cursors follow the one source clock; no duplicate clock, offset accumulation or header overlap |
| Save payload and local recovery write/read | Correct complete payload; edits survive recovery; include their main-thread cost rather than hiding it |

For gesture latency, sample actual applied edits, not repeated no-ops. Alternate direction or restore the fixture between samples to avoid eventually hitting a pitch/voice/bounds limit. Track the selected occurrence by ID, not by whichever DOM note is first after sorting.

### A3. Measurement and pass criteria

The earlier wording specified one-frame preview and 100 ms commits but did not explicitly settle the percentile. That ambiguity has contributed to the repeated submissions. For this handoff, the acceptance interpretation is explicitly **p95**, not median-only. This is an explicit clarification now, not a claim that every earlier document already stated it.

| Item | Pass criterion |
|---|---|
| Pointer preview at the real and supported maximum size | p95 no more than one display-refresh interval on the named desktop (16.7 ms at 60 Hz) |
| The supported edit commands above, including actual undo/redo | p95 input-to-committed visible result no more than 100 ms at the real and supported maximum size |
| Correctness | Every timed sample is a valid applied edit with expected canonical result; a rejected/no-op sample is labelled and excluded from successful-edit timing, never silently counted as fast |
| Other navigation/playback/save/recovery journeys | Complete successfully without data loss, stuck interaction, unintended seek or cursor disagreement; report timing/frame gaps and main-thread long tasks separately. No new numeric threshold is invented for these journeys here |
| Maximum limits | Full supported data remains intact; exceeding 20,000 occurrences or 512 measures is clearly refused under the existing input contract, never silently truncated |

Run at least 20 valid samples per timed edit journey after a declared warm-up, in three separate runs. Report median, nearest-rank p95, maximum and raw samples per run; each run must meet the p95 criterion. Keep first-load/cold samples separate and report them. Report memory/history growth and long tasks; do not claim a maximum-latency guarantee merely because p95 passes.

Define the timing endpoints in the script and report. If using requestAnimationFrame plus DOM reads, call it a DOM/frame-boundary measurement; requestAnimationFrame itself does not prove the pixels were painted. Use browser traces/screenshots to corroborate visual feedback and identify stalls. Keep mocked API latency, actual media and real backend results explicitly separated.

Automated checks must verify complete unrelated-event preservation and expected target values; undo must restore the original document, not only one pitch or the enabled state of a button. Redo must reapply the expected change. Scripts exit nonzero if correctness assertions fail. A qualification runner must also report failure when the numeric gate fails; collecting a JSON file is not a qualification pass.

### A4. Bounded decision if performance still fails

Do not keep submitting isolated median improvements as completion. Complete one focused profiling/optimisation pass and run the final measurements. Then deliver exactly one of:

- **PERFORMANCE PASS:** all applicable p95 criteria met at the current supported maximum, with correctness and traces.
- **PERFORMANCE DECISION REQUIRED:** provide the traces and measured best result, remaining bottleneck, estimated implementation impact, and a concrete alternative. Specify the proposed occurrence/measure limits, measured performance at that exact boundary, behaviour for existing larger lessons, UI/API/import validation, and safe access/export/recovery of existing data. State any proposed latency-target change explicitly.

For the decision-required outcome, stop performance work for review; do not silently impose a lower cap or claim qualification. This is a product decision, not another invitation to guess what the reviewer wants. Following approval of an alternative, implement its agreed enforcement and qualify that exact boundary. A proposal alone is not acceptance.

## 4. Workstream B: preserve correctness on the final optimisation commit

No reconstruction of the feature set is requested. Run and retain the established tests. Extend only where needed to verify the affected optimisation paths.

### B1. Dirty/savepoint identity must remain correct

Assert at workspace level:

- Initial load -> edit -> full undo: exact baseline document/metadata, clean, no unsaved navigation warning.
- Save A -> edit B -> undo to A: clean; redo B: dirty.
- Undo -> different edit at the same history depth: dirty; no identity collision.
- Recovery or opening a different reference cannot be mistaken for the old saved snapshot.
- Existing delayed success/failure and A7 behaviour retain newer work and its checkpoint.

Keep a unique asynchronous transaction/snapshot identity where required; do not conflate a monotonic counter with content/savepoint identity. Retain bounded history and its existing eviction policy; no unbounded whole-document history is authorised.

### B2. Regression execution

From `apps/web`, run `npm test` and `npm run build` (the build includes TypeScript). Run the API alignment/review/edit/client-contract tests if persistence contracts changed; otherwise retain their most recent identified evidence and say they were not rerun. Do not claim independent verification of a developer-only run.

Run the existing normal-route E2E, library revision journey, loaded-clock/header checks, editing gestures and the O/S/R/A transaction/recovery subset on the final commit. Reuse the tracked scripts, including:

- `docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py`
- `docs/qualification/piano-workspace-phase-07/scripts/check-async-races.py`
- `docs/qualification/piano-workspace-phase-07/scripts/check-a7-refresh.py`
- The existing phase-07-review contract, baseline-shape, structural round-trip, verification/recovery/transition, settings and dirty-regression scripts.

Use the existing matrix mapping to identify the remaining legacy/empty/written-baseline and save-race checks; do not delete or weaken assertions. Record command, final SHA, exit status and raw output. All held network routes settle or abort in teardown; every test exits normally without forced termination. Resolve missing fixture/script paths in the committed checkout.

The complete matrix is a regression checklist, not an instruction to implement O1-O8/S1-S6/R1-R6/A1-A7 again. No new feature requirement is hidden in this section.

## 5. Workstream C: physical-touch qualification

The owner, developer or device tester must run this on at least one actual touch device using the supported narrow layout. Browser emulation is supplemental. Record final commit/build, device model, OS, browser/version, viewport, orientation, fixture identity and source-video availability. Use a test account/private fixture, not irreversible changes to a real lesson.

| ID | Physical-device action | Pass evidence |
|---|---|---|
| H1 | Open normal piano review; tap a note once | Selection only; matching occurrence visible in roll/score/keyboard; no accidental edit |
| H2 | Pan over empty background and over notes; scroll both musical views | Intended navigation works without accidental edit or source seek |
| H3 | Deliberately edit the selected note's pitch/time/length; use numeric alternatives | Correct target values, one history entry per completed gesture, no unrelated changes |
| H4 | Cancel an edit, interrupt a pointer, introduce a second pointer | Cancellation preserves the document; no foreign-pointer commit, stuck drag or stuck audition |
| H5 | Use sheet drag, Keyboard Replace and Add/Cancel | Correct occurrence, exclusive modes respected, controls remain reachable |
| H6 | Undo/redo and rotate portrait/landscape | History/selection intact; no page overflow or inaccessible inspector/save controls |
| H7 | Play/pause/seek/rate with actual playable media; scroll the page | Both cursors agree under the current map; video/header paint order correct; no stuck audio |
| H8 | Edit -> confirm -> save privately -> reopen; library -> Edit lesson -> save revision | Correct saved pitch/notation; correct revision base; reopened data agrees |
| H9 | Unsaved edit -> reload/recover; attempt app navigation | Honest local-not-server-saved recovery, edits restored, correct unsaved warning |

Provide a short recording covering gestures/playback and a per-row result with actual values/screenshots or request evidence where appropriate. Unsupported platform event simulation must be labelled; if a required cancellation case cannot be exercised, mark it untested rather than pass.

If hardware is unavailable, the developer submits **HARDWARE BLOCKED**, the completed software/performance evidence and this exact H1-H9 sheet. The owner arranges the device run. Do not spend further coding sessions trying to solve missing hardware. Full Phase 7 acceptance remains blocked until the run is completed or the owner explicitly changes that requirement.

## 6. Single final submission and reviewer decision

Submit one final commit identity and one updated handoff containing:

1. **Status table:** SOFTWARE REGRESSION PASS/FAIL; PERFORMANCE PASS/DECISION REQUIRED; HARDWARE PASS/BLOCKED/FAIL. These are separate statuses.
2. **Changes:** measured bottleneck, implemented optimisation, why derived notation/history/save/recovery remain correct. Correct historical fast-path claims if they do not match the submitted code.
3. **Regression map:** existing O/S/R/A coverage plus B1 and H1-H9, each with test/evidence path and actual result. Existing passing work may reference retained evidence; changed paths must have fresh results.
4. **Evidence:** executable commands, raw test output, benchmark raw samples and calculation, environment, traces and actual-device report/recording.
5. **Limitations/decision:** one concrete supported-limit/target proposal if needed; no ambiguous statement that all work is done except unspecified follow-up.

Do not remove a failing required test to obtain a green total, report an implemented behaviour as proven solely by reasoning, or submit another isolated latest-example fix as the complete phase.

### Review outcomes

| Final state | Decision |
|---|---|
| Regression checks pass, performance qualifies under approved limits/targets, hardware passes | Phase 7 eligible for GO after review; separate explicit GO authorises Phase 8 development |
| Software and performance pass; hardware unavailable | Software/performance closure recorded, HARDWARE BLOCKED; owner arranges testing; no repeated software submissions required |
| Software passes; performance does not | Review the concrete performance decision proposal; no median-only acceptance |
| Optimisation regresses a required behaviour | Fix the named regression and rerun its affected set plus ordinary checks |

Release/deployment approval remains separate. Phase 8 stays stopped under the current instructions; this handoff does not silently grant permission to begin it.

## Exact instruction to the developer

> Work from 242f376 and use this document as the single remaining Phase 7 contract. Keep closed functional work stable. Complete one trace-driven performance pass, verify the fixed p95 criteria and correctness at the real and current maximum fixtures, and retain the listed regression evidence on the final commit. If the performance criteria cannot be met in that pass, submit one concrete measured supported-limit/target proposal and stop for that decision. Have an actual-device tester complete H1-H9, or isolate HARDWARE BLOCKED with the test sheet ready for the owner. Submit one consolidated status/evidence pack. Do not start Phase 8, migrate libraries, deploy, or add unrelated features.
