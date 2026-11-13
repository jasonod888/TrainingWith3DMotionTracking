/**
 * Phase 2 history benchmark: repeated edit / undo / redo on a real-size score.
 *
 * Read-only. Run from the repository root:
 *   npx --prefix apps/web tsx docs/qualification/piano-workspace-phase-02/scripts/history-benchmark.ts
 *   npx --prefix apps/web tsx docs/qualification/piano-workspace-phase-02/scripts/history-benchmark.ts --input=.local/phase1-audit/draft-document.json
 *
 * Reports serialised document size, retained patch bytes and latency. Byte figures are
 * serialised-size estimates, not measured heap allocations.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildNotation} from '../../../../packages/music-notation/index.ts';
import {
  createWorkspaceState, workspaceReducer,
} from '../../../../apps/web/src/music/workspace/workspace-state.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const input = resolve(argument('input') ?? join(repoRoot, '.local', 'phase1-audit', 'draft-document.json'));
if (!existsSync(input)) {
  console.error(`ERROR: draft document not found: ${input}\nHINT: dump one with docs/qualification/piano-workspace-phase-01/scripts/fetch-draft-json.py, or pass --input=<file>.`);
  process.exit(2);
}

const raw = readFileSync(input);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
const draft = JSON.parse(text.replace(/^\uFEFF/, ''));

const buildStarted = Date.now();
const document = buildNotation(draft.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity, confidence: event.confidence, optional: event.optional,
  string: event.string, fret: event.fret, notation_duration: event.notation_duration ?? null,
})), {duration: draft.duration});
const buildMs = Date.now() - buildStarted;
const documentBytes = JSON.stringify(document).length;

const EDITS = 50;
let state = createWorkspaceState(document);
const targets = document.performance.slice(0, EDITS).map(note => note.id);

const editStarted = Date.now();
for (const id of targets) {
  const current = state.document.performance.find(note => note.id === id)!;
  state = workspaceReducer(state, {
    type: 'command',
    command: {type: 'set-occurrence-pitch', occurrenceId: id, pitch: Math.min(127, current.pitch + 1)},
  });
}
const editMs = Date.now() - editStarted;
const retained = state.historyBytes;

const undoStarted = Date.now();
let undone = 0;
while (state.past.length && undone < EDITS) {
  state = workspaceReducer(state, {type: 'undo'});
  undone += 1;
}
const undoMs = Date.now() - undoStarted;
const afterUndo = {
  steps: undone,
  ms: undoMs,
  msPerStep: +(undoMs / Math.max(1, undone)).toFixed(1),
  backToOrigin: state.document === document,
  dirty: state.dirty,
};

const redoStarted = Date.now();
let redone = 0;
while (state.future.length && redone < EDITS) {
  state = workspaceReducer(state, {type: 'redo'});
  redone += 1;
}
const redoMs = Date.now() - redoStarted;

const result = {
  input,
  events: document.performance.length,
  build_ms: buildMs,
  document_bytes: documentBytes,
  edits: EDITS,
  edit_ms: editMs,
  edit_ms_each: +(editMs / EDITS).toFixed(1),
  retained_patch_bytes: retained,
  retained_bytes_each: +(retained / EDITS).toFixed(0),
  retained_vs_document: +(retained / documentBytes).toFixed(3),
  retained_after_undo_bytes: state.historyBytes,
  undo: {...afterUndo, redo_steps: redone, redo_ms: redoMs, redo_ms_each: +(redoMs / Math.max(1, redone)).toFixed(1)},
  budget_bytes: 4 * 1024 * 1024,
  note: 'Byte figures are UTF-8 patch sizes (serialised-size estimates), not measured heap; they cover undo + redo retention.',
};
console.log(JSON.stringify(result, null, 2));
