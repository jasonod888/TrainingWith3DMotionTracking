/** Phase 4 reviewer regressions for 09fef39; no product writes or live services. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {buildNotation, alignmentFromSpans, alignmentProblem, tickToSeconds} from '../../packages/music-notation/index.ts';

async function main() {
  let failed = 0;
  const check = (name: string, body: () => void) => {
    try { body(); console.log(`PASS: ${name}`); }
    catch (error) { failed++; console.log(`FAIL: ${name}: ${(error as Error).message}`); }
  };
  const note = (id: string, onset: number, pitch: number) => ({
    id, onset, pitch, duration: .6, velocity: .5, confidence: null, optional: false, string: null, fret: null,
  });
  const d = buildNotation([note('before', 2, 60), note('after', 8, 72)], {bpm: 120, duration: 12});
  const map = alignmentFromSpans(d, [
    {start: 0, end: 4, kind: 'playing'}, {start: 4, end: 7, kind: 'explanation'}, {start: 7, end: 12, kind: 'playing'},
  ]);
  check('inverse before the score start returns the beginning, not the final passage start', () => {
    assert.equal(tickToSeconds(map, -1), 0);
  });
  for (const [name, passages] of [
    ['missing clip boundaries', [{kind: 'timed', source_seconds: [2, 10], ticks: [0, 9600]}]],
    ['unrepresented time gap', [{kind: 'timed', source_seconds: [0, 3], ticks: [0, 2880]}, {kind: 'timed', source_seconds: [5, 12], ticks: [2880, 9600]}]],
    ['unreported score jump', [{kind: 'timed', source_seconds: [0, 4], ticks: [0, 3840]}, {kind: 'timed', source_seconds: [4, 12], ticks: [5000, 12000]}]],
  ] as const) {
    check(`validation rejects ${name}`, () => {
      assert.ok(alignmentProblem({alignment_version: 1, mode: 'estimated', basis: 'passages', passages} as any, 12), `Invalid map accepted: ${name}`);
    });
  }

  const require = createRequire(resolve('apps/web/package.json'));
  const React = require('react');
  const {JSDOM} = require('jsdom');
  const dom = new JSDOM('<html><body></body></html>', {
    url: 'http://localhost/workspace-harness.html?demo=arpeggio', pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, location: dom.window.location,
    HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  });
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {get: () => 600, configurable: true});
  const {render, fireEvent, cleanup} = require('@testing-library/react');
  const {PianoWorkspaceHarness} = await import('../../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx');
  const view = render(React.createElement(PianoWorkspaceHarness));
  fireEvent.change(view.getByLabelText('Sync offset in seconds (not saved)'), {target: {value: '0.5'}});
  fireEvent.change(view.getByLabelText('Fixture clock'), {target: {value: '2.25'}});
  check('offset activation agrees across keyboard, roll and score', () => {
    const roll = view.container.querySelectorAll('.ws-roll-note.is-active').length;
    const score = view.container.querySelectorAll('.ws-score-notehead.is-active').length;
    const keys = view.container.querySelectorAll('.keyboard-white.is-active,.keyboard-black.is-active').length;
    assert.equal(roll, 0);
    assert.equal(score, 0);
    assert.equal(keys, 0);
  });
  cleanup();
  console.log(`${failed} Phase 4 reviewer check(s) failed.`);
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
