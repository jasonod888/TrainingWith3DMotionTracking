import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sliceReference} from '../src/reference-window.ts';

const reference = {
  duration: 3,
  times: [0, 0.1, 0.2, 0.3],
  keypoints: [
    [[0, 0, 0]], [[0.1, 0, 0]], [[0.2, 0, 0]], [[0.3, 0, 0]],
  ] as number[][][],
  visibility: [[0.9], [0.8], [0.7], [0.6]] as number[][],
  landmarkFormat: 'mediapipe-33' as const,
  standingCalibrationAvailable: false,
};

test('a slice keeps times, keypoints and visibility on the same frames', () => {
  const sliced = sliceReference(reference, [1, 3], {duration: 2});
  assert.deepEqual(sliced.times, [0.1, 0.3]);
  assert.deepEqual(sliced.keypoints, [reference.keypoints[1], reference.keypoints[3]]);
  assert.deepEqual(sliced.visibility, [[0.8], [0.6]]);
  assert.equal(sliced.duration, 2);
});

test('a slice preserves the landmark format and standing flag', () => {
  const sliced = sliceReference(reference, [0], {duration: 1});
  assert.equal(sliced.landmarkFormat, 'mediapipe-33');
  assert.equal(sliced.standingCalibrationAvailable, false);
});

test('an offset shifts only the times, never the confidence rows', () => {
  const sliced = sliceReference(reference, [2], {duration: 1, offset: 0.5});
  assert.deepEqual(sliced.times, [-0.3]);
  assert.deepEqual(sliced.visibility, [[0.7]]);
  assert.deepEqual(sliced.keypoints, [reference.keypoints[2]]);
});

test('a reference without visibility keeps a null confidence row', () => {
  const sam = {duration: 1, times: [0, 0.1], keypoints: [[[0, 0, 0]], [[1, 1, 1]]] as number[][][]};
  const sliced = sliceReference(sam, [1], {duration: 1});
  assert.equal(sliced.visibility, null);
  assert.equal(sliced.landmarkFormat, undefined);
  assert.deepEqual(sliced.times, [0.1]);
});
