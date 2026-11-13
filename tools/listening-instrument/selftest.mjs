// Regression tests for the instrument protocol, run directly with node:
//   node tools/listening-instrument/selftest.mjs
import assert from 'node:assert/strict';
import {
  INSTRUMENT_VERSION, progressKey, rotationFor, sanitizeRatings, sessionPayload,
  sumCodeUnits, validateProgress,
} from './protocol.js';

const items = [
  { item_id: 'ex01', candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  { item_id: 'ex02', candidates: [{ id: 'd' }, { id: 'e' }, { id: 'f' }] },
];
const study = { rotation_count: 24, items };

// Rotation rule matches the documented sum of UTF-16 code units.
assert.equal(rotationFor({ rotation_count: 24 }, 'L01'), sumCodeUnits('L01') % 24);
assert.equal(sumCodeUnits('AB'), 65 + 66);

// Progress keys separate study builds, versions and listeners.
const base = progressKey('a'.repeat(64), 'L01');
assert.notEqual(base, progressKey('b'.repeat(64), 'L01'));
assert.notEqual(base, progressKey('a'.repeat(64), 'L01', '9.9.9'));
assert.notEqual(base, progressKey('a'.repeat(64), 'L02'));
assert.ok(base.includes(INSTRUMENT_VERSION));

const context = {
  analystSha: 'a'.repeat(64), version: INSTRUMENT_VERSION, rotation: 5,
  listenerId: 'L01', items, itemOrderLength: 2,
};
const saved = {
  instrumentVersion: INSTRUMENT_VERSION, studySha: 'a'.repeat(64), rotation: 5,
  listenerId: 'L01', index: 1,
  ratings: {
    'ex01|0': { item_id: 'ex01', label_index: 0, score: 80 },
    'ex01|1': { item_id: 'ex01', label_index: 1, score: 40 },
  },
  startedAt: '2026-11-12T10:00:00Z', equipment: 'test',
};

const restored = validateProgress(saved, context);
assert.equal(restored.ok, true);
assert.equal(restored.index, 1);
assert.equal(restored.finished, false);
assert.deepEqual(Object.keys(restored.ratings).sort(), ['ex01|0', 'ex01|1']);

// A different study build must not be resumed.
const changed = validateProgress({ ...saved, studySha: 'b'.repeat(64) }, context);
assert.equal(changed.ok, false);
assert.match(changed.reason, /study changed/);

// A changed rotation must not be resumed.
assert.equal(validateProgress({ ...saved, rotation: 6 }, context).ok, false);
// A different instrument version must not be resumed.
assert.equal(validateProgress({ ...saved, instrumentVersion: '0.1.0' }, context).ok, false);
// A different listener must not be resumed.
assert.equal(validateProgress({ ...saved, listenerId: 'L02' }, context).ok, false);
// A position beyond the item list is rejected rather than restored.
assert.equal(validateProgress({ ...saved, index: 9 }, context).ok, false);
assert.equal(validateProgress({ ...saved, index: -1 }, context).ok, false);

// Unknown items, bad label indexes and out-of-range scores are rejected.
assert.equal(validateProgress({ ...saved, ratings: { 'ex09|0': { score: 50 } } }, context).ok,
  false);
assert.equal(validateProgress({ ...saved, ratings: { 'ex01|7': { score: 50 } } }, context).ok,
  false);
assert.equal(validateProgress({ ...saved, ratings: { 'ex01|0': { score: 500 } } }, context).ok,
  false);
assert.equal(sanitizeRatings({ 'ex01|0': { score: Number.NaN } }, items), null);
assert.equal(sanitizeRatings({ 'ex01|0': { item_id: 'ex02', label_index: 1, score: 50 } }, items), null);
assert.equal(sanitizeRatings({ 'ex01|00': { item_id: 'ex01', label_index: 0, score: 50 } }, items), null);

// A finished session is recognised instead of resuming past the end.
const finished = validateProgress({ ...saved, index: 2 }, context);
assert.equal(finished.ok, true);
assert.equal(finished.finished, true);

// The export states the analyst identity and the instrument version.
const payload = sessionPayload({
  listenerId: 'L01', analystSha: 'a'.repeat(64), rotation: 5,
  startedAt: saved.startedAt, finishedAt: '2026-11-12T10:10:00Z', equipment: 'test',
  ratings: saved.ratings,
});
assert.equal(payload.schema, 'piano-listening-ratings-1');
assert.equal(payload.study_sha256, 'a'.repeat(64));
assert.equal(payload.instrument_version, INSTRUMENT_VERSION);
assert.equal(payload.rotation, 5);
assert.equal(payload.ratings.length, 2);

console.log('instrument protocol selftest: ok');
