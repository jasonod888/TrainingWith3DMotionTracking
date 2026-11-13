/** Phase 3 reviewer component checks for 86b3d3a. No services or product writes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
async function main() {
const require = createRequire(resolve('apps/web/package.json'));
const React = require('react');
const {JSDOM} = require('jsdom');
const dom = new JSDOM('<html><body></body></html>', {url: 'http://localhost', pretendToBeVisual: true});
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, React,
  IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
});
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {get: () => 600, configurable: true});
const {render, cleanup} = require('@testing-library/react');
const {buildNotation, applyCommand} = await import('../../packages/music-notation/index.ts');
const {TimeRoll} = await import('../../apps/web/src/music/workspace/TimeRoll.tsx');
const {ContinuousScore} = await import('../../apps/web/src/music/workspace/ContinuousScore.tsx');
const {useElementWidth} = await import('../../apps/web/src/music/workspace/useElementWidth.ts');
const {layoutMeasures} = await import('../../apps/web/src/music/workspace/viewport.ts');

const note = (id: string, onset: number, pitch: number) => ({
  id, onset, pitch, duration: .4, velocity: .5, confidence: null, optional: false, string: null, fret: null,
});
const score = buildNotation([note('selected', 5, 60), note('late', 60, 64)], {duration: 100, bpm: 120});
const props = {
  document: score, window: {start: 0, span: 10}, onWindowChange: (_: any) => {},
  selectedOccurrenceId: 'selected', revealOccurrenceId: 'selected', playhead: 0,
  onSelect: () => {}, onSeek: () => {},
};
let failed = 0;
function check(name: string, body: () => void) {
  try { body(); console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${(error as Error).message}`); }
  finally { cleanup(); }
}

check('manual pan is not reversed just because a note remains selected', () => {
  const requests: any[] = [];
  const onWindowChange = (w: any) => requests.push(w);
  const view = render(React.createElement(TimeRoll, {...props, onWindowChange}));
  requests.length = 0;
  view.rerender(React.createElement(TimeRoll, {...props, onWindowChange, window: {start: 40, span: 10}}));
  assert.equal(requests.length, 0, `pan was reversed with ${JSON.stringify(requests)}`);
});

check('width observer attaches after a loading placeholder is replaced by its host', () => {
  function Late({show}: {show: boolean}) {
    const [ref, width] = useElementWidth();
    return show ? React.createElement('div', {ref, 'data-width': width}) : React.createElement('p', null, 'Loading');
  }
  const view = render(React.createElement(Late, {show: false}));
  view.rerender(React.createElement(Late, {show: true}));
  assert.equal(Number(view.container.firstChild.dataset.width), 600);
});

check('full 88-key pitch range is not drawn outside an inaccessible fixed-height SVG', () => {
  const wide = buildNotation([note('low', 0, 21), note('high', 1, 108)], {bpm: 120, duration: 10});
  const view = render(React.createElement(TimeRoll, {...props, document: wide, selectedOccurrenceId: null, revealOccurrenceId: null}));
  const svg = view.container.querySelector('svg');
  const low = view.container.querySelector('[data-occurrence="low"]');
  const bottom = Number(low.getAttribute('y')) + Number(low.getAttribute('height'));
  assert.ok(bottom <= Number(svg.getAttribute('height')), `low note bottom=${bottom}; SVG height=${svg.getAttribute('height')}`);
});

check('whole-note notation has no stem', () => {
  const initial = buildNotation([note('whole', 0, 60)], {bpm: 120, duration: 8});
  const result = applyCommand(initial, {
    type: 'set-written-duration', target: {eventId: initial.events[0].id}, scope: 'event', ticks: 1920,
  });
  assert.equal(result.status, 'applied');
  if (result.status !== 'applied') return;
  const d = result.document;
  const view = render(React.createElement(ContinuousScore, {
    document: d, boxes: layoutMeasures(d).boxes, selectedOccurrenceId: null, revealTick: null, onSelect: () => {},
  }));
  assert.equal(view.container.querySelectorAll('.ws-score-stem').length, 0);
});

console.log(`${failed} Phase 3 reviewer check(s) failed.`);
process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
