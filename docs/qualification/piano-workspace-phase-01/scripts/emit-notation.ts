/**
 * Phase 1 check: can the current builder's output be persisted at all?
 *
 * Writes the notation built from the REAL draft to .local/phase1-audit/notation-real.json
 * so the server validator can be run against it in Python. Read-only.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {buildNotation, type PerformanceNote} from '../../packages/music-notation/index.ts';

const raw = readFileSync(new URL('./draft-document.json', import.meta.url));
const text = (raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8'))
  .replace(/^\uFEFF/, '');
const draft = JSON.parse(text);

const performance: PerformanceNote[] = draft.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity, confidence: event.confidence, optional: event.optional,
  string: event.string, fret: event.fret,
}));

const score = buildNotation(performance, {duration: draft.duration});
const out = new URL('./notation-real.json', import.meta.url);
writeFileSync(out, JSON.stringify(score));
console.log(JSON.stringify({written: out.pathname, bytes: JSON.stringify(score).length,
  events: score.events.length, segments: score.segments.length, measures: score.measures.length}));
