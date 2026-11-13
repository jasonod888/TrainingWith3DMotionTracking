import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  activeOccurrenceIds, addAnchor, alignmentFromSpans, alignmentProblem, effectiveSecondsToTick,
  estimatedAlignment, occurrenceIntervals, secondsToTick, tickToEffectiveSeconds, tickToSeconds,
  type Alignment,
} from '../../../packages/music-notation/index.ts';
import {buildNotation, type NotationDocument, type PerformanceNote} from '../../../packages/music-notation/index.ts';

const TICKS_PER_SECOND = 960; // 120 BPM, ppq 480

const note = (id: string, onset: number, pitch: number, duration = 0.4): PerformanceNote => ({
  id, onset, duration, pitch, velocity: 0.5, confidence: null, optional: false, string: null, fret: null,
});

function clip(): NotationDocument {
  return buildNotation([note('a', 0.5, 60), note('b', 5, 64)], {bpm: 120, duration: 10});
}

test('the estimated alignment is linear across the clip', () => {
  const alignment = estimatedAlignment(clip());
  assert.equal(alignment.mode, 'estimated');
  assert.equal(secondsToTick(alignment, 0), 0);
  assert.equal(secondsToTick(alignment, 1), TICKS_PER_SECOND);
  assert.equal(secondsToTick(alignment, 5), 5 * TICKS_PER_SECOND);
  assert.ok(Math.abs(tickToSeconds(alignment, 5 * TICKS_PER_SECOND) - 5) < 1e-6);
  assert.equal(alignmentProblem(alignment, 10), null);
});

test('a playing span maps linearly and an explanation span holds the cursor', () => {
  const document = clip();
  const alignment = alignmentFromSpans(document, [
    {start: 0, end: 4, kind: 'playing'},
    {start: 4, end: 7, kind: 'explanation'},
    {start: 7, end: 10, kind: 'playing'},
  ]);
  assert.equal(alignmentProblem(alignment, 10), null);
  assert.equal(secondsToTick(alignment, 2), 2 * TICKS_PER_SECOND);
  assert.equal(secondsToTick(alignment, 4), 4 * TICKS_PER_SECOND, 'the hold starts where playing stopped');
  assert.equal(secondsToTick(alignment, 5.5), 4 * TICKS_PER_SECOND, 'the cursor waits through the explanation');
  assert.equal(secondsToTick(alignment, 7), 4 * TICKS_PER_SECOND);
  assert.equal(secondsToTick(alignment, 8), 5 * TICKS_PER_SECOND, 'playback resumes from the held tick');
  assert.equal(secondsToTick(alignment, 10), 7 * TICKS_PER_SECOND, 'the explanation is not notated');
});

test('the held tick inverse returns the start of the hold', () => {
  const document = clip();
  const alignment = alignmentFromSpans(document, [
    {start: 0, end: 4, kind: 'playing'},
    {start: 4, end: 7, kind: 'explanation'},
    {start: 7, end: 10, kind: 'playing'},
  ]);
  assert.ok(Math.abs(tickToSeconds(alignment, 4 * TICKS_PER_SECOND) - 4) < 1e-6);
  assert.ok(Math.abs(tickToSeconds(alignment, TICKS_PER_SECOND) - 1) < 1e-6);
  assert.ok(Math.abs(tickToSeconds(alignment, 5 * TICKS_PER_SECOND) - 8) < 1e-6);
});

test('the offset is applied once at the boundary, in both directions', () => {
  const alignment = estimatedAlignment(clip());
  assert.equal(effectiveSecondsToTick(alignment, 2.25, 0.25), secondsToTick(alignment, 2));
  assert.ok(Math.abs(tickToEffectiveSeconds(alignment, 2 * TICKS_PER_SECOND, 0.25) - 2.25) < 1e-9);
  assert.equal(effectiveSecondsToTick(alignment, 1.7, -0.3), secondsToTick(alignment, 2));
});

test('an anchor splits a timed passage without reversing time or score order', () => {
  const document = clip();
  const base = estimatedAlignment(document);
  const result = addAnchor(base, document, 4, 4000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const anchored = result.alignment;
  assert.equal(anchored.mode, 'anchored');
  assert.equal(alignmentProblem(anchored, 10), null);
  assert.equal(secondsToTick(anchored, 4), 4000);
  assert.equal(secondsToTick(anchored, 2), 2000, 'the first stretch now runs at its own slope');
  assert.equal(secondsToTick(anchored, 7), 4000 + Math.round((3 / 6) * (9600 - 4000)));
});

test('anchors that would land on a stretch edge are rejected', () => {
  const document = clip();
  const base = estimatedAlignment(document);
  assert.equal(addAnchor(base, document, 4, 0).ok, false, 'the start tick would not advance');
  assert.equal(addAnchor(base, document, 4, 9600).ok, false, 'the end tick would not advance');
  assert.equal(addAnchor(base, document, -1, 10).ok, false);
  assert.equal(addAnchor(base, document, 10, 5000).ok, false, 'the clip end is not inside a timed stretch');
});

test('an anchor inside a held passage is rejected', () => {
  const document = clip();
  const alignment = alignmentFromSpans(document, [
    {start: 0, end: 4, kind: 'playing'},
    {start: 4, end: 7, kind: 'explanation'},
    {start: 7, end: 10, kind: 'playing'},
  ]);
  assert.equal(addAnchor(alignment, document, 5, 4000).ok, false);
});

test('occurrence intervals stay exact and do not snap to the score grid', () => {
  const document = buildNotation([note('a', 0.5, 60), note('b', 0.512, 64)], {bpm: 120, duration: 10});
  const intervals = occurrenceIntervals(document, 0);
  assert.deepEqual(intervals.map(item => item.start), [0.5, 0.512]);
  assert.deepEqual(activeOccurrenceIds(intervals, 0.505), ['a']);
  assert.deepEqual(activeOccurrenceIds(intervals, 0.512).sort(), ['a', 'b']);
  assert.deepEqual(activeOccurrenceIds(intervals, 0.95), []);
});

test('intervals follow the offset once', () => {
  const document = buildNotation([note('a', 1, 60)], {bpm: 120, duration: 10});
  assert.equal(occurrenceIntervals(document, 0.2)[0].start, 1.2);
  assert.deepEqual(activeOccurrenceIds(occurrenceIntervals(document, 0.2), 1.25), ['a']);
  assert.deepEqual(activeOccurrenceIds(occurrenceIntervals(document, 0.2), 1.05), []);
});

test('spans that leave gaps hold the cursor rather than inventing beats', () => {
  const document = clip();
  const alignment = alignmentFromSpans(document, [
    {start: 0, end: 3, kind: 'playing'},
    {start: 6, end: 10, kind: 'playing'},
  ]);
  assert.equal(alignmentProblem(alignment, 10), null);
  assert.equal(secondsToTick(alignment, 4.5), 3 * TICKS_PER_SECOND, 'the gap holds the cursor');
  assert.equal(secondsToTick(alignment, 6), 3 * TICKS_PER_SECOND, 'the next passage resumes from the held tick');
  assert.equal(secondsToTick(alignment, 7), 4 * TICKS_PER_SECOND);
});

test('a malformed alignment is reported rather than used', () => {
  const broken: Alignment = {
    alignment_version: 1, mode: 'estimated', basis: 'passages',
    passages: [
      {kind: 'timed', source_seconds: [0, 5], ticks: [0, 2400]},
      {kind: 'timed', source_seconds: [4, 10], ticks: [2000, 4800]},
    ],
  };
  assert.ok(alignmentProblem(broken, 10));
});
