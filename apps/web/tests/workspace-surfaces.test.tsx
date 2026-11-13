import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React, {useState} from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
const {window} = dom;
globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.SVGElement = window.SVGElement;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

const {render, cleanup} = await import('@testing-library/react');
const {buildNotation, applyCommand, refreshNotation} = await import('../../../packages/music-notation/index.ts');
import type {NotationDocument} from '../../../packages/music-notation/index.ts';
const {TimeRoll} = await import('../src/music/workspace/TimeRoll.tsx');
const {ContinuousScore} = await import('../src/music/workspace/ContinuousScore.tsx');
const {useElementWidth} = await import('../src/music/workspace/useElementWidth.ts');
const {layoutMeasures, pitchScrollTop} = await import('../src/music/workspace/viewport.ts');

afterEach(() => cleanup());

const note = (id: string, onset: number, pitch: number) => ({
  id, onset, pitch, duration: 0.4, velocity: 0.5, confidence: null, optional: false, string: null, fret: null,
});

function rollProps(score: NotationDocument, overrides: Record<string, unknown> = {}) {
  return {
    document: score, window: {start: 0, span: 10}, onWindowChange: () => {},
    selectedOccurrenceId: 'selected', reveal: {occurrenceId: 'selected', token: 1}, playhead: 0,
    onSelect: () => {}, onSeek: () => {}, ...overrides,
  };
}

/* ------------------------------------------------------------------ R1 */

test('R1: panning after a selection does not request the window back', () => {
  const score = buildNotation([note('selected', 5, 60), note('late', 60, 64)], {duration: 100, bpm: 120});
  const requests: {start: number; span: number}[] = [];
  const onWindowChange = (next: {start: number; span: number}) => requests.push(next);
  const view = render(<TimeRoll {...rollProps(score, {window: {start: 40, span: 10}, reveal: null})} onWindowChange={onWindowChange}/>);
  assert.equal(requests.length, 0, 'mounting must not move the window');

  // The old selection is still selected while the user pans elsewhere.
  view.rerender(<TimeRoll {...rollProps(score, {window: {start: 40, span: 10}, reveal: null})} onWindowChange={onWindowChange}/>);
  view.rerender(<TimeRoll {...rollProps(score, {window: {start: 60, span: 10}, reveal: null})} onWindowChange={onWindowChange}/>);
  assert.equal(requests.length, 0, `manual pan was reversed with ${JSON.stringify(requests)}`);
});

test('R1: a new reveal request brings a distant note into view', () => {
  const score = buildNotation([note('selected', 5, 60), note('late', 60, 64)], {duration: 100, bpm: 120});
  const requests: {start: number; span: number}[] = [];
  const onWindowChange = (next: {start: number; span: number}) => requests.push(next);
  const view = render(<TimeRoll {...rollProps(score, {window: {start: 40, span: 10}, reveal: null})} onWindowChange={onWindowChange}/>);
  assert.equal(requests.length, 0);

  view.rerender(<TimeRoll {...rollProps(score, {
    window: {start: 40, span: 10}, selectedOccurrenceId: 'late', reveal: {occurrenceId: 'late', token: 2},
  })} onWindowChange={onWindowChange}/>);
  assert.equal(requests.length, 1, 'one reveal request should move the window once');
  const moved = requests[0];
  assert.ok(moved.start <= 60 && moved.start + moved.span >= 60, `late note is outside ${JSON.stringify(moved)}`);
});

test('R1/R3: pitch reveal computes a scroll offset that brings a low note into view', () => {
  const target = pitchScrollTop(466.5, 0, 24, 168);
  assert.ok(target > 0, 'a low row below the viewport needs a positive offset');
  assert.ok(target + 168 >= 466.5, 'the offset must bring the row into the visible band');
  assert.equal(pitchScrollTop(100, 0, 24, 168), 0, 'a visible row must not move the canvas');
});

/* ------------------------------------------------------------------ R2 */

test('R2: the width observer attaches to a host mounted after a loading placeholder', () => {
  function Late({show}: {show: boolean}) {
    const [ref, width] = useElementWidth<HTMLDivElement>();
    return show
      ? <div ref={ref} data-width={width}>host</div>
      : <p>Loading</p>;
  }
  const view = render(<Late show={false}/>);
  view.rerender(<Late show={true}/>);
  const host = view.container.querySelector('[data-width]') as HTMLElement;
  assert.ok(host, 'host did not mount');
  assert.equal(Number(host.dataset.width), 600);
});

/* ------------------------------------------------------------------ R3 */

test('R3: the full 88-key range is drawn inside a scrollable pitch canvas', () => {
  const wide = buildNotation([note('low', 0, 21), note('high', 1, 108)], {duration: 10, bpm: 120});
  const view = render(<TimeRoll {...rollProps(wide, {selectedOccurrenceId: null, reveal: null})}/>);
  const svg = view.container.querySelector('.ws-roll-svg') as SVGSVGElement;
  const low = view.container.querySelector('[data-occurrence="low"]') as SVGRectElement;
  const pitchHeight = Number(svg.getAttribute('height'));
  const bottom = Number(low.getAttribute('y')) + Number(low.getAttribute('height'));
  assert.ok(pitchHeight > 168, `pitch canvas should scroll for a wide range, height=${pitchHeight}`);
  assert.ok(bottom <= pitchHeight, `low note bottom=${bottom} outside canvas ${pitchHeight}`);
  assert.ok(Number(low.getAttribute('y')) >= 0, 'low note must not be drawn above the canvas');
});

