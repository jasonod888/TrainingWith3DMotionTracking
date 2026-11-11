import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VELOCITY, MASTER_GAIN, intensityPercent, velocityCutoff, velocityDecay,
  velocityGain, velocityPartials, velocityValue,
} from '../src/music/music-velocity.ts';

test('velocity values are clamped, nullable for display, and default safely', () => {
  assert.equal(velocityValue(-1), 0);
  assert.equal(velocityValue(2), 1);
  assert.equal(velocityValue(null), DEFAULT_VELOCITY);
  assert.equal(intensityPercent(null), null);
  assert.equal(intensityPercent(.426), 43);
  assert.equal(intensityPercent(2), 100);
});

test('velocity response is monotonic and preserves soft/loud separation', () => {
  const soft = velocityGain(.15), medium = velocityGain(.5), loud = velocityGain(.95);
  assert.ok(soft < medium && medium < loud);
  assert.ok(loud / soft > 2.5);
  assert.ok(velocityCutoff(.15) < velocityCutoff(.5));
  assert.ok(velocityCutoff(.5) < velocityCutoff(.95));
  assert.ok(velocityDecay(.95) < velocityDecay(.15));
});

test('louder notes add harmonics and the master ceiling stays bounded', () => {
  const soft = velocityPartials(.1), loud = velocityPartials(.95);
  assert.equal(soft.length, 5);
  assert.equal(loud.length, 5);
  assert.ok(loud[2] > soft[2]);
  assert.ok(MASTER_GAIN > 0 && MASTER_GAIN < 1);
});
