#!/usr/bin/env node
/**
 * Compare the canonical TS musical baseline with the pinned midi2hands adapter output.
 * Agreement is a diagnostic, not accuracy: no human ground-truth labels are used.
 *
 * Run with the maintained TS loader:
 *   node --import ./apps/web/tests/runner/register.mjs tools/midi2hands/compare.mjs \
 *     --performance <draft.json> --model <adapter-report.json|-> [--summary]
 */
import {readFileSync} from 'node:fs';
import {baselineHandEstimates, handPerformanceFingerprint}
  from '../../packages/music-notation/hands.ts';

function args() {
  const values = {performance: '', model: '', summary: false};
  const list = process.argv.slice(2);
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (item === '--summary') values.summary = true;
    else if (item === '--performance') values.performance = list[++index] ?? '';
    else if (item === '--model') values.model = list[++index] ?? '';
  }
  if (!values.performance || !values.model) {
    throw new Error('Usage: compare.mjs --performance <draft.json> --model <report.json|-> [--summary]');
  }
  return values;
}

function eventsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') throw new Error('Performance input is not an object.');
  for (const key of ['events', 'performance', 'notes']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  throw new Error('Performance input has no events/performance/notes array.');
}

const options = args();
const performance = eventsOf(JSON.parse(readFileSync(options.performance, 'utf8')));
const performanceFingerprint = handPerformanceFingerprint(performance);
const model = JSON.parse(options.model === '-' ? readFileSync(0, 'utf8') : readFileSync(options.model, 'utf8'));
if (!model || model.ok !== true || !Array.isArray(model.notes)) {
  throw new Error(`Model report is unavailable: ${model?.error?.message ?? 'no notes'}`);
}
if (model.performance_fingerprint !== performanceFingerprint) {
  throw new Error(`Performance fingerprint mismatch: adapter=${model.performance_fingerprint} `
    + `canonical=${performanceFingerprint}`);
}
const baseline = baselineHandEstimates(performance);
const modelById = new Map();
for (const note of model.notes) {
  if (typeof note.id !== 'string') throw new Error('Model report contains a note without an ID.');
  if (modelById.has(note.id)) throw new Error(`Model report repeats occurrence ${note.id}.`);
  modelById.set(note.id, note);
}

let agreement = 0;
let disagreement = 0;
let baselineUnassigned = 0;
let modelUnassigned = 0;
let modelMissing = 0;
let bothUnassigned = 0;
const rows = [];
for (const event of performance) {
  if (!event || typeof event.id !== 'string') throw new Error('Performance contains an occurrence without an ID.');
  const base = baseline[event.id] ?? {hand: 'unassigned', confidence: 'ambiguous', reason: 'no-estimate'};
  const predicted = modelById.get(event.id);
  const modelHand = predicted?.status === 'predicted' ? predicted.hand : null;
  const modelStatus = predicted?.status ?? 'missing';
  const bothAssigned = base.hand !== 'unassigned' && (modelHand === 'left' || modelHand === 'right');
  const agrees = bothAssigned ? base.hand === modelHand : null;
  if (bothAssigned && agrees) agreement += 1;
  if (bothAssigned && !agrees) disagreement += 1;
  if (base.hand === 'unassigned') baselineUnassigned += 1;
  if (modelHand === null) modelUnassigned += 1;
  if (modelStatus === 'missing') modelMissing += 1;
  if (base.hand === 'unassigned' && modelHand === null) bothUnassigned += 1;
  rows.push({
    id: event.id,
    baseline: {hand: base.hand, confidence: base.confidence, reason: base.reason},
    model: {hand: modelHand, status: modelStatus, raw_score: predicted?.raw_score ?? null},
    agree: agrees,
  });
}

const report = {
  schema_version: 1,
  ok: true,
  comparison: 'canonical-baseline-vs-midi2hands',
  performance_fingerprint: performanceFingerprint,
  model: {adapter: model.adapter, upstream: model.upstream, artifact: model.artifact,
    runtime: model.runtime, score_kind: model.score_kind, label_mapping: model.label_mapping},
  counts: {
    events: performance.length, agreement, disagreement,
    comparable: agreement + disagreement,
    agreement_rate: agreement + disagreement > 0 ? agreement / (agreement + disagreement) : null,
    baseline_unassigned: baselineUnassigned,
    model_unassigned: modelUnassigned,
    both_unassigned: bothUnassigned,
    model_missing: modelMissing,
  },
  note: 'Agreement and raw scores are diagnostics, not accuracy or calibrated confidence.',
  ...(options.summary ? {} : {notes: rows}),
};
process.stdout.write(`${JSON.stringify(report, null, options.summary ? 0 : 2)}\n`);
