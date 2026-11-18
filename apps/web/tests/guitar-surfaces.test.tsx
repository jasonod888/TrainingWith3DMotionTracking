import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  SVGElement: window.SVGElement,
  location: window.location,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get() { return 640; }, configurable: true});
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}

const {render, cleanup} = await import('@testing-library/react');
const {buildNotation} = await import('../../../packages/music-notation/index.ts');
const {layoutMeasures} = await import('../src/music/workspace/viewport.ts');
const {TimeRoll} = await import('../src/music/workspace/TimeRoll.tsx');
const {ContinuousScore} = await import('../src/music/workspace/ContinuousScore.tsx');
const {GuitarChordStrumHud, strumPatternFor} = await import('../src/music/workspace/GuitarChordStrumHud.tsx');
const GuitarNeckGuide = (await import('../src/music/renderers/GuitarNeckGuide.tsx')).default;
const {InstrumentGuideStage} = await import('../src/music/renderers/InstrumentGuideStage.tsx');

afterEach(() => cleanup());

const note = (id, onset, pitch, string, fret) => ({
  id, onset, pitch, duration: 0.4, velocity: 0.7, confidence: null, optional: false, string, fret,
});
const score = buildNotation([
  note('n1', 0, 64, 1, 0), note('n2', 0.5, 40, 6, 0), note('n3', 0.5, 45, 5, 0), note('n4', 0.5, 50, 4, 0),
], {subject: 'guitar', duration: 4});
const chords = [{id: 'c1', name: 'C', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1}];

test('GuitarNeckGuide keeps the legacy renderer contract and exposes editor affordances', () => {
  const positions = [{pitch: 64, string: 1, fret: 0, label: 'E4', finger: 2 as const}];
  const view = render(<GuitarNeckGuide positions={positions} fretCount={15} handedness="left"
    tuning="drop_d" capo={2}
    upcomingPositions={[{string: 2, fret: 3}]} candidatePositions={[{string: 3, fret: 5}]}
    onPositionSelect={() => {}}/>);
  const host = view.container.querySelector('[data-renderer="guitar-library"]');
  assert.ok(host);
  assert.equal(host.getAttribute('data-positions'), '1:0:64');
  assert.equal(host.getAttribute('data-fret-count'), '15');
  assert.equal(host.getAttribute('data-handedness'), 'left');
  assert.equal(host.getAttribute('data-interactive'), 'true');
  assert.equal(host.getAttribute('data-upcoming-positions'), '2:3');
  assert.equal(host.getAttribute('data-candidate-positions'), '3:5');
  assert.equal(host.getAttribute('data-tuning'), 'drop_d');
  assert.equal(host.getAttribute('data-capo'), '2');
  assert.equal(host.getAttribute('data-finger-colors'), 'true');
  assert.equal(host.getAttribute('data-fingers'), '1:0:2');
  assert.ok(view.container.querySelector('[aria-label="Finger colors"]'));
});

test('strumPatternFor marks low-to-high chord clusters as downstrokes', () => {
  const slots = strumPatternFor([
    {onset: 0.0, pitch: 40, string: 6}, {onset: 0.01, pitch: 45, string: 5},
    {onset: 0.02, pitch: 50, string: 4},
  ], 0, 2, 4);
  assert.equal(slots[0].direction, 'down');
  assert.equal(slots.length, 8);
});

test('GuitarChordStrumHud renders the active, next chord and the strum bar', () => {
  const view = render(<GuitarChordStrumHud chords={[
    {id: 'c1', name: 'C', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1},
    {id: 'c2', name: 'G', start: 2, frets: [3, 2, 0, 0, 0, 3], position: 1},
  ]} time={0.5} events={[{onset: 0, pitch: 48, string: 6}]} beatsPerBar={4}/>);
  assert.ok(view.container.querySelector('[data-chord="C"]'));
  assert.ok(view.container.querySelector('[data-chord="G"]'));
  assert.equal(view.container.querySelector('[data-strum-slots]')?.getAttribute('data-strum-slots'), '8');
});

