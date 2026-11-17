import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VELOCITY, MASTER_GAIN, grandPianoPartials, intensityPercent, pitchVelocityCutoff,
  velocityCutoff, velocityDecay, velocityGain, velocityPartials, velocityValue,
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

test('pitch-aware cutoff keeps high fundamentals audible and opens with velocity', () => {
  const f0 = 440 * 2 ** ((84 - 69) / 12);
  const softTreble = pitchVelocityCutoff(84, .12);
  const loudTreble = pitchVelocityCutoff(84, .9);
  assert.ok(softTreble >= f0, `soft C6 cutoff ${softTreble} must retain ${f0}`);
  assert.ok(loudTreble > softTreble);
  assert.ok(pitchVelocityCutoff(96, .1) >= 440 * 2 ** ((96 - 69) / 12));
  assert.ok(pitchVelocityCutoff(36, .9) >= velocityCutoff(.9));
});

test('grand voice partials are register-aware and stronger when struck harder', () => {
  const bass = grandPianoPartials(36, .2);
  const bassLoud = grandPianoPartials(36, .9);
  const treble = grandPianoPartials(84, .8);
  assert.ok(bass.length >= 8 && bass.length <= 10);
  assert.equal(treble.length, 4);
  assert.equal(treble[0], 1);
  assert.ok(bassLoud[2] > bass[2]);
  assert.ok(bass.length > treble.length, 'bass needs richer overtones than clean treble');
});