test('R3: a narrow range still fits the viewport without scrolling', () => {
  const narrow = buildNotation([note('c4', 0, 60), note('e4', 1, 64)], {duration: 10, bpm: 120});
  const view = render(<TimeRoll {...rollProps(narrow, {selectedOccurrenceId: null, reveal: null})}/>);
  const svg = view.container.querySelector('.ws-roll-svg') as SVGSVGElement;
  assert.ok(Number(svg.getAttribute('height')) <= 168 + 0.5);
});

/* ------------------------------------------------------------------ R4 */

function scoreDocument(): NotationDocument {
  const performance = [0, 4, 8, 12, 16].map((onset, index) => ({
    ...note(`n-${index}`, onset, 60 + index),
  }));
  let document = buildNotation(performance, {duration: 120, bpm: 60});
  const ticks = [1920, 960, 480, 240, 120];
  for (let index = 0; index < performance.length; index += 1) {
    const event = document.events.find(item => item.notes.some(noteItem => noteItem.performance_ids.includes(`n-${index}`)))!;
    if (event.duration === ticks[index]) continue;
    const result = applyCommand(document, {type: 'set-written-duration', target: {eventId: event.id}, ticks: ticks[index], scope: 'event'});
    assert.equal(result.status, 'applied', `could not set ${ticks[index]} ticks`);
    if (result.status === 'applied') document = result.document;
  }
  return document;
}

test('R4: written values render with their own heads, stems, flags and dots', () => {
  const document = scoreDocument();
  const boxes = layoutMeasures(document).boxes;
  // A wide viewport keeps every measure-bearing note inside the rendered range.
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 2400; }, configurable: true});
  const view = render(<ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={null} reveal={null} onSelect={() => {}}/>);
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 600; }, configurable: true});

  const whole = view.container.querySelector('[data-value="whole"]') as SVGGElement;
  const half = view.container.querySelector('[data-value="half"]') as SVGGElement;
  const quarter = view.container.querySelector('[data-value="quarter"]') as SVGGElement;
  const eighth = view.container.querySelector('[data-value="eighth"]') as SVGGElement;
  const sixteenth = view.container.querySelector('[data-value="sixteenth"]') as SVGGElement;
  for (const [name, node] of [['whole', whole], ['half', half], ['quarter', quarter], ['eighth', eighth], ['sixteenth', sixteenth]] as const) {
    assert.ok(node, `missing ${name} event`);
  }

  assert.ok(whole.querySelector('.ws-score-notehead.is-hollow'), 'whole note must be hollow');
  assert.equal(whole.querySelectorAll('.ws-score-stem').length, 0, 'whole note must not have a stem');
  assert.ok(half.querySelector('.ws-score-notehead.is-hollow'), 'half note must be hollow');
  assert.equal(half.querySelectorAll('.ws-score-stem').length, 1, 'half note needs a stem');
  assert.ok(!quarter.querySelector('.ws-score-notehead.is-hollow'), 'quarter note is filled');
  assert.equal(quarter.querySelectorAll('.ws-score-stem').length, 1);
  assert.equal(quarter.querySelectorAll('.ws-score-flag').length, 0);
  assert.equal(eighth.querySelectorAll('.ws-score-flag').length, 1, 'eighth has one flag');
  assert.equal(sixteenth.querySelectorAll('.ws-score-flag').length, 2, 'sixteenth has two flags');
});

test('R4: dotted values render an augmentation dot', () => {
  let document = buildNotation([note('dot', 0, 60)], {duration: 120, bpm: 60});
  const event = document.events[0];
  const result = applyCommand(document, {type: 'set-written-duration', target: {eventId: event.id}, ticks: 720, scope: 'event'});
  assert.equal(result.status, 'applied');
  if (result.status === 'applied') document = result.document;
  const boxes = layoutMeasures(document).boxes;
  const view = render(<ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={null} reveal={null} onSelect={() => {}}/>);
  const dotted = view.container.querySelector('[data-dotted="true"]') as SVGGElement;
  assert.ok(dotted, 'dotted event not rendered');
  assert.ok(dotted.querySelector('.ws-score-dot'), 'dotted value needs an augmentation dot');
});

test('R4: rests render their own glyph, not a shared square', () => {
  const document = buildNotation([note('a', 0, 60), note('b', 20, 64)], {duration: 24, bpm: 60});
  const boxes = layoutMeasures(document).boxes;
  const view = render(<ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={null} reveal={null} onSelect={() => {}}/>);
  const rests = view.container.querySelectorAll('.ws-score-rest-glyph');
  assert.ok(rests.length > 0, 'expected generated rests in the gap');
  for (const rest of rests) assert.ok(rest.textContent && rest.textContent.length > 0);
});

test('R4: a written note mapping several occurrences is not silently guessed', () => {
  const base = buildNotation([note('one', 1, 60), note('two', 3, 60)], {bpm: 120, duration: 8});
  const constructed: NotationDocument = structuredClone(base);
  constructed.events[0].notes[0].performance_ids = ['one', 'two'];
  constructed.events = [constructed.events[0]];
  const document = refreshNotation(constructed);
  const boxes = layoutMeasures(document).boxes;
  const selected: string[] = [];
  const ambiguous: string[][] = [];
  const view = render(<ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={null} reveal={null}
    onSelect={id => selected.push(id)} onAmbiguous={(_logical, ids) => ambiguous.push(ids)}/>);
  const head = view.container.querySelector('.ws-score-notehead') as SVGEllipseElement;
  assert.equal(head.dataset.ambiguous, 'true');
  head.dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true}));
  assert.deepEqual(selected, [], 'must not select the first repetition implicitly');
  assert.equal(ambiguous.length, 1);
  assert.deepEqual([...ambiguous[0]].sort(), ['one', 'two']);
});
