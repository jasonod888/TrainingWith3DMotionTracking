import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentFromSpans, buildNotation, estimatedAlignment, tickToEffectiveSeconds,
  type PerformanceNote,
} from '../../../packages/music-notation/index.ts';
import {buildTimelineLayout, fractionalSecondsToTick} from '../src/music/workspace/timeline-layout';

const note = (id: string, onset: number, pitch: number, duration = 0.5): PerformanceNote => ({
  id, onset, pitch, duration, velocity: 0.6, confidence: null, optional: false, string: null, fret: null,
});

const document = buildNotation([
  note('a', 0, 60), note('b', 2.1, 64), note('c', 5, 67), note('d', 8, 72),
], {bpm: 120, duration: 10});
document.measures.forEach((measure, index) => { measure.index = index; });

test('measure boundaries are continuous and invertible', () => {
  const layout = buildTimelineLayout(document);
  for (const measure of layout.measures) {
    assert.equal(layout.tickToX(measure.endTick), measure.x + measure.width);
    const next = layout.measures[measure.index + 1];
    if (next) assert.equal(layout.tickToX(next.startTick), measure.x + measure.width);
  }
  for (const tick of [0, 1, 479, 480, 481, 1919, 1920, 5000, layout.totalTicks]) {
    assert.ok(Math.abs(layout.xToTick(layout.tickToX(tick)) - tick) < 1e-6, `tick ${tick}`);
  }
  assert.equal(layout.tickToX(-100), 0);
  assert.equal(layout.tickToX(layout.totalTicks + 100), layout.contentWidth);
  assert.equal(layout.xToTick(-100), 0);
  assert.equal(layout.xToTick(layout.contentWidth + 100), layout.totalTicks);
});

test('zoom scales the one layout and preserves tick anchors', () => {
  const base = buildTimelineLayout(document);
  const zoomed = buildTimelineLayout(document, 2);
  assert.ok(Math.abs(zoomed.contentWidth - base.contentWidth * 2) < 1);
  const tick = 2400;
  const baseX = base.tickToX(tick);
  const zoomX = zoomed.tickToX(tick);
  assert.ok(Math.abs(zoomX - baseX * 2) < 2);
  assert.ok(Math.abs(zoomed.xToTick(zoomX) - tick) < 1e-6);
});

test('source seconds use the alignment and apply the offset exactly once', () => {
  const alignment = alignmentFromSpans(document, [
    {start: 0, end: 4, kind: 'playing'}, {start: 4, end: 5, kind: 'explanation'},
    {start: 5, end: 10, kind: 'playing'},
  ]);
  const offset = 1.25;
  const layout = buildTimelineLayout(document);
  const seconds = 4.5 + offset;
  const tick = layout.sourceSecondsToTick(seconds, alignment, offset);
  const earlier = layout.sourceSecondsToTick(4.1 + offset, alignment, offset);
  const later = layout.sourceSecondsToTick(4.9 + offset, alignment, offset);
  assert.ok(Math.abs(earlier - later) < 1e-6, 'held time keeps one musical tick');
  const x = layout.sourceSecondsToX(seconds, alignment, offset);
  assert.equal(x, layout.tickToX(tick));
  const back = layout.xToSourceSeconds(x, alignment, offset);
  assert.ok(Math.abs(back - (tickToEffectiveSeconds(alignment, tick, offset))) < 1e-9);
});

test('fractional ticks preserve early/late recorded attacks', () => {
  const alignment = estimatedAlignment(document);
  const layout = buildTimelineLayout(document);
  const early = 1.9;
  const late = 2.1;
  const written = layout.tickToX(1920);
  assert.ok(layout.sourceSecondsToX(early, alignment, 0) < written);
  assert.ok(layout.sourceSecondsToX(late, alignment, 0) > written);
  assert.ok(Number.isFinite(fractionalSecondsToTick(alignment, 2.1)));
});
