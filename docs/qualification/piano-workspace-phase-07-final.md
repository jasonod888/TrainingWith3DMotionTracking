# Phase 7 final submission — piano correction workspace

Branch `phase7/normal-route`. Phase 8 remains stopped.

## Status

| Area | Status |
| --- | --- |
| Software regression | **PASS** — 497 tests, production build clean, 16 regression scripts, saved-point eviction/savepoint and negative control pass |
| Performance | **PASS** — real recording and exact 5,000-occurrence / 512-measure fixture, every path, 3 runs × 20 valid samples, canonical assertions, p95 ≤100 ms commit and ≤16.7 ms preview |
| 5,000 limit integration | **READY / INACTIVE** — approval-gated implementation and tests complete; default remains unrestricted pending owner approval |
| Physical touch | **HARDWARE BLOCKED** — H1–H9 require the owner/device tester |

Final commit: the commit containing this handoff (SHA reported in the submission message). Parent performance commit: `1c1f8ed`.

## R1 — saved-point identity (closed)

`historyIdentity` uses the top history entry (or a clean/evicted origin) and is independent of retained depth. Count eviction and evicted-root tests pass; reviewer `check-savedpoint-eviction.py` restores the exact document and `entry:history-500` after eviction. Normal-route save A → edit B → undo/redo passes.

## R2 — canonical performance evidence

### Measurement design

- Production build, `vite preview` at `http://localhost:4173`, Chrome 157, Windows 11, i7-12700H, 1440×1000, no CPU throttling, mocked API/local media.
- Three independent runs; 20 valid samples per path per run at both fixtures.
- A render-current read-only snapshot hook exposes the canonical document authority (not DOM text). Canonical snapshots are captured outside the timed interval.
- Per sample: before snapshot → timed action → after snapshot → exact target assertions and one-history-entry check → timed Undo → full canonical equality with before → timed Redo → full canonical equality with expected after.
- Undo/Redo latencies are recorded separately.
- A verifier failure makes the sample invalid and exits nonzero; no rejected/no-op action is counted.
- Reviewer negative control (suppressed resize via stubbed `gesture`) reports `benchmark_claims_applied=false` and exits 0.
- Python verifier-control tests prove unchanged pitch, wrong written ticks, wrong respell spelling, wrong insertion target and delete no-op fail.

### Fixtures

- Real recording: `1338 notes · 1146 events · 127 measures`, 209.594 s.
- Boundary: `5000 notes · 500 written events · 512 measures`, 60 BPM, explicit 10-note chords with gaps and enharmonic pitches. Occurrence identities are exact (`big-*`); no substitution.

### Results (commit p95 in ms, runs 1–3)

| Path | Real 1,338 | 5,000 / 512 |
| --- | --- | --- |
| roll pitch | 21.0–32.0 | 35.4–50.7 |
| roll time | 19.5–31.9 | 37.0–44.9 |
| roll resize | 22.4–31.6 | 39.5–50.9 |
| sheet pitch | 20.5–31.4 | 40.1–56.0 |
| keyboard Replace | 28.1–40.9 | 53.6–79.0 |
| written duration | 27.8–37.5 | 51.6–65.8 |
| accidental | 19.7–25.8 | 34.9–61.8 |
| respell | 24.5–28.7 | 39.9–50.7 |
| add note | 59.5–97.5 | 80.1–95.6 |
| delete note | 47.1–77.3 | 38.7–50.8 |

Gesture preview p95: real 3.0–8.1 ms, boundary 5.1–8.6 ms. Undo/Redo p95 ranges are recorded in `phase7-paths.json` (boundary undo 33.6–61.9 ms, redo 28.4–63.0 ms). All runs report 20/20 applied, 20/20 restored, 20/20 reapplied. Raw per-run data: `phase7-paths.json` (`run1`–`run3`, plus source run files `phase7-paths-run{1,2,3}.json`).

### Bottleneck repair retained

`refreshNotation` rebuilt `performance_map` with `performance.some` inside a nested loop (O(notes × performance)); a Set reduced refresh from ~90 ms to ~5–18 ms. The respell segment fast path, grouped rest lookup, spelling/decomposition caches, binary measure lookup and tie-pitch update remain. Validation, history, recovery and save semantics are unchanged.

## R3 — approved-limit integration (inactive)

- `apps/web/src/music/workspace/interactive-limit.ts`: 5,000 boundary, policy resolution, mutation guard, lossless export including document **and** authored state (alignment, offset, spans/sections, assessment, identity), recovery.
- `workspaceReducer`: rejects commands/commands-batches/undo/redo above 5,000 and rejects a candidate that would create occurrence 5,001, atomically and without history. 5,000 remains editable.
- Harness: read-only banner, save disabled, Undo/Redo disabled, inspector/sections disabled; `Download reference` downloads the export.
- Server: `apps/api/music_notation.py` calls `interactive_limit.write_error` during write validation when approved; reads of existing larger lessons remain untouched.
- Controlled configuration: `setInteractiveLimitApproved` / `__PIANO_INTERACTIVE_LIMIT_APPROVED__` for tests; shipped default is **inactive**.
- Tests:
  - 4/4 policy/export tests, including authored-state round-trip.
  - Reducer boundary test: 5,000→5,001 insert rejected, over-limit mutation rejected with no history.
  - `check-limit-boundary.py`: 4,999 and 5,000 editable, 5,001 read-only.
  - `check-readonly-integration.py`: 5,001 banner, save disabled, pitch gesture rejected atomically (history 0), actual download with 5,001 occurrences and authored identity.
  - 4/4 server-policy tests (unapproved/approved boundary, write guard, lossless export).

Activation still requires the owner’s explicit product approval; no production restriction or deployment has been activated.

## Regression

- `npm test`: **497 passed, 0 failed**; `npm run build` clean; TypeScript clean.
- `scripts/run-final-regressions.py`: all 16 checks exit 0 (normal route/library, async A2/A3/A4, A7, transaction contract, baseline shape, verification/transitions/recovery, structural round trips, written/legacy/empty, settings, loaded clock, clip seek, integration).
- Reviewer saved-point eviction and normal-route savepoint checks pass; path-verifier negative control passes.
- Tie-pitch fast-path repair included; redo canonical equality holds.

## H1–H9 — HARDWARE BLOCKED

No physical device was available. All nine journeys are **NOT RUN**; this is not a pass. Final build: `npm run build`, serve `dist` or use the existing preview; device tester should record commit, device/OS/browser, viewport/orientation and fixture/source video for each row.

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

## Outstanding external action

1. **Owner approval** of the 5,000-occurrence/512-measure interactive boundary, then activating the prepared configuration and deploying (deployment not authorised here).
2. **H1–H9 physical-device qualification** by the owner/device tester.
