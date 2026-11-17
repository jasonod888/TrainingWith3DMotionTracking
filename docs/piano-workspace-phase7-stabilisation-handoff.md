# Piano workspace — consolidated Phase 7 stabilisation handoff

Prepared 14 November 2026. Reviewed baseline: `e014caa796506b84426b7b7c117ab85258751317`, branch `phase7/normal-route`.

**Decision: Phase 7 is not accepted. Phase 8 remains stopped.** This document consolidates the remaining work into one stabilisation pass. Do not submit another isolated fix to just the latest example. Preserve the accepted document/command/history/alignment/save architecture and the original product scope.

## 1. Current review result

| Independently executed on this tree | Result |
| --- | --- |
| Empty-baseline recovery case | Pass: authored half note preserved |
| Missing-baseline recovery case | Pass |
| Current written-reversal case | Pass |
| TypeScript | Clean, exit 0 |
| Unchanged delete -> Accept -> Reject | Fail: 20 -> 19 -> 19; server response has 20 |
| Unchanged merge -> Accept -> Reject | Fail: 20 -> 19 -> 19; server response has 20 |
| Full 471-test suite and other reported scripts | Developer-reported this review, not independently repeated |

The latest W2 fix closes the demonstrated empty-baseline deletion case. It does not establish the complete reversal contract. New diagnostic: `docs/qualification/piano-workspace-phase-07-review/check-unchanged-structural-roundtrips.py`, output `unchanged-structural-results.json`. It drives the real workspace with controlled verification responses and the tracked fixture; no real lesson/server decision is changed.

Both structural cases report that the user changed the notes, even though no manual edit occurred. The guard requires original `event_ids` to exist in the accepted candidate, while the baseline capture deliberately omits notes deleted by delete/merge/split. Legitimate absence is being treated as an incomplete baseline. This illustrates the underlying problem: baseline production, baseline validation, inverse construction and recovery do not share one operation-aware contract.

This document replaces the approach of sending separate W/T/U examples as separate completion targets. Earlier reports and scripts remain regression evidence; use this consolidated matrix as the next submission checklist. Do not add unrelated product features, libraries, engraving redesign or Phase 8 work.

## 2. Stabilisation scope — fixed

Complete three workstreams:

1. **Software:** unify verification transaction/recovery semantics and prove the fixed matrix in sections 3–6, while retaining the existing route/edit/save behaviour.
2. **Performance:** produce the interactive and supported-limit evidence already required by the original plan, section 7.
3. **Hardware:** run the original physical-touch qualification, section 8. It may remain explicitly blocked while software work proceeds, but cannot be marked passed by emulation.

No deployment, publication or release is authorised. No VexFlow/Signal/Smoosic adoption is required for this pass. The review will distinguish these three statuses; it will not mark all Phase 7 complete from software test counts alone.

## 3. One shared transaction contract

Use a small shared, testable implementation for preparing, validating, committing and reversing a finding. Extract the current scattered logic as necessary; a new editor or second live document is not needed. Names below are illustrative.

### 3.1 Prepare a finding before committing anything

`prepareFinding(document, finding, alignment)` must:

- Validate supported operations, IDs and before-preconditions against the live document.
- Apply the entire sequence to an evolving candidate, not repeatedly to the original document.
- Validate ownership, voices, collisions, recorded bounds, exact timing and notation integrity after the sequence.
- Preserve server-defined vf-* occurrence identity and relevant nullable/zero metadata; calculate written placement through the current map.
- Return either a complete staged transaction, an unchanged result, or a rejection with no mutation. Unsupported/unrepresentable findings need an explicit reason before promising local application.
- Retain enough affected **before and after authored state** to make a future inverse safe. Reconstructing from performance snapshots alone cannot restore spelling, written rhythm, voices or mappings.

Reuse existing document patches/history where appropriate. Keep storage proportional to affected state, not whole-document copies per suggestion. There must still be one controlled document, one musical history and one source clock.

### 3.2 Represent presence AND absence explicitly

Use a versioned typed representation, for example a union of `present` with validated state and `absent` with an occurrence ID. A missing entry means unavailable/corrupt baseline; an explicit absent entry means the transaction intentionally removed that occurrence. Do not use `{}` as proof of either.

