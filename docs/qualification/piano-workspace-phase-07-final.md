# Phase 7 final submission — piano correction workspace

Final commit: HEAD of `phase7/normal-route` containing this handoff (parent `242f376d29442c561a81f5b0aa678152421612ea`; exact SHA reported in the submission message).
Branch: `phase7/normal-route`. Phase 8 remains stopped.

## 1. Status

| Area | Status |
| --- | --- |
| Software regression | **PASS** (saved-point eviction repaired; 493 tests) |
| Performance | **DECISION REQUIRED** — pitch-drag p95 passes at the real and 5k boundaries; full path matrix and the 20k maximum are not qualified |
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

## 12. Stopping point: architectural performance decision required

The 5,000-occurrence / **512-measure** fixture is now exact (`5000 notes · 500 chord events · 512 measures` at 60 BPM), and the real recording remains exact. The R1 saved-point identity survives count eviction (reviewer probe passes) and the normal-route save/undo/redo probe passes.

Production per-path measurement at that boundary shows a genuine architectural limit in structural commands:

| Path (5k boundary, three runs) | Commit p95 | Gate |
| --- | --- | --- |
| roll pitch / time / resize / sheet / Replace / accidental | 35–52 ms | pass |
| written duration | applies on a non-tied note with room: `Written value → 8 sixteenths`, single production sample **155 ms** | FAIL (>100) |
| respell | applies on a non-tied enharmonic note: `Respelled Bb4`, single production sample **142.8 ms** | FAIL (>100) |
| **add note** | **272.3 / 268.7 / 275.5 ms** | FAIL |
| **delete note** | **146.3 / 146.1 / 145.0 ms** | FAIL |

Written duration and respell also require the full derived rebuild, so they miss the same 100 ms gate at 5,000 even after a valid target is selected. Add/delete require `refreshNotation` to rebuild segments/ties/rests across the 512-measure document; the command cost scales with the document and misses the 100 ms commit target. The real-recording add path also reached 101.4 ms in one run (borderline). Pitch/time/resize/sheet/Replace/accidental pass at the boundary.

### Decision required

The completion contract forbids substituting a lower fixture or silently changing the target. Three options:

1. **Approve a lower interactive boundary** where every path passes. The real recording passes all measured paths except add at 101.4 ms in one run; a boundary below 1,338 would still need written/respell truthfully measured and is not recommended.
2. **Approve a separate latency target for structural commands** (add/delete/merge/split) — e.g., ≤300 ms at 5,000 occurrences — while keeping 100 ms for occurrence-only edits.
3. **Fund/authorise incremental derived-notation refresh** for structural commands so add/delete avoid rebuilding all segments/ties. This preserves the architecture but is a larger optimisation than this bounded pass.

Recommendation: option 3, with option 2 as an interim if a 5,000 interactive boundary is required immediately. The written/respell journeys must be made truthfully measurable (choose a voice with room / a note with an available enharmonic) before any boundary is called qualified.

No limit policy has been activated; the read-only/API/export implementation remains pending both this decision and owner approval. Hardware H1–H9 remains **BLOCKED**.
