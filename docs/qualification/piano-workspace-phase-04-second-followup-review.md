# Phase 4 — second follow-up review

Reviewed: 14 November 2026.
Submission: `b3f44a9329176c5b387b678532ee452d03cace24`.
Decision: **CHANGES REQUIRED — finish Phase 4; do not start Phase 5.**

## Verified progress

- Independently reran the full web suite: **431 passed, 0 failed**.
- Original reviewer reproducer: **5/5 passed**.
- Follow-up actual-harness reproducer: **2/2 passed**. Original-only playback stops audition; a mismatched preview remains disabled with no audio src.
- The harness now calls `usePianoPreviewAsset`, removing the direct unverified audio URL. The source-derived audition-stop fix addresses the reproduced no-preview failure.
- The new fixture genuinely uses 12 ms attack spacing. Submitted timing evidence includes occurrence mappings, a half-speed sample and seek checking. Authenticated browser measurements were inspected, not independently rerun.

## Outstanding acceptance requirement — supported Piano flow

Yes: automated evidence for the valid verified-preview harness path is required before acceptance. This is the existing R5/F1 requirement, not an additional phase or a request for a preview on the real recording.

There is already a passing `renderHook` test for a correctly hashed asset in `apps/web/tests/piano-source-components.test.tsx`, as well as a mismatch test. Reuse it; duplicating that test alone would not close the gap. The missing test is the integration after verification succeeds in the actual workspace.

Use controlled media doubles and a bounded frame scheduler, or an injected verified-preview result alongside the existing real-hook tests. Assert that:

1. Pending verification keeps Piano disabled; successful verification exposes the blob src and enables Piano.
2. Selecting Piano configures the existing source-driven controller; play/pause, seek, rate and offset changes reach the Piano element while the video remains the source clock.
3. Switching back to Original stops Piano and restores source audio; playback failure visibly falls back to Original. Merely stubbing the hook and asserting button enablement is insufficient controller-integration evidence.
4. Cleanup cancels scheduled callbacks, stops audition/Piano and revokes URLs in the layer that owns them. The test terminates normally and fails reliably on unmet assertions.

A jsdom limitation is a reason to use this seam, not to omit the successful path. If the real controller is used, model readyState, duration, paused state and media events rather than relying on jsdom decoding audio. Avoid a recursive zero-delay requestAnimationFrame stub. Prefer a normal automated test; an explicitly exiting probe must not conceal unfinished work or test failures.

## Timing qualification still needs precise claims

`check-timing.py` now tests genuine 12 ms-separated attacks, but its fixture clock is set and then sampled after two animation frames. This establishes settled activation at requested times; it does not by itself establish activation during a continuously advancing media clock. The current script also omits positive/negative offset cases and release boundaries, and its nonzero-viewport assertion accepts zero (`window_start >= 0`).

Complete the already requested controlled-clock boundary/offset coverage, enforce a genuinely nonzero viewport in that scenario, and label the stepped evidence accurately. The live rate/seek samples are useful separate evidence. Do not present these settled fixture samples as a replacement for a progressing frame-clock test.

Continue these Phase 4 acceptance corrections under the existing authorisation and resubmit. No further permission is needed to add the missing tests. No product page replacement, persistence or Phase 5 work is authorised by this review.
