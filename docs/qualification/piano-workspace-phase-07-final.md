# Phase 7 final submission — piano correction workspace

Final commit: HEAD of `phase7/normal-route` containing this handoff (SHA reported in the submission message).
Branch: `phase7/normal-route`. Phase 8 remains stopped.

## 1. Status

| Area | Status |
| --- | --- |
| Software regression | **PASS** — 497 tests, build clean, 16 regression scripts, saved-point eviction and savepoint checks pass |
| Performance | **PASS** — real recording and exactly 5,000 occurrences / 512 measures, all applicable paths, 3×20 samples, p95 ≤100 ms commit and ≤16.7 ms preview |
| Physical touch | **BLOCKED** — no hardware available; H1–H9 sheet below |

## 2. Changes in this pass

- **Profiling result.** For the 1,338-note recording, one command spent ~26 ms rebuilding all derived segments/ties, ~8 ms in `structuredClone`, and ~0.4 ms validating; the rest was React/DOM work.
- **Fast occurrence path.** Pitch, recorded onset, recorded length and velocity commands validate without rebuilding every derived segment/tie. Single-occurrence pitch edits update the affected segment note (pitch/spelling/accidental/display flag) directly. Detach, merge, split and structural edits still use the full refresh.
- **Saved-point identity.** Dirty state no longer serializes the document per edit and no longer uses a revision counter. It uses `documentEpoch : historyPath : settingsMetadata`, where `historyPath` is history depth plus a unique id for the top history entry. Undo to the saved path is clean; redo and branching at the same depth differ. External document replacement bumps the epoch.
- **Benchmark corrections.** Production build, three runs, 20 samples each, 8 warm-up gestures removed from history before baseline, nearest-rank p95 and maximum reported, per-sample applied count, and actual Undo-to-disabled/Redo restoration checks. Traces captured for a real edit and a 20k edit.

Derived notation, shared occurrence commands, history patches, private save and recovery were not replaced; the fast path is limited to commands that cannot change event/segment structure.

## 3. Environment and commands

| Item | Value |
| --- | --- |
| OS | Windows 11 Home Single Language 10.0.26200 |
| CPU / RAM | 12th Gen Intel Core i7-12700H, 14 cores / 20 threads; 33,172,636 KB visible memory |
| Browser | Chrome 157.0.8103.78 (Playwright `channel=chrome`) |
| Viewport | 1440 × 1000 |
| Display | 60 Hz assumed for the one-frame criterion; refresh rate was not independently measured |
| Build | `cd apps/web; npm run build` (pass, 5.87 s) |
| Serve | `npx vite preview --port 4173 --strictPort` |
| Network | API intercepted by Playwright; local media fixture only; no CPU throttling |
| Timing endpoint | DOM/frame-boundary: dispatch → one requestAnimationFrame → DOM read; rAF is not a paint proof, traces/screenshots are included |

## 4. Performance evidence

Raw samples and per-run statistics: `phase7-performance.json` and `logs/performance.txt`.
Traces: `captures/trace-real-edit.zip`, `captures/trace-20k-edit.zip`.
Three runs per fixture; each run 20 applied samples after warm-up; every run reports `applied_samples=20`, `undo_restored=true`, `redo_reapplied=true`.

| Fixture | Preview p95 (runs 1–3) | Commit p95 (runs 1–3) | Gate |
| --- | --- | --- | --- |
| Real 1,338 / 209.6 s | 5.3, 5.1, 5.1 ms | 18.0, 17.8, 19.0 ms | **PASS** (≤16.7 / ≤100) |
| 5,000 events / 512 measures | 5.7, 5.7, 6.0 ms | 51.9, 54.6, 57.5 ms | **PASS** |
| 10,000 events | 9.2, 8.0, 7.4 ms | 100.6, 97.7, 102.2 ms | FAIL (2/3 over 100 ms) |
| 20,000 events (current maximum) | 9.1, 8.9, 10.4 ms | 188.6, 178.1, 179.8 ms | FAIL |

