import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import type {NotationDocument} from '../../../packages/music-notation/index.ts';
import {PianoWaterfall} from '../src/music/workspace/PianoWaterfall.tsx';
import {KeyboardEditor} from '../src/music/notation/KeyboardEditor.tsx';
import {STANDARD_PIANO_RANGE} from '../src/music/notation/piano-key-geometry.ts';
import {createClock} from '../src/music/workspace/clock.ts';
import {pitchName} from '../src/music/music-reference.ts';
import {
  closeHarness, fireEvent, open, PianoWorkspaceHarness, render, waitFor,
} from './workspace-journeys-setup';

const {act} = await import('@testing-library/react');
after(closeHarness);

const documentDouble = {duration: 12, performance: []} as unknown as NotationDocument;

test('waterfall maps authoritative source time and holds to shared key lanes', async () => {
  const clock = createClock(0);
  const selected: string[] = [];
  const view = render(<PianoWaterfall document={documentDouble} clock={clock}
    intervals={[
      {id: 'a', pitch: 60, start: 2, end: 3},
      {id: 'held', pitch: 64, start: 0, end: 4},
      {id: 'off', pitch: 90, start: 1, end: 2},
    ]}
    range={{firstPitch: 60, semitones: 24}} selectedOccurrenceId="a"
    onSelect={id => selected.push(id)}/>);
  await waitFor(() => assert.ok(view.container.querySelector('.ws-waterfall-svg')));
  const future = view.container.querySelector('[data-occurrence="a"]') as SVGRectElement;
  assert.ok(future, 'future note is visible');
  // Five-second window across 220 view units: onset 2 s -> bottom 132, 1 s tall -> y 88.
  assert.ok(Math.abs(Number(future.getAttribute('y')) - 88) < 0.01);
  assert.ok(Math.abs(Number(future.getAttribute('height')) - 44) < 0.01);
  assert.ok(future.classList.contains('is-selected'));
  assert.equal(future.querySelector('title')?.textContent, pitchName(60),
    'human-facing block title omits the internal occurrence id');
  const held = view.container.querySelector('[data-occurrence="held"]') as SVGRectElement;
  assert.ok(Math.abs(Number(held.getAttribute('y')) - 44) < 0.01,
    'a note already sounding at the seek target keeps its full body');
  assert.equal(view.container.querySelector('[data-out-of-range]')?.getAttribute('data-out-of-range'), '0:1');
  fireEvent.pointerDown(future, {clientX: 10, clientY: 10});
  assert.deepEqual(selected, ['a']);

  act(() => clock.set(2));
  await waitFor(() => assert.ok(view.container.querySelector('[data-occurrence="a"]')?.classList.contains('is-active')));
  const active = view.container.querySelector('[data-occurrence="a"]') as SVGRectElement;
  assert.ok(Math.abs(Number(active.getAttribute('y')) - 176) < 0.01, 'onset reaches the strike line');
  const heldRemaining = view.container.querySelector('[data-occurrence="held"]') as SVGRectElement;
  assert.ok(Math.abs(Number(heldRemaining.getAttribute('y')) - 132) < 0.01,
    'seek into a hold shows only the remaining hold at the boundary');
  assert.ok(view.container.querySelector('[data-occurrence="held"]')?.classList.contains('is-active'));
});

