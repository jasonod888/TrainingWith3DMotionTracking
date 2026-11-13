/**
 * Emit the notation document built from a draft dump, for the Python server-side
 * validator. Read-only.
 *
 * Usage (from the repository root):
 *   npx tsx docs/qualification/piano-workspace-phase-01/scripts/emit-notation.ts --fixture
 *   npx tsx docs/qualification/piano-workspace-phase-01/scripts/emit-notation.ts --input=.local/phase1-audit/draft-document.json
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadNotation} from './lib/notation.ts';
import {parseOptions, readJson, USAGE} from './lib/paths.ts';

const options = parseOptions();
if (options.help) { console.log(USAGE); process.exit(0); }

const draft = readJson(options.input);
const {buildNotation} = loadNotation();
const score = buildNotation(draft.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity, confidence: event.confidence, optional: event.optional,
  string: event.string, fret: event.fret,
})), {duration: draft.duration});

mkdirSync(options.out, {recursive: true});
const target = join(options.out, options.fixture ? 'notation-fixture.json' : 'notation-real.json');
const json = JSON.stringify(score);
writeFileSync(target, json, 'utf-8');
console.log(JSON.stringify({
  written: target,
  bytes: json.length,
  events: score.events.length,
  segments: score.segments.length,
  measures: score.measures.length,
  tempo: score.tempo.bpm,
}, null, 2));