The real recording meets both p95 gates in every run. The current maximum does not; the dominant remaining cost scales with the rendered/derived document rather than command validation.

## 5. Performance decision proposal (requires approval)

**Proposal: interactive editing supported up to 5,000 occurrences and 512 measures; larger valid documents remain readable/exportable but not editable.**

- Measured exactly at the proposed boundary (see 5,000 row): preview p95 5.7–6.0 ms, commit p95 51.9–57.5 ms, all samples applied, undo/redo verified.
- The real 1,338-note example remains fully supported (p95 5.1–5.3 / 17.8–19.0 ms).
- 10,000 and 20,000 occurrences exceed the target; they are not accepted as interactive.
- Behaviour for larger existing lessons: open the workspace read-only with a clear banner; selection, playback, pan/zoom, score/roll/video viewing and both cursors remain available; export JSON/reference and export any local recovery checkpoint remain available; editing, save, verification decisions and add/delete are disabled; nothing is truncated or mutated.
- New review/revision inputs above 5,000 are rejected with an explicit validation message (or imported as read-only), not silently truncated. The storage/API limit may remain 20,000 so existing data remains accessible.
- No latency-target change is proposed; only the interactive occurrence limit.
- **Enforcement is not implemented** pending this decision; no cap has been silently applied.

## 6. Regression map

**B1 saved-point identity**
- `tests/workspace-state.test.tsx` — history-path identity through save point, undo, redo and branching at the same depth.
- `tests/workspace-editing-journeys.test.tsx` — clean after full undo, dirty after redo, dirty after branching.
- `scripts/check-savepoint.py` — normal route: save A clean, edit B dirty, undo to A clean, redo B dirty, actual pitch restored (`savepoint-results.json`).
- Recovery/reference epoch differences remain covered by the recovery scripts; delayed saves and A7 retain their prior checks.

**O/S/R/A matrix and integration** (retained; all exit 0 on this commit):

| Area | Evidence |
| --- | --- |
| Ordinary suite | `npm test` → 492 pass, 0 fail |
| Build/TypeScript | `npm run build` pass |
| Transaction matrix | `tests/verification-transaction.test.tsx` (19 tests) |
| Contract / baseline shape | `check-transaction-contract.py` 5/5; `check-baseline-shape.py` 2/2 |
| Verification/recovery/transitions | `check-verification.py`, `check-verification-recovery.py`, `check-verification-transitions.py` all pass |
| Structural round trips | delete and merge 20→19→20 |
| Written/legacy/empty baselines | all pass |
| Settings / loaded clock / clip seek | all pass |
| Normal route / library revision / A7 / async | `check-normal-route.py`, `check-a7-refresh.py`, `check-async-races.py` pass |
| Final runner | `scripts/run-final-regressions.py` records every command/exit in `logs/final-regression.json`; all 16 exited 0 |
| Full web tests/build | `logs/final-web-tests.txt`, `logs/final-build.txt` |

## 7. Physical touch — H1–H9 (BLOCKED)

No physical device is available. All rows are **NOT RUN**; this is not a pass. Evidence must record final commit, device/OS/browser, viewport/orientation, fixture and source-video availability.

| ID | Action | Status |
| --- | --- | --- |
| H1 | Open normal review, tap a note | NOT RUN |
| H2 | Pan over background/notes; scroll both views | NOT RUN |
| H3 | Edit pitch/time/length; numeric alternatives | NOT RUN |
| H4 | Cancel/pointer interruption/second pointer | NOT RUN |
| H5 | Sheet drag, Keyboard Replace, Add/Cancel | NOT RUN |
| H6 | Undo/redo; rotate portrait/landscape | NOT RUN |
| H7 | Loaded-video play/pause/seek/rate; scroll header | NOT RUN |
| H8 | Edit→confirm→save→reopen; library revision | NOT RUN |
| H9 | Unsaved reload/recover; app navigation warning | NOT RUN |

