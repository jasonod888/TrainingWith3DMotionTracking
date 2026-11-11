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
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!window.matchMedia) {
  window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
}

const {render, screen, fireEvent, cleanup, within} = await import('@testing-library/react');
const {NotationEditor} = await import('../src/music/notation/NotationEditor.tsx');
const {buildNotation} = await import('../../../packages/music-notation/index.ts');

afterEach(() => cleanup());

const performance = [
  {id: 'bass-c', onset: 0, duration: 2, pitch: 48, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'treble-e', onset: 0.5, duration: 0.5, pitch: 64, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'treble-g', onset: 0.5, duration: 0.5, pitch: 67, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'treble-hold', onset: 0.5, duration: 2, pitch: 71, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'treble-c', onset: 1, duration: 0.5, pitch: 72, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'treble-d', onset: 1.5, duration: 0.5, pitch: 74, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
  {id: 'bass-g', onset: 2, duration: 2, pitch: 43, velocity: 0.6, confidence: null, optional: false, string: null, fret: null},
];
const initial = buildNotation(performance, {bpm: 120, time_signature: {numerator: 4, denominator: 4}, key_signature: 'C', duration: 4});

function Harness({onChange}: {onChange: (document: any) => void}) {
  const [document, setDocument] = useState(initial);
  return <NotationEditor title="Test lesson" document={document} onChange={next => { setDocument(next); onChange(next); }}/>;
}

test('the editor renders both staves and selects one note inside a chord', async () => {
  let latest: any = initial;
  render(<Harness onChange={value => { latest = value; }}/>);
  assert.ok(screen.getByRole('img', {name: /Grand staff, 2 measures/}));
  const e4 = screen.getByRole('button', {name: /^E4, measure 1, treble voice 2/});
  fireEvent.keyDown(e4, {key: 'Enter'});
  assert.ok(await screen.findByRole('heading', {name: 'E4'}));
  const chordNotes = screen.getByRole('group', {name: 'Notes in this chord'});
  const g4 = within(chordNotes).getByRole('button', {name: 'G4'});
  fireEvent.click(g4);
  assert.ok(await screen.findByRole('heading', {name: 'G4'}));
  fireEvent.click(screen.getByRole('button', {name: 'Sharp, raise one semitone'}));
  assert.ok(await screen.findByRole('heading', {name: 'G#4'}));
  fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
  assert.ok(await screen.findByRole('heading', {name: 'G4'}));
  assert.equal(latest, initial);
});

test('duration, undo and add/delete update the shared document', async () => {
  const updates: any[] = [];
  render(<Harness onChange={value => { updates.push(value); }}/>);
  fireEvent.keyDown(screen.getByRole('button', {name: /^E4, measure 1/}), {key: 'Enter'});
  fireEvent.click(screen.getByRole('button', {name: 'Half'}));
  assert.ok(updates.length > 0);
  const changed = updates.at(-1);
  const event = changed.events.find((item: any) => item.notes.some((note: any) => note.pitch === 64));
  assert.equal(event.duration, 960);
  const undoButton = screen.getByRole('button', {name: 'Undo'}) as HTMLButtonElement;
  assert.equal(undoButton.disabled, false, 'undo should be available after a duration edit');
  fireEvent.click(undoButton);
  await new Promise(resolve => setTimeout(resolve, 0));
  const undone = updates.at(-1);
  const restored = undone.events.find((item: any) => item.notes.some((note: any) => note.pitch === 64));
  assert.equal(restored.duration, 480);
  fireEvent.click(screen.getByRole('button', {name: 'Redo'}));
  await new Promise(resolve => setTimeout(resolve, 0));
  const redone = updates.at(-1);
  assert.equal(redone.events.find((item: any) => item.notes.some((note: any) => note.pitch === 64)).duration, 960);
  fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
  await new Promise(resolve => setTimeout(resolve, 0));
  const before = updates.at(-1).performance.length;
  // Entry duration follows the last chosen value; choose a quarter so the new
  // note at the playhead does not overwrite the E4 at 0.5 s.
  fireEvent.click(screen.getByRole('button', {name: 'Quarter'}));
  fireEvent.click(screen.getByRole('button', {name: 'Add note'}));
  const added = updates.at(-1);
  assert.equal(added.performance.length, before + 1);
  fireEvent.click(screen.getByRole('button', {name: 'Delete note'}));
  const removed = updates.at(-1);
  assert.equal(removed.performance.length, before);
});

test('phone view exposes large measure and tab controls', async () => {
  render(<Harness onChange={() => {}}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Phone view'}));
  assert.ok(screen.getByRole('tab', {name: 'Score'}));
  assert.ok(screen.getByRole('tab', {name: 'Piano roll'}));
  assert.ok(screen.getByRole('tab', {name: 'Keyboard'}));
  assert.ok(screen.getByText('Measure 1 of 2'));
  fireEvent.click(screen.getByRole('tab', {name: 'Piano roll'}));
  assert.ok(screen.getByRole('img', {name: /Editable piano roll/}));
});
