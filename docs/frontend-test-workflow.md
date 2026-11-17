# Frontend test workflow

The correction workspace and shared engine tests run through a small, checked-in
runner at `apps/web/tests/runner/run-tests.mjs`. It uses Node's built-in test runner
and the already-declared TypeScript compiler instead of `tsx`'s esbuild service.

## Why this runner exists

The previous `tsx --test` command was intermittently very slow: the same heavy
workspace UI test took under a second in one historical run and several hundred
seconds in others, and two full-suite attempts stalled after ~430 passing tests.
Normal `tsx` also starts an esbuild service process per test child. The maintained
runner keeps Node's own process isolation and reporting, but transpiles TS/TSX
in-process with the installed `typescript` package.

A separate, directly reproduced cause of the journey OOM and slow outlier was a test
assertion anti-pattern: `waitFor(() => assert.equal(domNode, null))` makes Node inspect
the whole JSDOM element when the condition is briefly false, which can allocate for tens
of seconds and abort the child with an out-of-memory error. Use a boolean check instead:
`assert.ok(domNode === null)`. The workspace journeys were corrected accordingly and
the heavy formatted/shared-surface group was split into independently scoped files so
one process does not carry every workspace scenario.

These are distinct facts: the maintained runner passes normal process-isolated tests
and the complete inventory, while a separate original-`tsx` comparison stalled at
import/TAP and was stopped. No claim is made that every tsx runtime cost was caused by
the DOM assertion issue, and no further tsx investigation is planned.

The loader is semantics-compatible for this repository:

- TypeScript/TSX syntax, JSX automatic runtime, ESM and type erasure use the project's
  declared TypeScript version.
- Extensionless relative imports resolve the same way as `tsx`/Vite.
- Syntax/transform errors throw a normal error and make the test process exit nonzero.
- It does **not** type-check. `npm run build` still runs `tsc --noEmit`; this is
  unchanged. Test runs are for behavior, not type checking.
- It only handles modules imported by tests. No CSS/asset imports are used by the test
  inventory; a future test importing CSS would need an explicit loader rule.

## Commands (run from `apps/web`)

```powershell
# While editing one area: workspace, shared timeline and formatted-score tests.
npm run test:focused

# One or more files; repeat --file for multiple.
npm run test:file -- tests/workspace-overview-follow.test.tsx
npm test -- --file tests/workspace-overview-follow.test.tsx
npm test -- --file tests/workspace-overview-follow.test.tsx --file tests/shared-timeline.test.ts

# One test by name inside a file.
npm test -- --file tests/workspace-formatted-lifecycle-journeys.test.tsx `
  --pattern "switching to formatted cancels active add/replace modes"

# The full engine + music-engine + web inventory. Run once before handoff, not per edit.
npm test
npm run test:full

# Print exactly which files a mode would run.
npm run test:list
node tests/runner/run-tests.mjs --focused --list
```

Useful bounded-run options:

```powershell
node tests/runner/run-tests.mjs --focused --concurrency=2
node tests/runner/run-tests.mjs --full --run-timeout=1800000 --test-timeout=180000
node tests/runner/run-tests.mjs --file tests/workspace-overview-follow.test.tsx --source-maps
```

Defaults: concurrency 1, per-test timeout 180 s, whole-run timeout 30 min. Value
options accept both `--name value` and `--name=value`; malformed values exit 2 before
any test starts. On run timeout or Ctrl+C the wrapper terminates the test process tree
(POSIX: SIGTERM then a bounded SIGKILL escalation; Windows: `taskkill /T /F` plus a
bounded fallback), clears the escalation timer and exits nonzero (124 for timeout,
130/143 for cancellation). A test timeout fails the test normally with a nonzero exit.
No test is skipped or force-exited to manufacture success. Source maps are off by
default for speed; `--source-maps` enables inline TypeScript maps for debugging only.

## Inventory and discovery

`--full` discovers and runs:

- `tests/engine/*.test.ts` (project root, 10 files)
- `tests/music-engine/*.test.ts` (6 files)
- `apps/web/tests/*.test.mjs` (32 files)
- `apps/web/tests/*.test.ts` (2 files: shared timeline and piano-key geometry)
- `apps/web/tests/*.test.tsx` (26 files)

Total: **76 files** currently. The independent full run before the full-range/Space work
reported **552/552 passing in 120.05 s** and build PASS. This bounded change adds nine
focused tests (geometry 2, waterfall 2, shell 1, overview/Space 4); focused inventory
is now **149 tests**; geometry/waterfall/compact extras run separately. A new full run
was not required for this change. The old package script did not include
`apps/web/tests/*.test.ts`,
so `shared-timeline.test.ts` was silently absent from full runs; it is now included.
The former 17-test journey file is split into three independently scoped files
(`workspace-editing-journeys`, `workspace-mode-journeys`,
`workspace-formatted-lifecycle-journeys`) with a shared setup helper; all assertions
and scenarios are preserved. `--focused` runs 16 files / **149 tests**: 14
`workspace-*.test.tsx` files (including the phase-1 shell, phase-2 contextual and
targeted phase-3 mobile-peek regression), `shared-timeline.test.ts` and
`formatted-score.test.tsx`.

The runner fails with exit 2 if a mode finds no files in an expected directory, or if a
`--file` path does not exist. It passes explicit paths to `node --test`; it does not
use shell glob expansion, so it behaves the same in PowerShell, cmd and POSIX shells.

## Recommended cadence

1. During an edit: run focused selected files, e.g. `npm test -- --file <changed-area test>`;
   use `npm run test:focused` for the workspace/shared-timeline/formatted group.
2. At a milestone: focused suite plus adjacent engine/music-engine files.
3. Before handoff/review: `npm test` once, with a bounded timeout. Record the actual
   exit code and failing test names, not just a timeout.
4. Do not rerun the full suite after every small edit, and do not require backend/model,
   media, or deployment benchmarks for an unrelated frontend change.

## Verification status (Codex independent final verification)

Results from the approved environment, using the maintained runner:

- Normal process-isolated overview/follow: **PASS 9/9, exit 0, 5.527 s**.
- All split journey scenarios: **PASS 17/17, exit 0, 15.213 s** through normal process
  isolation. The scenario comparison against HEAD found exactly the same 17 names after
  the split — none missing or new.
- Complete inventory via `npm test -- --run-timeout=600000`: **PASS 525/525 tests, 0 fail,
  0 skipped, 0 cancelled, exit 0, 90.206 s** across 71 files.
- Independent bounded timeout probe: expected exit **124**, observed exit **124** in
  1.182 s.
- `git diff --check`: PASS.

The earlier estimate of ~517 was low; the actual full count is **525 tests**. A
dedicated current command is:

```powershell
cd apps/web
npm test -- --run-timeout=600000
```

That command is bounded by the wrapper's whole-run timeout and 180 s per-test timeout,
reports the actual `# tests`/`# pass`/`# fail` lines, and exits nonzero on any failure
or timeout.
