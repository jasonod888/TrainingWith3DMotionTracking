# Phase 7 U1–U3 follow-up — CHANGES REQUIRED

Reviewed 14 November 2026. Commit `010f9bbd9c7b4d345a6f8cc3f9bc9591e32ef7a5`, branch `phase7/normal-route`.

**Phase 7 is not accepted; Phase 8 remains stopped.** The reported recovery and loaded-video fixes pass independently. One confirmed U1 authored-notation protection gap remains, in addition to physical-touch and performance qualification.

## Independently verified progress

| Check | Result |
| --- | --- |
| Earlier recovery cases | 2/2 pass: edited recorded length retained; B#3 restored after recovery |
| Loaded-clock checks | 4/4 pass: play/pause, rate, exact source-clock seek and both cursors, natural end |
| Exact seek measurements | Video 1.5 s; roll 1.5 s; score tick 1740, agreeing with the map |
| End measurements | ended=true, paused=true, currentTime=3 s |
| Full submitted normal-route/library/video/emulation script | Pass, normal exit 0 |
| TypeScript | Clean, exit 0 |
| New written-duration reversal case | **FAIL**, normal browser-run exit 1 |
| Web suite 471 and remaining component/Phase 6 probes | Developer-reported this review, not independently repeated |

The new seekable fixture/range responses resolve the earlier controlled-serving problem. The real asset endpoint already has range forwarding and Content-Range response handling in source; this commit's fixture changes should not be described as a new production asset-route implementation. All browser evidence here uses controlled API routes, not live authenticated saves.

The long-draft/3-second-video mismatch remains an explicit test limitation. These results prove the tested transport/cursor behaviours within the first three seconds, not whole-recording playback or maximum-size interactive performance. The library action and saved revision path continue to pass the submitted end-to-end checks.

## W1 — a later written-rhythm edit is still deleted by Reject (high)

Independent reproduction using the controlled add-note finding:

1. Accept the suggestion that creates `vf-add-1-a` at 3.5 s, pitch 48, recorded length 0.5 s.
2. Select that note and change **Written duration to Half (960 ticks)**. Recorded duration remains 0.5 s.
3. Reject the previously accepted finding.

Actual: `vf-add-1-a` is deleted, including the later authored half-note/tied segments. Expected under U1: keep that later correction and explain that the destructive reversal conflicts with local work.

The guard's `same` function compares performance pitch/onset/duration/velocity. It does not compare the affected authored notation, so a written-only correction appears unchanged to the guard. This is within the existing U1 requirement to protect later spelling/rhythm/mapping changes; it is not a request for a new feature.

Reproducer: `docs/qualification/piano-workspace-phase-07-review/check-written-reversal.py`.
Evidence: `written-reversal-results.json` alongside it, including the selected note's 960-tick written state immediately before Reject and its absence afterward. Run with `.venv-saas/Scripts/python.exe` from repository root and Vite at 127.0.0.1:5173. No real lesson or server decision is changed.

Required fix:

- Guard the relevant **authored after-state**, as well as performance, before destructive inverse commands. Include written duration/start, spelling, voice and affected logical mappings/segments where reversal would discard them.
- Prefer the existing document-patch/history machinery for a bounded affected-state transaction, with explicit baseline identity and recovery handling, rather than adding another field-specific exception. Preserve unrelated work; do not reset the whole document to an old snapshot.
- When the needed baseline is unavailable or changed, preserve the live document and report explicit reconciliation. An honest refused reversal is acceptable; silent loss of authored work is not.
- Retain the earlier pitch/recorded-length/recovery assertions, add this written-duration case, and cover written position/respelling, affected mappings and reload. Apply the guard to add/merge/split/delete inverses consistently.

## Remaining qualification

After W1, keep physical touch explicitly BLOCKED until an actual device/OS/browser run is submitted. Do not equate emulated PointerEvents with device qualification.

Interactive/upper-bound performance qualification also remains open, as stated in the handoff. The plan requires measurements or a specifically reviewed supported limit; the current page-load figures are not that profile. Supply editing, scrolling, playback and recovery/save measurements on the real recording and an agreed upper-bound fixture, or propose a concrete supported cap/limitation for review. No requirement is waived by the passing 3-second transport check.

No product code, Git branch, commit or release was changed during review. Continue the original implementation; no library pivot or restart is requested.
