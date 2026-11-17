# Phase 8 review decision — 095ee28

Reviewed 16 November 2026 (Singapore). Branch `phase8/formatted-score`, commit `095ee28a000e4aeb5fb0d204064a87350833ad47`.

## Decision

**Accept Phase 8's agreed software scope. C1–C3 are closed.** This closes the formatted-score development phase; it does not certify final release, authorise deployment, activate the interactive limit, or close Phase 7's deferred hardware/activation gates.

The scope remains a read-only, lightweight formatted score derived from the working NotationDocument, safe return to correction, and MusicXML export and saved-reference consistency. PDF, MIDI, hand inference and professional engraving features are not new acceptance requirements.

## Independent evidence on this tree

| Check | Result |
|---|---|
| `review-edge-probes.py` | 3/3 pass: 30 supported key signatures, A0/C8 ledger counts 6/9, real held-pointer pitch drag cancelled on keyboard entry to preview (pitch 69 unchanged, history 0 unchanged) |
| `review-probes.py` | 6/6 pass: visible staves, E4/F5/A3 anchors, nondefault scroll restoration, preview Delete blocked, same video/time/rate, returned playback clock advances |
| `scripts/check-formatted-score.py` | Exit 0: exact edited-note MusicXML match, unchanged working document across preview, selection/window preserved, private save and saved-only reopen agree |
| TypeScript `tsc --noEmit` | Exit 0, clean |
| Source review | Both roll and sheet cancel when editing is disabled, release capture and remove listeners. Both receive correction-only editing permission. The common gesture callback additionally refuses formatted-mode commits. Shared key-signature helper replaces the duplicate major-only map. Ledger loops no longer truncate at five. |
| Captures | Real page 1, Bbm, A0 and C8 inspected; signatures and extreme ledgers visible within the page |

Durable tests added by the developer cover all 30 keys, both ledger boundaries and in-flight pitch cancellation followed by a normal single-commit drag after returning. Broader roll time/resize and sheet cancellation share the inspected cancellation mechanism; they were not independently repeated as a complete gesture-family matrix in this review.

## Evidence qualification: lifecycle script

Do **not** describe every independent script as passing. `scripts/check-mode-lifecycle.py` exited 1 on two review runs because its returned-transport assertion compares the inspector text clock with native video time using a 150 ms tolerance. All other lifecycle fields passed: document, selection, history, nondefault scroll/zoom, same video, position/rate and pause-on-entry policy.

Recorded native/text pairs were 1.845664/1.67 s and 1.781932/1.63 s. The inspector deliberately updates every 250 ms (`PianoWorkspaceHarness.tsx`); at rate 0.75 the normal refresh interval spans 187.5 ms of media time. The failing differences (175.7 ms and 151.9 ms) fit that documented cadence. The separate original returned-playback probe passed. Consequently this is not evidence of a lost media connection and does not reopen C1–C3 or block this phase's software acceptance.

For future regression maintenance, measure the actual frame-subscribed cursor against native time in one browser evaluation, and test the coarse inspector label against its documented cadence separately. Retain the current failed review result honestly; do not claim it passed or merely widen a cursor timing requirement.

## Verification limits

The full 508-test suite, production build and all 16 Phase 7 scripts are developer-reported for this review, not independently re-executed. Independent browser checks and TypeScript above are the reviewer's evidence.

An additional reviewer gesture-family run was interrupted by automatic approval review because an unsolicited Visual Studio telemetry connection had an unknown payload and could disclose workspace/environment data to an unverified destination. It was not bypassed or retried. The temporary incomplete reviewer runner was removed; no result from it is claimed. This restriction is distinct from the passing three-case browser runner and source inspection.

## Carry-forward

- Phase 7 remains formally open under the existing decision allowing Phase 8 development to proceed.
- The 5,000-occurrence / 512-measure restriction remains inactive pending explicit owner approval and the previously requested activation audit.
- H1–H9 physical-device qualification remains HARDWARE BLOCKED / NOT RUN.
- MusicXML is the offered export. No PDF/MIDI, beams, dynamics, lyrics, non-tie slurs or hand separation is claimed.
- Final release and deployment remain unauthorised.

No further Phase 8 product correction round is requested on the evidence reviewed here. Record this acceptance, preserve the accepted SHA and move subsequent UX or engraving enhancements to separately agreed work.
