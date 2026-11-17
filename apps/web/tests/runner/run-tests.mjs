#!/usr/bin/env node
/**
 * Frontend/engine test runner.
 *
 * Usage (from apps/web):
 *   node tests/runner/run-tests.mjs --focused
 *   node tests/runner/run-tests.mjs --full
 *   node tests/runner/run-tests.mjs --file tests/workspace-overview-follow.test.tsx
 *   node tests/runner/run-tests.mjs --full --list
 *
 * It discovers the same inventories as the previous package script, checks that
 * every expected directory/file is present, and passes explicit paths to Node's
 * test runner. Node's runner keeps its normal process isolation, reporting and
 * exit-code behavior; this wrapper only supplies TypeScript compilation, a
 * concurrency cap, per-test/run timeouts and a readable inventory.
 */
import {existsSync, readdirSync, statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {basename, extname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {clearEscalationTimers, terminateTree} from './process-tree.mjs';

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT_ROOT = resolve(APP_ROOT, '..', '..');
const REGISTER = join(APP_ROOT, 'tests', 'runner', 'register.mjs');
const RUNNER_SCRIPT = 'tests/runner/run-tests.mjs';

const HELP = `Frontend test runner (${RUNNER_SCRIPT})

  --full                 engine + music-engine + all web tests (default)
  --focused              workspace UI, shared timeline and formatted-score tests
  --file <path>          run a specific test file (repeatable); path is relative to apps/web
  --pattern <text>       forward to --test-name-pattern
  --concurrency <n>      Node test-file concurrency (default: 1)
  --test-timeout <ms>    per-test timeout (default: 180000; 0 disables)
  --run-timeout <ms>     whole-run timeout (default: 1800000; 0 disables)
  --source-maps          enable inline TS source maps (slower; for debugging)
  --no-semi-space        do not pass --max-semi-space-size=8
  --list                 print the selected file inventory and exit
  --reporter <name>      Node test reporter (default: Node's default)
  -h, --help             this help
  --                     remaining arguments are passed to node --test

Exit codes: Node test runner's code, 2 for usage errors, 124 when the run timeout
kills the process tree. Value options accept both "--name value" and "--name=value".
No test is skipped or force-exited to obtain success.
`;

function fail(message, code = 2) {
  console.error(`run-tests: ${message}`);
  process.exit(code);
}

function filesIn(directory, predicate) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .filter(predicate)
    .map(name => join(directory, name))
    .filter(path => statSync(path).isFile())
    .sort();
}

function fullInventory() {
  const engine = filesIn(join(PROJECT_ROOT, 'tests', 'engine'), name => name.endsWith('.test.ts'));
  const musicEngine = filesIn(join(PROJECT_ROOT, 'tests', 'music-engine'), name => name.endsWith('.test.ts'));
  const webMjs = filesIn(join(APP_ROOT, 'tests'), name => name.endsWith('.test.mjs'));
  const webTs = filesIn(join(APP_ROOT, 'tests'), name => name.endsWith('.test.ts'));
  const webTsx = filesIn(join(APP_ROOT, 'tests'), name => name.endsWith('.test.tsx'));
  return {engine, musicEngine, webMjs, webTs, webTsx};
}

function focusedInventory() {
  const tests = join(APP_ROOT, 'tests');
  return filesIn(tests, name => name.endsWith('.test.tsx') || name.endsWith('.test.ts'))
    .filter(path => {
      const name = basename(path);
      return name.startsWith('workspace-') || name === 'shared-timeline.test.ts'
        || name === 'formatted-score.test.tsx';
    });
}

function inventorySummary(files) {
  const engine = files.filter(path => path.startsWith(join(PROJECT_ROOT, 'tests', 'engine'))).length;
  const musicEngine = files.filter(path => path.startsWith(join(PROJECT_ROOT, 'tests', 'music-engine'))).length;
  const webMjs = files.filter(path => path.endsWith('.test.mjs')).length;
  const webTsx = files.filter(path => path.endsWith('.test.tsx')).length;
  const webTs = files.filter(path => path.endsWith('.test.ts')
    && !path.startsWith(join(PROJECT_ROOT, 'tests', 'engine'))
    && !path.startsWith(join(PROJECT_ROOT, 'tests', 'music-engine'))).length;
  return {engine, musicEngine, webMjs, webTsx, webTs, total: files.length};
}

function parseInteger(value, label, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    fail(`${label} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    mode: 'full', files: [], pattern: '', concurrency: 1, testTimeout: 180000,
    runTimeout: 1800000, sourceMaps: false, semiSpace: true, list: false,
    reporter: '', passthrough: [],
  };
  let endOfOptions = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (endOfOptions) { options.passthrough.push(argument); continue; }
    if (argument === '--') { endOfOptions = true; continue; }

    const separator = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const inline = separator === -1 ? undefined : argument.slice(separator + 1);
    const valueFor = label => {
      if (inline !== undefined) {
        if (!inline) fail(`${label} requires a non-empty value`);
        return inline;
      }
      if (index + 1 >= argv.length) fail(`${label} requires a value`);
      return argv[++index];
    };
    const flagOnly = label => {
      if (inline !== undefined) fail(`${label} does not take a value`);
    };

    if (name === '--full') { flagOnly(name); options.mode = 'full'; continue; }
    if (name === '--focused') { flagOnly(name); options.mode = 'focused'; continue; }
    if (name === '--file' || name === '-f') {
      options.files.push(valueFor(name));
      options.mode = 'selected';
      continue;
    }
    if (name === '--pattern' || name === '-p') { options.pattern = valueFor(name); continue; }
    if (name === '--concurrency') {
      options.concurrency = parseInteger(valueFor(name), name, 1);
      continue;
    }
    if (name === '--test-timeout') { options.testTimeout = parseInteger(valueFor(name), name); continue; }
    if (name === '--run-timeout') { options.runTimeout = parseInteger(valueFor(name), name); continue; }
    if (name === '--reporter') { options.reporter = valueFor(name); continue; }
    if (name === '--source-maps') { flagOnly(name); options.sourceMaps = true; continue; }
    if (name === '--no-semi-space') { flagOnly(name); options.semiSpace = false; continue; }
    if (name === '--list') { flagOnly(name); options.list = true; continue; }
    if (name === '--help' || name === '-h') { flagOnly(name); console.log(HELP); process.exit(0); }
    fail(`unknown option ${argument}\n\n${HELP}`);
  }
  if (options.files.length && options.mode !== 'selected') fail('--file cannot be combined with --full/--focused');
  return options;
}

function selectedFiles(options) {
  if (options.mode === 'selected') {
    return options.files.map(value => {
      const absolute = isAbsolute(value) ? value : resolve(APP_ROOT, value);
      if (!existsSync(absolute)) fail(`test file does not exist: ${relative(APP_ROOT, absolute) || absolute}`);
      if (!statSync(absolute).isFile()) fail(`not a file: ${relative(APP_ROOT, absolute)}`);
      return absolute;
    });
  }
  if (options.mode === 'focused') {
    const focused = focusedInventory();
    if (!focused.length) fail('focused inventory is empty; check apps/web/tests');
    return focused;
  }
  const inventory = fullInventory();
  const files = [...inventory.engine, ...inventory.musicEngine, ...inventory.webMjs,
    ...inventory.webTs, ...inventory.webTsx];
  for (const [label, list] of Object.entries(inventory)) {
    if (!list.length) fail(`expected ${label} tests but found none`);
  }
  return files;
}

function nodeArguments(options, files) {
  const args = [];
  if (options.semiSpace) args.push('--max-semi-space-size=8');
  if (options.sourceMaps) args.push('--enable-source-maps');
  args.push('--import', pathToFileURL(REGISTER).href);
  args.push('--test', `--test-concurrency=${options.concurrency}`);
  if (options.testTimeout > 0) args.push(`--test-timeout=${options.testTimeout}`);
  if (options.pattern) args.push(`--test-name-pattern=${options.pattern}`);
  if (options.reporter) args.push(`--test-reporter=${options.reporter}`);
  args.push(...options.passthrough);
  args.push(...files);
  return args;
}

const options = parseArgs(process.argv.slice(2));
const files = selectedFiles(options);
const summary = inventorySummary(files);
const report = `engine=${summary.engine} music-engine=${summary.musicEngine} web-mjs=${summary.webMjs} ` +
  `web-tsx=${summary.webTsx} web-ts=${summary.webTs} total=${summary.total}`;

if (options.list) {
  console.log(`Inventory (${report})`);
  for (const file of files) console.log(`  ${relative(APP_ROOT, file)}`);
  process.exit(0);
}

console.log(`Test inventory: ${report}`);
console.log(`Mode: ${options.mode} · concurrency: ${options.concurrency} · ` +
  `test timeout: ${options.testTimeout || 'none'} ms · run timeout: ${options.runTimeout || 'none'} ms`);
console.log(`Node: ${process.version} · source maps: ${options.sourceMaps ? 'on' : 'off'}`);
const args = nodeArguments(options, files);
console.log(`\n> ${process.execPath} ${args.map(value => /\s/.test(value) ? JSON.stringify(value) : value).join(' ')}\n`);

const child = spawn(process.execPath, args, {
  cwd: APP_ROOT,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
  env: {...process.env, ...(options.sourceMaps ? {TS_TEST_SOURCE_MAPS: '1'} : {})},
});

let timedOut = false;
let cancelledCode = 0;
let runTimer = null;
let cleanupTermination = null;

const terminate = () => {
  cleanupTermination ??= terminateTree(child, {
    graceMs: 5000,
    onEscalation: () => console.error('\nrun-tests: test process tree did not exit in time; forcing termination.'),
  });
};

if (options.runTimeout > 0) {
  runTimer = setTimeout(() => {
    if (timedOut || cancelledCode) return;
    timedOut = true;
    console.error(`\nrun-tests: whole-run timeout (${options.runTimeout} ms) reached; terminating the test process tree.`);
    terminate();
  }, options.runTimeout);
  runTimer.unref?.();
}

const requestCancel = (signal, code) => {
  if (timedOut || cancelledCode) return;
  cancelledCode = code;
  console.error(`\nrun-tests: ${signal} received; terminating the test process tree.`);
  terminate();
};
process.on('SIGINT', () => requestCancel('SIGINT', 130));
process.on('SIGTERM', () => requestCancel('SIGTERM', 143));
process.on('exit', clearEscalationTimers);

child.on('error', cause => {
  if (runTimer) clearTimeout(runTimer);
  clearEscalationTimers();
  console.error(`run-tests: could not start Node test runner: ${cause.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (runTimer) clearTimeout(runTimer);
  cleanupTermination?.();
  clearEscalationTimers();
  if (timedOut) process.exit(124);
  if (cancelledCode) process.exit(cancelledCode);
  if (code !== null) process.exit(code);
  console.error(`run-tests: test runner exited with signal ${signal ?? 'unknown'}`);
  process.exit(1);
});
