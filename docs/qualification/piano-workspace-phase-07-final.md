# Phase 7 final submission — piano correction workspace

Branch `phase7/normal-route`. Phase 8 remains stopped.

## Status

| Area | Status |
| --- | --- |
| Software / performance | **PASS (developer-controlled)** — 497 web tests, TypeScript/build clean, 16-script regression set, canonical 3×20 path matrix, reviewer reproducers and negative controls pass |
| 5,000 limit integration | **IMPLEMENTED / TESTED / INACTIVE BY DEFAULT** — read-only enforcement and server boundary complete in controlled approved configuration; normal default remains unrestricted |
| Physical touch | **HARDWARE BLOCKED** — H1–H9 require the owner/device tester |
| Owner approval | **OUTSTANDING** — required before activating/deploying the 5,000 restriction |

Final commit: the commit containing this handoff (SHA in the submission message).

## R3-A — read-only enforcement (reviewer defect fixed)

The reviewer probe now passes: offset stays 0, assessment stays `none`, dirty stays false, and the download contains unchanged authored state.

- One policy is resolved from the live occurrence count and approval configuration.
- Musical commands, gesture commands, shortcuts and history are rejected by the reducer.
- Candidate commands that would create occurrence 5,001 are rejected atomically with no history.
- Save and verification Accept/Reject have callback preflight guards before any request.
- Offset, assessment, teaching sections, lesson settings and alignment/anchor/history controls are disabled; their setters/anchor commit/add-section callbacks also check the policy ref.
- Selection, scrolling, seeking, playback, viewing and export remain available.
- `check-readonly-mutations.py` exercises offset, assessment, add-section, save, apply/reset anchor, pitch gesture and (when present) decisions on a 5,001 lesson: canonical document, authored metadata, history, dirty/checkpoint and network state stay unchanged; **zero mutation requests**.
- `check-readonly-decision.py` renders a verification finding on a 5,001 lesson and proves Accept and Reject send **no request**.
- `check-limit-boundary.py`: 4,999 and 5,000 editable; 5,001 read-only.
- `check-readonly-integration.py`: banner, disabled save, rejected gesture with no history, and real download containing 5,001 occurrences plus authored identity.

## R3-B — server enforcement (reviewer defect fixed)

The policy is applied at the server operation boundary from authoritative current/proposed performance data, not optional client notation:

- `music_review.py` (review/private reference): proposed `proposal.events` count checked before preview invalidation, revision creation or asset writes.
- `music_edit.py` (private revision): proposed events checked before notation retention or storage.
- `music_verification.py` (verification decision): current draft event count checked before decision writes; over-limit lessons reject decisions.
- `music_notation.validate_notation` retains its notation-present guard.
- Existing larger lessons remain readable/exportable; guitar paths are unchanged; access/idempotency logic is untouched.

Reviewer direct route reproducer (notation omitted, 5,001 occurrences) now returns **HTTP 422**, writes no reference, and passes.

## R2 — canonical per-path verification (reviewer false positive fixed)

The reviewer’s corrupted-after-state probe passes (`verifier_accepts_corrupted_after_state=false`): a +10 ms onset change alongside a valid pitch edit is rejected.

The verifier now checks:

- **Pitch / sheet / Replace / accidental**: expected pitch; target onset, duration, velocity, confidence, optional, string, fret and performance ids unchanged; unrelated performance and mapping unchanged.
- **Time**: changed onset with pitch/duration/metadata preserved; authored events/segments/ties/measures/mapping unchanged.
- **Resize**: changed recorded duration with onset/pitch/duration-related fields and written timing preserved; unrelated performance/authored state unchanged.
- **Written duration**: exact expected ticks and scope; complete performance preservation; unrelated written events preserved.
- **Respell**: exact spelling, unchanged MIDI and recorded fields; unrelated authored state preserved.
- **Add**: intended ghost pitch, onset, written ticks, new identity and mapping, original occurrences preserved.
- **Delete**: exactly the intended identity removed and all remaining performance/mapping preserved.
- Every sample requires one history entry; Undo must equal the complete before document, Redo must equal the complete expected after document, and Undo/Redo are timed separately.

Negative controls: reviewer suppressed-resize passes; reviewer corrupted-pitch probe passes; Python tests reject no-op/wrong target, wrong written ticks, wrong respell, unchanged add/delete and a valid pitch edit with corrupted onset. Add retries only canonical-valid written candidates.

### Performance matrix

Production build, Chrome 157, Windows 11, i7-12700H, 1440×1000, no throttling, mocked API. Three independent runs, 20 valid samples per path per run, at the real recording and `5000 notes · 500 events · 512 measures`. All runs report 20/20 applied, 20/20 restored, 20/20 reapplied. Commit p95 (ms, min–max over runs):

| Path | Real 1,338 | 5,000 / 512 |
| --- | --- | --- |
| roll pitch | 19.4–29.1 | 49.3–53.4 |
| roll time | 26.0–26.2 | 35.1–54.0 |
| roll resize | 31.0–37.7 | 41.0–57.8 |
| sheet pitch | 26.7–31.8 | 34.8–52.5 |
| keyboard Replace | 36.8–40.0 | 47.0–70.3 |
| written duration | 33.1–34.9 | 45.3–67.3 |
| accidental | 24.7–27.3 | 33.1–46.3 |
| respell | 26.2–30.2 | 29.3–49.4 |
| add note | 74.4–95.4 | 65.3–87.1 |
| delete note | 62.9–67.9 | 35.6–57.1 |

Preview p95: real 3.3–7.8 ms, boundary 5.1–8.6 ms. Undo/Redo p95 are enforced by the runner (all ≤100 ms; e.g. boundary add undo 29.8–46.6, delete redo 24.0–39.4). Button transactions use one DOM frame boundary; gesture preview/commit use one frame each. Raw data: `phase7-paths.json` + `phase7-paths-run{1,2,3}.json`.

## Regression (final code)

- `npm test`: **497 passed**; `npm run build` and TypeScript clean.
- 16 regression scripts exit 0 (normal route/library, async A2/A3/A4, A7, transaction contract, baseline shape, verification/transitions/recovery, structural round trips, written/legacy/empty, settings, loaded clock, clip seek, integration).
- Reviewer saved-point eviction and normal-route savepoint pass; suppressed-resize negative control passes.
- Python policy/verifier tests: **7 passed**.
- Reviewer reproducers: read-only metadata, legacy 5,001 write and corrupted-onset verifier all pass.

## H1–H9 — HARDWARE BLOCKED

No physical device. All nine journeys are **NOT RUN**; this is not a pass. Build: `npm run build`, serve `dist`/preview; record commit, device/OS/browser, viewport/orientation and fixture/video.

| ID | Journey | Status |
| --- | --- | --- |
| H1 | Open review, tap note | NOT RUN |
| H2 | Pan/scroll both views | NOT RUN |
| H3 | Pitch/time/length edit, numeric alternatives | NOT RUN |
| H4 | Cancel/interruption/second pointer | NOT RUN |
| H5 | Sheet drag, Keyboard Replace, Add/Cancel | NOT RUN |
| H6 | Undo/redo, rotate | NOT RUN |
| H7 | Video play/pause/seek/rate | NOT RUN |
| H8 | Edit→confirm→save→reopen/library revision | NOT RUN |
| H9 | Unsaved reload/recover/navigation warning | NOT RUN |

## External actions

1. Owner approval of the 5,000/512 interactive boundary, then activation/deployment (deployment not authorised here).
2. H1–H9 physical-device qualification by the owner/device tester.