test('authoritative interval changes project start/duration/add/delete without special cases', async () => {
  const clock = createClock(0);
  const base = {document: documentDouble, clock, range: {firstPitch: 60, semitones: 24},
    selectedOccurrenceId: null, onSelect: () => {}};
  const view = render(<PianoWaterfall {...base} intervals={[
    {id: 'a', pitch: 60, start: 1, end: 2},
    {id: 'b', pitch: 64, start: 2, end: 3},
  ]}/>);
  await waitFor(() => assert.ok(view.container.querySelector('[data-occurrence="a"]')));
  const a = view.container.querySelector('[data-occurrence="a"]') as SVGRectElement;
  assert.ok(Math.abs(Number(a.getAttribute('height')) - 44) < 0.01);
  assert.ok(view.container.querySelector('[data-occurrence="b"]'));
  view.rerender(<PianoWaterfall {...base} intervals={[
    {id: 'a', pitch: 60, start: 1.5, end: 3},
    {id: 'c', pitch: 67, start: 3, end: 4},
  ]}/>);
  await waitFor(() => assert.ok(view.container.querySelector('[data-occurrence="c"]')));
  const changed = view.container.querySelector('[data-occurrence="a"]') as SVGRectElement;
  assert.ok(Math.abs(Number(changed.getAttribute('y')) - 88) < 0.01,
    'later start moves the projected onset');
  assert.ok(Math.abs(Number(changed.getAttribute('height')) - 66) < 0.01,
    'duration projects through recorded seconds');
  assert.ok(view.container.querySelector('[data-occurrence="b"]') === null, 'deleted occurrence disappears');
});

test('reduced motion steps positions but exact live time owns visibility and activation', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {},
    removeEventListener() {}, dispatchEvent: () => false});
  try {
    const clock = createClock(1.75);
    const view = render(<PianoWaterfall document={documentDouble} clock={clock}
      intervals={[{id: 'boundary', pitch: 60, start: 2, end: 3}]}
      range={{firstPitch: 60, semitones: 24}} selectedOccurrenceId={null} onSelect={() => {}}/>);
    await waitFor(() => assert.equal(Number(view.container.querySelector('.ws-waterfall')?.getAttribute('data-guide-now')), 1.5));
    assert.equal(Number(view.container.querySelector('.ws-waterfall')?.getAttribute('data-live-now')), 1.75);
    const block = view.container.querySelector('[data-occurrence="boundary"]') as SVGRectElement;
    assert.ok(block, 'the exact live time keeps the future block visible');
    assert.ok(!block.classList.contains('is-active'), 'rounded guide position must not activate early');
    act(() => clock.set(3.1));
    await waitFor(() => assert.ok(view.container.querySelector('[data-occurrence="boundary"]') === null,
      'exact live time must remove an ended block even when the guide position still rounds earlier'));
    act(() => clock.set(2));
    await waitFor(() => assert.ok(view.container.querySelector('[data-occurrence="boundary"]')?.classList.contains('is-active')));
  } finally {
    window.matchMedia = original;
  }
});

test('full-range keyboard exposes A0/C8 and middle C without pan controls', async () => {
  const view = render(<KeyboardEditor document={documentDouble} selectedPitch={null} activePitches={[]}
    onKey={() => {}} width={1200} range={STANDARD_PIANO_RANGE} onRangeChange={() => {}}/>);
  const toolbar = view.container.querySelector('.keyboard-toolbar') as HTMLElement;
  assert.equal(toolbar.querySelectorAll('button').length, 0, 'fixed full range has no misleading octave controls');
  assert.match(toolbar.textContent ?? '', /A0–C8 · 88 keys/);
  const svg = view.container.querySelector('.keyboard-svg') as SVGElement;
  assert.equal(svg.getAttribute('data-key-count'), '88');
  const labels = [...view.container.querySelectorAll('.keyboard-overlay-label')].map(label => label.textContent);
  assert.ok(labels.includes('A0'));
  assert.ok(labels.includes('C4'));
  assert.ok(labels.includes('C8'));
  assert.ok(view.container.querySelector('.keyboard-overlay-label.is-middle-c')?.textContent === 'C4');
  const pitches = [...view.container.querySelectorAll('.keyboard-white, .keyboard-black')]
    .map(key => Number(key.getAttribute('data-pitch')));
  assert.equal(pitches.length, 88);
  assert.ok(pitches.every(pitch => pitch >= 21 && pitch <= 108));
});

