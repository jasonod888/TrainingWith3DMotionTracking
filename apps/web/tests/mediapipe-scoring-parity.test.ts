import {test} from 'node:test';
import assert from 'node:assert/strict';

const {comparePoses, STANDING_VISIBILITY} = await import('../../../web/dist/pose.js');

const ANGLES = [['ls', 'le', 'lw'], ['rs', 're', 'rw'], ['le', 'ls', 'lh'],
  ['re', 'rs', 'rh'], ['ls', 'lh', 'lk'], ['rs', 'rh', 'rk'],
  ['lh', 'lk', 'la'], ['rh', 'rk', 'ra']];
const JOINTS = [...new Set(ANGLES.flat())];

function pose(confidence: number, angleCount = ANGLES.length) {
  const values: Record<string, {p: number[]; confidence: number}> = {};
  const visible = new Set(ANGLES.slice(0, angleCount).flat());
  for (const joint of JOINTS) {
    values[joint] = {p: [joint.charCodeAt(0), joint.charCodeAt(1), 0],
      confidence: visible.has(joint) ? confidence : 0};
  }
  return values;
}

test('browser scoring uses 0.60 exactly like the worker', () => {
  assert.equal(STANDING_VISIBILITY, .65);
  assert.equal(comparePoses(pose(.55), pose(.55)), null);
  assert.equal(comparePoses(pose(.59), pose(.59)), null);
  assert.ok(comparePoses(pose(.60), pose(.60)));
  // Five confident angles is inadequate coverage.
  assert.equal(comparePoses(pose(.60, 5), pose(.60, 5)), null);
  assert.ok(comparePoses(pose(.60, 6), pose(.60, 6)));
  assert.equal(comparePoses(null, pose(.60)), null);
});