## 8. Limitations

- Performance at the current 20,000 maximum does not meet the p95 gates; the 5,000 interactive limit is a proposal only and is not enforced.
- Physical-touch qualification is hardware-blocked.
- The benchmark measures pointer edits after warm-up; first-load/cold samples are reported separately in the raw JSON (`domMs`/`loadMs`), and replay of other journeys is regression-tested rather than individually timed.
- Mocked API/local media; no backend timing or real media latency is claimed.

---

## 9. R1 eviction repair (this pass)

`historyIdentity` no longer includes retained depth. It is the top history-entry id while history exists, and distinguishes the true root (`origin`) from an evicted root (`origin:evicted`). Branching still changes the top entry id, and document replacement still advances `documentEpoch`.

- Reviewer `check-savedpoint-eviction.py`: **pass** — saved `entry:history-500`, post-eviction undo restores the exact document and the same identity with 499 retained entries.
- Ordinary test: fill `HISTORY_LIMIT`, save the identity, perform one more command (evicting the oldest patch), undo, assert the exact document and identity; undo to the empty evicted history is `origin:evicted`, distinct from a clean root. Byte-budget eviction shares the same `evicted` flag and identity rule.
- Normal-route save A → edit B → undo A → redo B still passes (`check-savepoint.py`).

## 10. Fixture and path-measurement status

The limit fixture now maps 1,084 source seconds with a 60 s held passage to exactly **1,024 score seconds = 512 measures**; the runner asserts the heading contains both the requested occurrence count and `512 measures` (5,000 notes / 512 measures; 2,000 probe also 512 measures).

A per-path production benchmark (`bench-paths.py`) was added for roll pitch/time/resize, sheet drag, keyboard Replace, written duration, accidental, respell, add/delete and undo/redo, with fresh pages per path, warm-up, three runs of 20 samples, applied/undo-restored assertions and p95 gating. Its measured latency gates showed no commit p95 failures at the real or 2,000 boundary, but correctness verifiers for written duration (tied target), respell (tied/duplicate target) and add-note (placement collision) did not reliably apply, so the path matrix is **not qualified** and no supported-limit decision is claimed from it. The earlier pitch-only production results (real/5k p95 pass) remain the only qualified timing evidence.

## 11. Decision status

Owner approval of a reduced interactive limit has **not** been granted (the review only recommends the direction). No read-only/API/export enforcement has been implemented, and no cap is claimed. Performance remains **DECISION REQUIRED**, with two blockers: completing trustworthy per-path measurements and obtaining the owner's explicit limit decision. Hardware remains **BLOCKED** under the H1–H9 sheet.

---

## 12. Decision resolved by the final optimisation

The earlier structural-command decision request is superseded. Profiling found the dominant cost was an O(notes x performance) `performance_map` rebuild inside `refreshNotation`. Replacing it with a single id `Set`, together with the respell segment fast path, grouped rest intervals, spelling/decomposition caches and binary measure lookup, reduced refresh from ~90 ms to ~5-18 ms at 5,000 occurrences. The add/delete/written/respell paths now qualify at the 100 ms commit p95 target. No latency-target change or lower interactive boundary is requested.

## 14. Final completion (software and performance)

### Performance qualification result — PASS

Production build, three independent runs, 20 valid applied samples per path per run, exact occurrence identities (`data-occurrence`), applied and document-restored counts all 20/20. Commit p95 values (ms):