| Operation | Required accepted after-state |
| --- | --- |
| set_pitch | Target present with accepted sounding/written pitch and affected authored state |
| set_onset | Target present with accepted recorded onset; authored state remains as the contract specifies |
| add_note | Deterministic added ID present with accepted performance and notation |
| delete_note | Deleted ID explicitly absent; original authored state retained for safe restoration |
| merge | Original IDs explicitly absent; deterministic merged ID present |
| split_note | Original ID explicitly absent; every deterministic piece present |
| Compound finding | The combined final present/absent set after all edits, not incompatible intermediate states |

A real unchanged delete/merge must not be declared locally edited merely because its originals are absent. Conversely, unknown/missing baseline data must not be treated as intentional absence.

### 3.3 Validate once, use the same validator everywhere

Runtime and recovery must use the same schema and semantic validator. Check:

- Required operation-specific ID coverage; finding/report/source/base identity and version.
- Correct nested shapes; no empty/partial group masquerading as a complete transaction.
- Finite numbers; MIDI pitch integer 0–127; non-negative recorded onset; null duration means unknown, otherwise positive; nullable velocity remains distinct from zero and lies in 0–1 when present.
- Valid spelling and pitch agreement, supported staff/voice enums, valid written start/duration on the existing grid, and valid logical/event/performance links.
- Explicit absence conditions, bounded entry counts/size and compatibility with current clip/document identity.

Do not coerce null to zero/default velocity or silently filter invalid musical entries. Older valid notation/settings remain recoverable when their reversal descriptor is missing or invalid; show that reversal is unavailable and keep the document intact. Do not fabricate an accepted baseline from an already edited recovered document.

### 3.4 Guarded commit and reversal

- A finding applies as one atomic command/history entry. A failed or cancelled transaction changes no musical state or history.
- A safe unchanged inverse restores the actual authored before-state for the affected write set. It must preserve unrelated subsequent work.
- If an affected performance or authored field changed, do not overwrite it. Report explicit reconciliation and preserve the live state. Cover written duration/start, spelling, voice and logical mapping as well as pitch/onset/recorded length/velocity.
- Revalidate against live state after network responses, not only at click time.
- Repeated Accept/Reject must follow a defined idempotent policy and must not duplicate notes or history.
- Musical Undo/Redo and server verification decisions are different state transitions: neither may silently claim the other has been updated. Define the resulting reconciliation state.
- Server acknowledgement, local application and complete save are separate outcomes. Report each truthfully. Retain recovery while a decision or save is unresolved; do not advance a token or navigate over newer work based on a stale closure.

For an unsupported operation, make its limitation visible and refuse safely. Do not advertise supported structural reversal while permanently refusing every valid unchanged case. Do not mutate the server decision and quietly leave an unexplained divergent local result.

## 4. Fixed software test matrix

Use parameterised pure tests for transaction/validator coverage and a smaller browser subset for UI wiring and async lifecycle. A single green reproducer is not completion. Not every state needs a separate expensive browser test.

### 4.1 Operations (all six plus compound)

| ID | Case | Required evidence |
| --- | --- | --- |
| O1 | set_pitch | Accept/reject round trip retains exact recorded fields, original authored spelling and unrelated notes |
| O2 | set_onset | Exact seconds survive; no implicit tick rounding with Snap Off; inverse restores correct recorded state |
| O3 | add_note | Correct vf-* ID, metadata, map placement and independent written/recorded durations; unchanged rejection removes only the addition |
| O4 | delete_note | Explicit absence after acceptance; unchanged inverse restores original identity, mappings and authored state |
| O5 | merge | Originals absent/new ID present; unchanged inverse restores both originals, including valid shared mappings |
| O6 | split_note | Original absent/all pieces present; unchanged inverse restores original and removes only the pieces |
| O7 | Compound finding, later command rejects | No partial edits, no dropped notes, no false success, no history entry |
| O8 | Repeated accept/reject and accept after reject | Defined idempotency, no duplicate IDs or phantom history |