test('TimeRoll rowMode strings draws six lanes with string and fret data', () => {
  const view = render(<TimeRoll document={score} window={{start: 0, span: 8}} onWindowChange={() => {}}
    selectedOccurrenceId="n1" reveal={null} playhead={0} rowMode="strings"
    onSelect={() => {}} onSeek={() => {}}/>);
  assert.equal(view.container.querySelector('[data-row-mode]')?.getAttribute('data-row-mode'), 'strings');
  assert.equal(view.container.querySelectorAll('[data-string-line]').length, 6);
  const bars = [...view.container.querySelectorAll('[data-guitar-string]')];
  assert.ok(bars.length >= 1);
  assert.ok(bars.some(bar => bar.getAttribute('data-guitar-string') === '1'));
  assert.ok(view.container.querySelector('[data-fret-label]'));
});

test('TimeRoll rowMode strings colors bars by finger and shows the active tuning labels', () => {
  const fingers = buildNotation([
    note('open', 0, 64, 1, 0), note('i', 0.2, 62, 2, 3), note('m', 0.4, 63, 2, 4),
  ], {subject: 'guitar', duration: 2});
  const view = render(<TimeRoll document={fingers} window={{start: 0, span: 8}} onWindowChange={() => {}}
    selectedOccurrenceId={null} reveal={null} playhead={0} rowMode="strings"
    onSelect={() => {}} onSeek={() => {}}/>);
  const values = [...view.container.querySelectorAll('[data-finger]')].map(bar => bar.getAttribute('data-finger'));
  assert.ok(values.includes('0'));
  assert.ok(values.includes('1'));
  assert.ok(values.includes('2'));
  assert.ok(view.container.querySelector('.ws-roll-bar-finger-1'));
  const dropD = render(<TimeRoll document={score} window={{start: 0, span: 8}} onWindowChange={() => {}}
    selectedOccurrenceId={null} reveal={null} playhead={0} rowMode="strings" tuning="drop_d" capo={0}
    onSelect={() => {}} onSeek={() => {}}/>);
  assert.match(dropD.container.querySelector('[data-string-lane="6"]')?.textContent ?? '', /D2/);
});

test('unplayable notes are marked instead of faked as string 1 fret 0', () => {
  const roll = render(<TimeRoll document={score} window={{start: 0, span: 8}} onWindowChange={() => {}}
    selectedOccurrenceId={null} reveal={null} playhead={0} rowMode="strings"
    tuning="standard" capo={2} onSelect={() => {}} onSeek={() => {}}/>);
  const unplayable = roll.container.querySelector('[data-unplayable="true"]');
  assert.ok(unplayable);
  assert.equal(unplayable.getAttribute('data-fret'), null);
  assert.equal(unplayable.getAttribute('data-guitar-string'), '6');
  assert.ok(!roll.container.querySelector('[data-unplayable="true"] [data-fret="0"]'));

  const boxes = layoutMeasures(score).boxes;
  const tab = render(<ContinuousScore document={score} boxes={boxes} selectedOccurrenceId={null}
    reveal={null} onSelect={() => {}} staffMode="guitar-tab" tuning="standard" capo={2}/>);
  const marker = tab.container.querySelector('[data-unplayable="true"]');
  assert.ok(marker);
  assert.equal(marker.getAttribute('data-fret'), null);
});

test('TimeRoll keeps finger fill on a selected bar and exposes finger labels', () => {
  const fingers = buildNotation([
    note('open', 0, 64, 1, 0), note('i', 0.2, 62, 2, 3), note('m', 0.4, 63, 2, 4),
  ], {subject: 'guitar', duration: 2});
  const view = render(<TimeRoll document={fingers} window={{start: 0, span: 8}} onWindowChange={() => {}}
    selectedOccurrenceId="i" reveal={null} playhead={0} rowMode="strings"
    onSelect={() => {}} onSeek={() => {}}/>);
  const bar = view.container.querySelector('[data-occurrence="i"]') as SVGRectElement;
  assert.ok(bar);
  assert.equal(bar.getAttribute('data-finger'), '1');
  const fill = bar.style.fill.toLowerCase();
  assert.ok(fill === '#4a90e2' || fill === 'rgb(74, 144, 226)', `unexpected fill ${fill}`);
  const label = view.container.querySelector('[data-finger-label="1:Index"]');
  assert.ok(label);
  assert.match(bar.querySelector('title')?.textContent ?? '', /finger 1 \(Index\)/);
});

