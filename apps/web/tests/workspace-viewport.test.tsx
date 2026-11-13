import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNotation, type PerformanceNote} from '../../../packages/music-notation/index.ts';
import {
  DEFAULT_SPAN_SECONDS, MAX_SPAN_SECONDS, MIN_SPAN_SECONDS, clampTimeWindow, layoutMeasures,
  measureAtTick, pixelsPerSecond, revealWindow, rulerStep, rulerTicks, scrollForMeasure, secondsToTick,
  secondsToX, tickToSeconds, visibleMeasureIndexes, visibleTimeRange, xToSeconds, zoomAround,
} from '../src/music/workspace/viewport';

const note = (id: string, onset: number, pitch: number, duration = 0.4): PerformanceNote => ({
  id, onset, duration, pitch, velocity: 0.5, confidence: null, optional: false, string: null, fret: null,
});

/** A long recording shaped like the real example: 209.6 s, 1338 notes, 145 BPM. */
function longDocument() {
  const performance: PerformanceNote[] = [];
  for (let index = 0; index < 1338; index += 1) {
    const onset = 0.9 + (index / 1338) * 206;
    performance.push(note(`n-${index}`, Number(onset.toFixed(3)), 48 + (index * 7) % 36));
  }
  return buildNotation(performance, {bpm: 145, duration: 209.594});
}

test('the default window is ten seconds and never exceeds the clip', () => {
  assert.equal(DEFAULT_SPAN_SECONDS, 10);
  const window = clampTimeWindow({start: 0, span: DEFAULT_SPAN_SECONDS}, 209.594);
  assert.deepEqual(window, {start: 0, span: 10});
  const late = clampTimeWindow({start: 500, span: 10}, 209.594);
  assert.equal(late.start, 209.594 - 10);
});

test('zoom stays within the permitted span and keeps the anchor in place', () => {
  const start = {start: 40, span: 10};
  const anchor = 45;
  const zoomedIn = zoomAround(start, 209.594, 0.5, anchor);
  assert.equal(zoomedIn.span, 5);
  assert.ok(Math.abs((anchor - zoomedIn.start) / zoomedIn.span - 0.5) < 1e-9);
  const zoomedOut = zoomAround(start, 209.594, 2, anchor);
  assert.equal(zoomedOut.span, 20);
  assert.ok(Math.abs((anchor - zoomedOut.start) / zoomedOut.span - 0.5) < 1e-9);
  assert.equal(zoomAround(start, 209.594, 0.001, anchor).span, MIN_SPAN_SECONDS);
  assert.equal(zoomAround(start, 209.594, 1000, anchor).span, MAX_SPAN_SECONDS);
});

test('zoom with the playhead offscreen anchors at the viewport centre', () => {
  const window = {start: 40, span: 10};
  const centre = 45;
  const zoomed = zoomAround(window, 209.594, 0.5, null);
  assert.ok(Math.abs(zoomed.start + zoomed.span / 2 - centre) < 1e-9);
});

test('reveal only moves the window when the target is outside the margin', () => {
  const window = {start: 40, span: 10};
  assert.equal(revealWindow(window, 209.594, 45), window, 'a visible target must not move the window');
  const moved = revealWindow(window, 209.594, 80);
  assert.ok(moved.start <= 80 && moved.start + moved.span >= 80);
});

test('a clip shorter than the minimum span is shown at its own length', () => {
  const short = clampTimeWindow({start: 0, span: 10}, 1.2);
  assert.deepEqual(short, {start: 0, span: 1.2});
  const zoomed = zoomAround({start: 0, span: 1.2}, 1.2, 0.5, 0.6);
  assert.equal(zoomed.span, 1.2, 'a short clip cannot zoom out beyond its own length');
  const tiny = clampTimeWindow({start: 5, span: 10}, 0.4);
  assert.equal(tiny.start, 0);
  assert.equal(tiny.span, 0.4);
});

test('the visible range includes a buffer on both sides', () => {
  const range = visibleTimeRange({start: 100, span: 10});
  assert.equal(range.from, 97);
  assert.equal(range.to, 113);
});

test('seconds and pixels round-trip through the window', () => {
  const window = {start: 12, span: 10};
  const width = 800;
  assert.equal(pixelsPerSecond(width, window), 80);
  assert.equal(secondsToX(12, window, width), 0);
  assert.equal(secondsToX(17, window, width), 400);
  assert.ok(Math.abs(xToSeconds(400, window, width) - 17) < 1e-9);
});

test('ruler spacing adapts to the zoom level', () => {
  assert.equal(rulerStep(10), 2);
  assert.equal(rulerStep(2), 0.25);
  assert.equal(rulerStep(60), 10);
  const ticks = rulerTicks({start: 10, span: 10}, 209.594);
  assert.deepEqual(ticks, [10, 12, 14, 16, 18, 20]);
  assert.ok(ticks.every(tick => tick <= 209.594));
});

test('measure layout is monotonic and bounded', () => {
  const document = longDocument();
  const {boxes, totalWidth} = layoutMeasures(document);
  assert.ok(boxes.length > 100, `expected a long score, got ${boxes.length} measures`);
  assert.equal(boxes[0].x, 0);
  for (let index = 1; index < boxes.length; index += 1) {
    assert.ok(boxes[index].x > boxes[index - 1].x);
    assert.ok(boxes[index].width >= 140 && boxes[index].width <= 320);
  }
  assert.ok(totalWidth > boxes.length * 140);
});

test('only the visible measures are selected for rendering', () => {
  const document = longDocument();
  const {boxes} = layoutMeasures(document);
  const [first, last] = visibleMeasureIndexes(boxes, 0, 1000);
  assert.ok(first >= 0 && last >= first);
  assert.ok(last - first + 1 <= 15, `rendered ${last - first + 1} measures for a 1000 px viewport`);
  const [farFirst, farLast] = visibleMeasureIndexes(boxes, 20000, 1000);
  assert.ok(farFirst > first, 'scrolling moves the rendered range');
  assert.ok(farLast - farFirst + 1 <= 15);
});

test('revealing a measure does not scroll when it is already visible', () => {
  const document = longDocument();
  const {boxes} = layoutMeasures(document);
  const visible = scrollForMeasure(boxes, 2, 1000, 0);
  assert.equal(visible, 0, 'measure 3 is already inside the viewport');
  const moved = scrollForMeasure(boxes, 40, 1000, 0);
  assert.ok(moved > 0);
});

test('tick helpers agree with the estimated tempo and the measure at that tick', () => {
  const document = longDocument();
  const {boxes} = layoutMeasures(document);
  const tick = secondsToTick(document, 30);
  assert.ok(Math.abs(tickToSeconds(document, tick) - 30) < 1e-6);
  const index = measureAtTick(boxes, document, tick);
  assert.equal(boxes[index].index, index);
  assert.ok(document.measures[index].start <= tick);
});