| Path | Real 1,338 (runs 1–3) | 5,000 / 512 (runs 1–3) |
| --- | --- | --- |
| roll pitch | 19.6 / 26.3 / 24.1 | 38.9 / 38.8 / 39.9 |
| roll time | 19.9 / 20.1 / 19.0 | 36.7 / 37.4 / 37.8 |
| roll resize | 26.3 / 24.4 / 26.7 | 41.7 / 44.6 / 41.8 |
| sheet pitch | 20.7 / 20.1 / 20.3 | 37.4 / 37.4 / 43.1 |
| keyboard Replace | 29.4 / 30.5 / 28.7 | 52.1 / 53.1 / 56.8 |
| written duration | 29.0 / 26.9 / 27.6 | 51.0 / 54.2 / 55.3 |
| accidental | 20.6 / 19.8 / 21.7 | 37.3 / 42.9 / 38.3 |
| respell | 22.9 / 22.4 / 23.4 | 39.8 / 40.6 / 41.6 |
| add note | 57.4 / 68.4 / 63.4 | 73.1 / 75.9 / 81.2 |
| delete note | 46.4 / 53.6 / 48.8 | 37.7 / 40.6 / 48.6 |

Preview p95 on gesture paths is 4.2–8.6 ms (real) and 4.3–7.7 ms (5k), within one 60 Hz frame; non-gesture paths have no preview sample. Measurements are DOM/frame-boundary (pointer dispatch → rAF → DOM read), not painted-frame timestamps; production traces are retained. Raw per-run samples: `phase7-paths.json`.

### Bottleneck repair

The decisive cost was `refreshNotation` rebuilding `performance_map` with `performance.some` inside a nested loop — O(notes × performance) (about 57–85 ms on the 5,000 fixture). It now builds one id `Set`; refresh fell from ~90 ms to ~5–18 ms in direct Node measurement. Also:

- single-occurrence respell updates affected segment notes without a full derived rebuild;
- generated-rest intervals are grouped once per voice/measure instead of filtering all segments per measure;
- spelling/decomposition caches and binary measure lookup remove repeated work.

The full path matrix now meets the gates without weakening validation, history, recovery or save semantics.

### Interactive-limit policy — prepared, not activated

`apps/web/src/music/workspace/interactive-limit.ts` is the reviewable policy implementation:

- `INTERACTIVE_OCCURRENCE_LIMIT = 5000`; `INTERACTIVE_LIMIT_APPROVED = false`.
- `resolveInteractionPolicy` keeps editing active while unapproved; once approved, exactly 5,000 remains editable and 5,001+ becomes read-only with playback/selection/export.
- `guardMutation` returns the explicit read-only rejection code/message for mutation paths.
- `buildWorkspaceExport`/`serializeWorkspaceExport` preserve the complete notation and recovery payload for lossless reference/recovery export above the limit.
- `apps/web/tests/interactive-limit.test.tsx` covers the exact boundary, unapproved state, mutation guard, export round-trip and malformed input (4/4 pass).

The server-side counterpart `apps/api/interactive_limit.py` implements the same boundary, read-only capability list, mutation error and lossless reference/recovery export; `tests/test_interactive_limit.py` covers unapproved state, boundary/read-only guard and lossless export (3/3 pass).

No workspace route or API route imports the policy yet; nothing is restricted in production. Activation still requires the owner’s explicit approval. API behaviour for activation is specified as: keep the existing 20,000-occurrence storage/API validation for existing data, expose read-only capability for over-limit lessons, reject new over-limit review mutations with the same explicit code, and never truncate stored notation. Implementation remains gated on approval.

### Regression and hardware

- `npm test`: **497 passed, 0 failed**; production build clean.
- `scripts/run-final-regressions.py`: all 16 checks exit 0 (normal route, async A2/A3/A4, A7, transaction contract, baseline shape, verification/transitions/recovery, structural round trips, written/legacy/empty, settings, loaded clock, clip seek, integration).
- Reviewer saved-point eviction probe passes (`exactDocumentRestored=true`, identity independent of retained depth); normal-route save A → edit B → undo/redo passes.
- H1–H9 physical touch: **HARDWARE BLOCKED**; the final build instructions and sheet remain in section 7. No pass is claimed.