For O4/O5, the new unchanged structural round-trip script currently fails. Use it as evidence within the matrix, not as the whole repair target. Where notation cannot represent a proposed result, reject with the correct reason and preserve data; include a valid representable fixture for each supported operation.

### 4.2 Shared state families

Exercise these for each operation where applicable; document an actual contract reason for N/A.

| ID | State family | Required outcome |
| --- | --- | --- |
| S1 | No later local edits | Valid inverse succeeds, with affected original data restored |
| S2 | Later related performance edit: pitch/onset/length/velocity | No silent overwrite or deletion; explicit conflict |
| S3 | Later related notation edit: spelling/written start/duration/voice/mapping | Same protection, including tied and many-to-one fixtures |
| S4 | Unrelated local edit | Preserved; inverse may apply when its actual write set remains compatible |
| S5 | Unknown/null and zero values | No conversion of unknown to zero/default; valid zero velocity retained |
| S6 | Undo/redo before/after decision changes | Document/mappings/selection correct; server decision state not falsely claimed changed |
| R1 | Valid recovery then inverse | Same guarantees as before reload |
| R2 | Older recovery without reversal descriptor | Work restores; unsafe inverse explicitly refused |
| R3 | Empty/partial descriptor, wrong IDs, missing affected entry | No authorisation from vacuous checks; work preserved |
| R4 | Malformed nested values/types/ranges/spelling | Validator refuses descriptor safely without discarding otherwise valid work |
| R5 | Wrong account/source/draft/base/report identity | No silent cross-identity restoration/reversal; existing explicit stale-base policy retained |
| R6 | Save/reopen and accepted decision loaded from server | Original notation is preserved; missing reversible baseline handled honestly |

### 4.3 Async and save families

| ID | Scenario | Required outcome |
| --- | --- | --- |
| A1 | Local conflicting edit before acceptance | Preconditions detect it before local mutation |
| A2 | Related edit while decision pending | Live recheck preserves newer edit and reports reconciliation |
| A3 | Unrelated edit while decision pending | Preserved without replacing the entire document |
| A4 | Verification 409, refreshed diagnostics and token | Document/recovery retained; token follows an explicit safe reconciliation policy |
| A5 | Submit save A, edit B, success A | B stays mounted, dirty, checkpointed and saveable; no false current Saved |
| A6 | Submit save A, edit B, failure A | Same retention plus truthful failure and bounded retry |
| A7 | Current revision save acknowledged, then edit during manifest refresh | No stale automatic navigation over the new edit |

Use bounded deferred responses with guaranteed teardown. Every held route must settle or abort during cleanup. Tests must exit normally; no process.exit/forced runner termination and no deleting a required failing test to make totals green. If a particular test harness cannot support a case, replace it with a reliable browser test preserving the assertion and document that change.

## 5. Existing integration regression set — retain, do not rebuild

Re-run the previously established routes and user journeys on the final stabilisation commit:

- Normal piano draft review, saved-only entry without proposal, slow/late/failed proposal, valid versioned manifest contract and legacy reference fallback.
- Actual library card -> Edit lesson -> private revision POST with exact base_revision_id -> reopened correction. Preserve release/access semantics and guitar review/revision restrictions.
- Keyboard, roll and sheet selection; individual chord-member and repeated-pitch isolation; drag/time/resize; cancellation/pointer loss/foreign pointer; Add/Replace exclusivity; one completed gesture/transaction per undo step.
- Written versus recorded duration, accidentals versus respelling, explicit written scope, ties/multi-occurrence mappings and unsupported voice rejection.
- Dirty/confirmation and app chrome/Back/history/reload guards, settings-only changes, failed save/conflict/recovery and preview stale/original fallback.
- Teaching section coverage/shared boundaries/split/remove and assessment recovery/save. Passage edits must either be coherent with map/score or remain honestly refused under the existing limitation.
- Play/pause/seek/rate/end with loaded video, both cursor values, nonzero offset, scroll without seek, source playhead and header paint order while scrolling. Preserve the current seekable-asset checks.

Assert canonical IDs/values, affected mappings, unrelated-event equality, history/dirty state and network payloads. Selection labels, cursor existence or a green status line alone are not substitutes. Keep tested fixture versus actual-source/device conditions explicit.

