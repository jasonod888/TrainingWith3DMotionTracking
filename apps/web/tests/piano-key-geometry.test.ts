import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPianoGeometry, clampStandardPianoWindow, isBlackPitch, isWhitePitch,
  panStandardPianoRange, resolveKeyboardRange, semitonesForWidth, shiftPianoRange,
  STANDARD_PIANO_FIRST, STANDARD_PIANO_LAST, STANDARD_PIANO_RANGE,
} from '../src/music/notation/piano-key-geometry.ts';

test('width selects a practical visible range instead of a full microscopic keyboard', () => {
  assert.equal(semitonesForWidth(480), 24);
  assert.equal(semitonesForWidth(640), 36);
  assert.equal(semitonesForWidth(1040), 60);
});

test('range is centered on lesson pitches, octave-aligned and clamped', () => {
  const range = resolveKeyboardRange([48, 60, 72], 640);
  assert.equal(range.semitones, 36);
  assert.equal(range.firstPitch % 12, 0);
  assert.ok(range.firstPitch <= 48 && range.firstPitch + range.semitones >= 72);
  assert.deepEqual(shiftPianoRange({firstPitch: 0, semitones: 36}, -1), {firstPitch: 0, semitones: 36});
  const high = shiftPianoRange({firstPitch: 127 - 24, semitones: 24}, 2);
  assert.equal(high.firstPitch, 127 - 24);
  assert.deepEqual(resolveKeyboardRange([], 480), {firstPitch: 48, semitones: 24});
});

test('white and black lanes share one exact non-overlapping geometry', () => {
  const range = {firstPitch: 60, semitones: 24};
  const geometry = buildPianoGeometry(range, 480);
  assert.equal(geometry.whites.length, 15);
  assert.equal(geometry.blacks.length, 10);
  assert.ok(geometry.whiteWidth > 0 && geometry.blackWidth > 0);
  for (let index = 1; index < geometry.whites.length; index += 1) {
    const previous = geometry.whites[index - 1];
    const current = geometry.whites[index];
    assert.ok(current.x > previous.x, 'white keys advance left to right');
    assert.ok(current.x - (previous.x + previous.width) >= 0, 'white lanes do not overlap');
    assert.ok(current.pitch > previous.pitch, 'white pitches stay sorted');
  }
  for (const black of geometry.blacks) {
    const left = [...geometry.whites].reverse().find(white => white.center < black.center);
    const right = geometry.whites.find(white => white.center > black.center);
    assert.ok(left && right, `black ${black.pitch} has neighbouring white lanes`);
    assert.ok(black.center > left.center && black.center < right.center,
      `black ${black.pitch} sits between whites`);
    assert.ok(isBlackPitch(black.pitch) && !isWhitePitch(black.pitch));
  }
  const all = [...geometry.whites, ...geometry.blacks];
  assert.equal(new Set(all.map(key => key.pitch)).size, all.length, 'one lane per pitch');
  for (const key of all) {
    assert.ok(key.x >= geometry.padding - 0.001);
    assert.ok(key.x + key.width <= geometry.width - geometry.padding + 0.001);
  }
});

test('geometry boundaries remain usable at the top of the MIDI range', () => {
  const range = resolveKeyboardRange([127], 480);
  const geometry = buildPianoGeometry(range, 480);
  assert.ok(range.firstPitch + range.semitones <= 127);
  assert.ok(geometry.whites.length > 0);
  assert.ok(geometry.whites.every(key => key.pitch >= range.firstPitch));
  assert.ok(geometry.blacks.every(key => key.pitch <= 127));
});

test('standard piano is exactly A0–C8 with 88 keys, 52 white and 36 black', () => {
  const geometry = buildPianoGeometry(STANDARD_PIANO_RANGE, 1200);
  assert.equal(geometry.whites.length, 52);
  assert.equal(geometry.blacks.length, 36);
  assert.equal(geometry.whites.length + geometry.blacks.length, 88);
  const pitches = [...geometry.whites, ...geometry.blacks].map(key => key.pitch).sort((a, b) => a - b);
  assert.deepEqual(pitches, Array.from({length: 88}, (_, index) => STANDARD_PIANO_FIRST + index));
  assert.equal(pitches[0], 21);
  assert.equal(pitches[1], 22);
  assert.equal(pitches[2], 23);
  assert.equal(pitches[3], 24);
  assert.equal(pitches[87], STANDARD_PIANO_LAST);
  assert.equal(pitches[87], 108);
  assert.ok(pitches.every(pitch => pitch >= 21 && pitch <= 108));
});

test('narrow panning is bounded, non-C-aligned at A0, and reaches both endpoints', () => {
  let range = clampStandardPianoWindow(60, 24);
  for (let step = 0; step < 10 && range.firstPitch > STANDARD_PIANO_FIRST; step += 1) {
    range = panStandardPianoRange(range, -12);
  }
  assert.equal(range.firstPitch, STANDARD_PIANO_FIRST);
  assert.ok(range.firstPitch + range.semitones < STANDARD_PIANO_LAST,
    'A0 endpoint is reachable without C-alignment');
  const left = buildPianoGeometry(range, 480);
  assert.ok([...left.whites, ...left.blacks].some(key => key.pitch === 21));
  for (let step = 0; step < 10 && range.firstPitch + range.semitones < STANDARD_PIANO_LAST; step += 1) {
    range = panStandardPianoRange(range, 12);
  }
  assert.equal(range.firstPitch + range.semitones, STANDARD_PIANO_LAST);
  const right = buildPianoGeometry(range, 480);
  assert.ok([...right.whites, ...right.blacks].some(key => key.pitch === 108));
  assert.ok([...right.whites, ...right.blacks].every(key => key.pitch <= 108));
});
