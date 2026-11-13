/**
 * Shared path and argument helpers for the Phase 1 TypeScript audit scripts.
 *
 * The repository root is resolved explicitly from this file, so the scripts run from
 * their committed location without being moved or having imports repaired. Generated
 * inputs and outputs default to a scratch directory (`.local/phase1-audit`) that is
 * never part of the repository.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const MARKERS = ['packages/music-notation/index.ts', 'apps/api'];

let cachedRoot: string | null = null;

/** Walk up from this file until the repository markers are found. */
export function repoRoot(startFile = fileURLToPath(import.meta.url)): string {
  if (cachedRoot) return cachedRoot;
  let directory = dirname(startFile);
  for (let depth = 0; depth < 8; depth += 1) {
    if (MARKERS.every(marker => existsSync(join(directory, marker)))) {
      cachedRoot = directory;
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not locate the repository root above ${startFile}: expected ${MARKERS.join(', ')}.`);
}

export function scratchDir(): string {
  return join(repoRoot(), '.local', 'phase1-audit');
}

export function fixturePath(): string {
  return join(repoRoot(), 'docs', 'qualification', 'piano-workspace-phase-01', 'fixtures', 'phase1-draft-fixture.json');
}

export type Options = {input: string; out: string; fixture: boolean; help: boolean};

export function parseOptions(argv = process.argv.slice(2)): Options {
  const options: Options = {input: join(scratchDir(), 'draft-document.json'), out: scratchDir(), fixture: false, help: false};
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--fixture') options.fixture = true;
    else if (argument.startsWith('--input=')) options.input = argument.slice('--input='.length);
    else if (argument.startsWith('--out=')) options.out = argument.slice('--out='.length);
    else throw new Error(`Unknown argument: ${argument}\n${USAGE}`);
  }
  if (options.fixture) options.input = fixturePath();
  return options;
}

export const USAGE = [
  'Usage: npx tsx <script> [--fixture] [--input=<draft.json>] [--out=<scratch dir>]',
  '  --fixture   use the tracked synthetic fixture instead of a real draft dump',
  '  --input     path to a draft document JSON (default: <repo>/.local/phase1-audit/draft-document.json)',
  '  --out       scratch directory for generated JSON (default: <repo>/.local/phase1-audit)',
].join('\n');

/** Read a draft document that may be UTF-16 (psql -o) or UTF-8 with a BOM. */
export function readJson<T = any>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Input not found: ${path}\n${USAGE}\nCreate it with scripts/fetch-draft-json.py or run with --fixture.`);
  }
  const raw = readFileSync(path);
  const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
  return JSON.parse(text.replace(/^\uFEFF/, '')) as T;
}