test('high frets expand the neck and capo badges are visible', () => {
  const view = render(<GuitarNeckGuide positions={[{pitch: 83, string: 1, fret: 19, label: 'B5'}]}
    fretCount={12}/>);
  assert.equal(view.container.querySelector('[data-renderer="guitar-library"]')?.getAttribute('data-fret-count'), '19');
  const roll = render(<TimeRoll document={score} window={{start: 0, span: 8}} onWindowChange={() => {}}
    selectedOccurrenceId={null} reveal={null} playhead={0} rowMode="strings" capo={2}
    onSelect={() => {}} onSeek={() => {}}/>);
  assert.equal(roll.container.querySelector('[data-capo-badge]')?.getAttribute('data-capo-badge'), '2');
  assert.match(roll.container.querySelector('[data-capo-badge]')?.textContent ?? '', /Capo 2/);
  const boxes = layoutMeasures(score).boxes;
  const tab = render(<ContinuousScore document={score} boxes={boxes} selectedOccurrenceId={null}
    reveal={null} onSelect={() => {}} staffMode="guitar-tab" capo={2}/>);
  assert.equal(tab.container.querySelector('[data-capo-badge]')?.getAttribute('data-capo-badge'), '2');
  assert.match(tab.container.textContent ?? '', /Capo 2/);
});

test('legacy Watch guide uses saved Drop D positions and labels for D2', () => {
  const event = {id: 'd2', onset: 0, duration: 0.5, pitch: 38, velocity: 0.8,
    confidence: 1, optional: false, string: null, fret: null};
  const saved = {
    reference_version: 1, subject: 'guitar', instrument: {instrument: 'guitar'}, duration: 4,
    events: [event], spans: [], guitar_chords: [], guitarChords: [],
    review: {reviewer_id: 'r', reviewed_at: '2026-01-01T00:00:00Z', draft_id: 'd',
      source_reference_sha256: '0'.repeat(64)},
    notation: {guitar_tuning: 'drop_d', guitar_capo: 0,
      performance: [{id: 'd2', pitch: 38, string: 6, fret: 0}]},
  };
  const view = render(<InstrumentGuideStage reference={saved as any} active={[event as any]}
    guitarLibrary={false}/>);
  const board = view.container.querySelector('.fretboard');
  assert.ok(board);
  assert.match(board.getAttribute('aria-label') ?? '', /Drop D/);
  assert.match(board.textContent ?? '', /D2/);
  assert.ok(view.container.querySelectorAll('.fret-cell.is-active').length > 0);
});

test('ContinuousScore staffMode guitar-tab renders a six-line TAB with fret numbers', () => {
  const boxes = layoutMeasures(score).boxes;
  const view = render(<ContinuousScore document={score} boxes={boxes} selectedOccurrenceId={null}
    reveal={null} onSelect={() => {}} staffMode="guitar-tab" guitarChords={chords}/>);
  assert.equal(view.container.querySelector('[data-staff-mode]')?.getAttribute('data-staff-mode'), 'guitar-tab');
  assert.equal(view.container.querySelectorAll('[data-tab-string]').length, 6);
  const frets = [...view.container.querySelectorAll('.ws-score-tab-fret')];
  assert.ok(frets.length >= 1);
  assert.ok(frets.some(item => item.getAttribute('data-fret') === '0'));
  assert.ok(view.container.querySelector('.ws-score-chord'));
  const dropD = render(<ContinuousScore document={score} boxes={boxes} selectedOccurrenceId={null}
    reveal={null} onSelect={() => {}} staffMode="guitar-tab" tuning="drop_d" capo={0}/>);
  assert.equal(dropD.container.querySelector('[data-staff-mode]')?.getAttribute('data-tuning'), 'drop_d');
  assert.match(dropD.container.textContent ?? '', /D2/);
});
