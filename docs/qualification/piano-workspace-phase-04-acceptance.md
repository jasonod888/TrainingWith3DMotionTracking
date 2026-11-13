# Piano correction workspace — Phase 4 acceptance

Reviewed: 14 November 2026.
Accepted submission: `f3bb1703c934d3b668cf85c659af3799e3b17015`.
Decision: **GO — Phase 4 accepted. Proceed with Phase 5 only.**

## Basis for acceptance

The previous rounds established shared score time across explanation holds, strict alignment validation and inverse boundaries, offset-aware activation, frame-sensitive surface subscriptions, linked navigation, and session-local alignment authoring/history. The remaining verified-Piano integration and evidence gaps are now sufficiently addressed for the Phase 4 gate.

The new suite test renders the actual workspace with the real preview hook and source controller. Controlled media doubles demonstrate pending-to-verified asset gating, blob src enablement, offset mapping, source play/pause/seek/rate propagation, return to Original, visible failure fallback, and URL/frame cleanup. No real-draft preview or new backend was required.

The timing submission now distinguishes settled, stepped 12 ms fixture checks from live progressing source-clock measurements. Offset and release cases and a genuinely nonzero controlled viewport are recorded. The supplied live samples report 14.7 ms worst cursor lag, 17 ticks error and a 0.507-second media advance at half speed over approximately one wall second. These are measurements for the tested environment, not a universal device guarantee.

## Independent verification

- Full web suite: **433 passed, 0 failed**, exit 0.
- Supported Piano integration file independently: **2/2 passed**, normal exit.
- TypeScript `tsc --noEmit`: **passed**.
- Original Phase 4 reviewer reproducer: **5/5 passed**.
- Inspected product diff, integration test, revised timing assertions and committed timing results.
- Authenticated browser captures were not independently rerun. Live timing results remain developer-supplied evidence, reviewed alongside the code and tests.
- No product implementation or service data changed during review. A temporary diagnostic copy was used to investigate slow test startup and removed afterward.

## Non-blocking test maintenance

The integration tests emitted React `act(...)` warnings. Initial workspace opening took approximately 62–65 seconds in these review runs; the full suite completed in approximately 72 seconds. They did finish normally, so the initial suspicion of a hang was not confirmed. Wrap media-event/async test updates appropriately and investigate the slow startup as routine test maintenance; neither finding reopens this gate.

## Phase 5 authorisation and gate

Implement the existing **Persistence, verification and recovery** phase only. Keep the workspace isolated while exercising saves through the existing correction commands. Do not replace the normal review page or begin Phase 6 gestures.

Phase 5 must establish:

- Validated, versioned persistence of performance, authored notation and alignment; exact onset/recorded length and authored rhythm/spelling survive save/reopen without silent regeneration.
- Saved anchors and offset have explicit ownership and dirty/save state. Session-local Phase 4 controls must no longer disappear while the UI claims everything is saved.
- Submitted performance and notation disagreements reject clearly; legacy documents and clients follow the agreed validation-gated compatibility contracts.
- Ownership, source/reference identity, review-confirmation tokens, private revision semantics and idempotent finalisation remain intact.
- Save failures, conflicts and retries preserve user work; versioned local recovery checks account/draft/source identity and never labels a local checkpoint as server Saved.
- Audio identity invalidation follows relevant performance changes: pitch/time edits cannot leave stale Piano playback presented as current; spelling-only changes preserve valid audio.
- Evidence includes API/integration tests, saved payloads, round-trip examples, legacy compatibility and save-failure/reload recovery demonstrations.

Submit Phase 5 for review and stop before Phase 6. This GO authorises the next development phase, not deployment or publication.