test('narrow keyboard range controls pan within the full instrument boundaries', async () => {
  const changes: {firstPitch: number; semitones: number}[] = [];
  const view = render(<KeyboardEditor document={documentDouble} selectedPitch={null} activePitches={[]}
    onKey={() => {}} width={480} range={{firstPitch: 21, semitones: 24}}
    onRangeChange={range => changes.push(range)}/>);
  const previous = view.getByRole('button', {name: 'Previous keyboard range'}) as HTMLButtonElement;
  const next = view.getByRole('button', {name: 'Next keyboard range'}) as HTMLButtonElement;
  assert.equal(previous.disabled, true, 'A0 is a hard boundary');
  fireEvent.click(next);
  assert.deepEqual(changes.at(-1), {firstPitch: 33, semitones: 24});
  view.rerender(<KeyboardEditor document={documentDouble} selectedPitch={null} activePitches={[]}
    onKey={() => {}} width={480} range={{firstPitch: 84, semitones: 24}}
    onRangeChange={range => changes.push(range)}/>);
  assert.equal((view.getByRole('button', {name: 'Next keyboard range'}) as HTMLButtonElement).disabled,
    true, 'C8 is a hard boundary');
  assert.match(view.container.querySelector('.keyboard-octave')?.textContent ?? '', /A0–C8/);
});

test('editing and undo update the guide without remounting the source media', async () => {
  const view = await open();
  await waitFor(() => assert.ok(view.container.querySelector('.ws-waterfall-note')), {timeout: 2000});
  const initial = view.container.querySelector('.ws-waterfall-note') as SVGRectElement;
  const id = initial.getAttribute('data-occurrence')!;
  const pitch = initial.getAttribute('data-pitch');
  const video = view.container.querySelector('video');
  fireEvent.pointerDown(initial, {clientX: 100, clientY: 100, pointerId: 31, button: 0});
  await waitFor(() => assert.equal(
    view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-mode'), 'note'));
  fireEvent.click(view.getByRole('button', {name: '+ semitone'}));
  await waitFor(() => assert.notEqual(
    view.container.querySelector(`.ws-waterfall-note[data-occurrence="${id}"]`)?.getAttribute('data-pitch'), pitch));
  const edited = view.container.querySelector(`.ws-waterfall-note[data-occurrence="${id}"]`)?.getAttribute('data-pitch');
  fireEvent.click(view.getByRole('button', {name: 'Undo', exact: true}));
  await waitFor(() => assert.equal(
    view.container.querySelector(`.ws-waterfall-note[data-occurrence="${id}"]`)?.getAttribute('data-pitch'), pitch));
  assert.equal(view.container.querySelector(`.ws-waterfall-note[data-occurrence="${id}"]`)?.getAttribute('data-pitch'),
    pitch);
  assert.ok(edited !== pitch);
  assert.ok(video === view.container.querySelector('video'), 'the one source video element is not remounted');
});

test('a clicked waterfall block is the mobile peek reference', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({matches: query.includes('max-width: 760px'), media: query,
    onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false});
  try {
    const view = await open();
    await waitFor(() => assert.ok(view.container.querySelector('.ws-waterfall-note')), {timeout: 2000});
    const block = view.container.querySelector('.ws-waterfall-note') as SVGRectElement;
    const id = block.getAttribute('data-occurrence')!;
    block.getBoundingClientRect = () => ({top: 600, bottom: 610, left: 100, right: 120,
      width: 20, height: 10, x: 100, y: 600, toJSON: () => ({})});
    const score = [...view.container.querySelectorAll<SVGEllipseElement>('.ws-score-notehead[data-occurrence]')]
      .find(note => note.getAttribute('data-occurrence') === id);
    if (score) score.getBoundingClientRect = () => ({top: 300, bottom: 310, left: 100, right: 120,
      width: 20, height: 10, x: 100, y: 300, toJSON: () => ({})});
    fireEvent.pointerDown(block, {clientX: 100, clientY: 600, pointerId: 41, button: 0});
    await waitFor(() => assert.equal(
      view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-mode'), 'note'));
    assert.equal(view.container.querySelector('[data-settings-drawer]')?.getAttribute('data-peek-position'), 'top',
      'the actual clicked waterfall glyph, not the score fallback, controls the peek edge');
    assert.equal((globalThis as any).__pianoWorkspaceSnapshot().selection.occurrenceId, id);
    assert.ok(view.container.querySelector('.ws-note-primary') === null, 'compact simple peek remains');
  } finally {
    window.matchMedia = original;
  }
});
