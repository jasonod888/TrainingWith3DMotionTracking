import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_PREPARATION_PATHS, MISSING_AUDIO_MESSAGE, PREPARATION_UNAVAILABLE_MESSAGE, usablePaths,
} from '../src/music-preparation-policy.ts';

test('MP4 AVC/AAC is preferred when both encoders exist', () => {
  const paths = usablePaths({avc: true, aac: true, vp8: true, opus: true});
  assert.deepEqual(paths.map(path => path.id), ['mp4-aac', 'webm-opus']);
  assert.equal(paths[0].mime, 'video/mp4');
});

test('WebM VP8/Opus is used when only that combination exists', () => {
  const paths = usablePaths({avc: false, aac: false, vp8: true, opus: true});
  assert.deepEqual(paths.map(path => path.id), ['webm-opus']);
  assert.equal(paths[0].mime, 'video/webm');
});

test('a path needs both an audio and a video encoder', () => {
  assert.deepEqual(usablePaths({avc: true, aac: false, vp8: false, opus: true}), []);
  assert.deepEqual(usablePaths({avc: false, aac: true, vp8: true, opus: false}), []);
});

test('no usable path is reported as unavailable with a recovery message', () => {
  assert.deepEqual(usablePaths({avc: false, aac: false, vp8: false, opus: false}), []);
  assert.match(PREPARATION_UNAVAILABLE_MESSAGE, /Export/);
  assert.match(MISSING_AUDIO_MESSAGE, /audio track/);
});

test('the candidate list stays limited to the two qualified containers', () => {
  assert.deepEqual(AUDIO_PREPARATION_PATHS.map(path => path.format), ['mp4', 'webm']);
});