The existing tracked reviewer scripts are reusable evidence. Add the transaction matrix to the ordinary meaningful test suite so the developer runs it before submission; do not leave new core logic covered only by an external reviewer script. Passing 471 old tests does not prove new decision-state cases.

## 6. One consolidated submission, not another patch loop

Deliver:

1. One exact final commit identity; a concise explanation of the shared contract and affected code.
2. A results table mapping **O1–O8, S1–S6, R1–R6, A1–A7** to tests, pass/fail and fixture identities. Record applicable parameter coverage rather than just a total. N/A needs a reason tied to the supported contract.
3. Current document/performance/notation before/after examples for structural round trips, conflict refusal and recovery. Validate mapping/ownership integrity and complete unrelated-note preservation.
4. Relevant command/reducer/validator tests plus the normal web, typecheck and build checks; preserved browser scripts and raw results. Distinguish independent from developer-reported runs.
5. Performance evidence from section 7 and a physical-device result or explicit hardware-only block from section 8.
6. A precise limitations list. Any unsupported inverse/action must be visibly and safely limited, not presented as a successful implementation.

Do not begin Phase 8 until review. The review will assess this fixed contract/matrix as a whole. Findings outside this agreed scope should be recorded separately unless they are direct regressions, data-loss risks or blockers to the original required journeys; do not silently introduce unrelated new feature requirements.

## 7. Performance qualification — separate software evidence

This was already required by the original detailed plan (§14), not a new gate. Measure:

- Real 209.6-second / 1,338-occurrence recording.
- Valid fixtures at the supported limits: currently **20,000 events / 512 measures**. Include dense chords, repeated pitch, long/tied notes, rubato/held passages; clearly reject over-limit input.
- Pointer preview responsiveness, edit commit, pan/zoom/scroll, selection/reveal, playback/cursor agreement, undo/redo, save-payload construction and recovery write/read. Report frame gaps/long tasks and memory/history growth where relevant, not just DOMContentLoaded and mounted-node count.
- Named hardware/browser/build mode, viewport, runs/sample count and median/p95/worst. Keep mocked network, actual media and API timings distinguished.

The original proposed desktop target is pointer preview within one normal-refresh frame and real-example edit commits within 100 ms. Measure it; do not claim it from unit timing or set new arbitrary thresholds. If the current supported maximum is not usable, propose a concrete lower supported limit with clear UI/API handling and measured evidence for review. Do not silently drop notes or call limits supported without qualification.

No physical touch device is needed to perform this desktop profiling. Optimise demonstrated bottlenecks only.

## 8. Physical-touch qualification — explicit hardware gate

After software stabilisation, the owner/developer/device lab must record the final commit, physical device, OS, browser/version, orientation and results for:

- First tap selection, background and over-note swipe/pan, deliberate pitch/time/resize editing and numeric alternatives.
- Cancellation/lost capture, second pointer, orientation/reflow, undo/redo and no stuck audition.
- Reachability of keyboard, both scroll surfaces, loaded video, inspector and save actions; no page overflow, obscured selection or video/header overlap while scrolling.
- Confirm/save/reopen, recovery, navigation warning and private revision creation on narrow layout.

Emulation remains supplemental. If no hardware is available, submit completed software/performance work with **HARDWARE BLOCKED** and stop. That is a different state from unresolved software defects; neither is a Phase 7 GO. Phase 8 and release remain unauthorised until their respective explicit decisions.

## 9. Exact kickoff instruction for the developer

> Read this consolidated handoff and complete one Phase 7 stabilisation pass on the current architecture. Fix the operation-aware transaction/baseline contract, including present versus intentionally absent occurrences, and cover the complete O/S/R/A matrix before resubmitting. Preserve all prior acceptance probes and normal-route behaviour. Do not submit only another latest-case patch. Supply one commit, mapped test evidence, performance qualification and either a physical-device report or a clearly isolated hardware block. Keep Phase 8 stopped. No library migration, unrelated feature work or release is requested.

No product code, Git branch, commit, publication or real server data was changed during this review; the only additions are review evidence and this handoff.
