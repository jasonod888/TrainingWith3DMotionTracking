import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureJob} from '../src/music/capture-job';

test('capture jobs reject stale results and release handles', () => {
  const job = createCaptureJob();
  const first = job.begin();
  let released = 0;
  job.register({release: () => { released += 1; }});
  const second = job.begin();
  assert.equal(job.isCurrent(first.generation), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(released, 1);
  assert.equal(job.settle(first.generation, 'stale'), null);
  assert.equal(job.settle(second.generation, 'fresh'), 'fresh');
});

test('cancellation aborts once, releases once and is idempotent', () => {
  const job = createCaptureJob();
  const token = job.begin();
  let released = 0;
  job.register({release: () => { released += 1; }});
  assert.equal(job.cancel(), true);
  assert.equal(token.signal.aborted, true);
  assert.equal(released, 1);
  assert.equal(job.cancel(), false);
  assert.equal(released, 1);
});
