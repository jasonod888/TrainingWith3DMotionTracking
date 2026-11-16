import React from 'react';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {render} from '@testing-library/react';
import {buildNotation, refreshNotation, type NotationDocument, type PerformanceNote} from '../../../packages/music-notation/index.ts';
import {FormattedScore, layoutFormattedScore} from '../src/music/workspace/FormattedScore';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/formatted-score.html', pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window: dom.window as unknown as Window & typeof globalThis,
  document: dom.window.document,
  location: dom.window.location,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const note = (id: string, onset: number, duration: number, pitch: number): PerformanceNote => ({
  id, onset, duration, pitch, velocity: 0.6, confidence: null, optional: false, string: null, fret: null,
});

function score(notes: PerformanceNote[], duration = 8, key = 'C'): NotationDocument {
  const document = buildNotation(notes, {bpm: 120, duration});
  document.key_signature = key;
  return refreshNotation(document);
}

test('staff anchors use exact line positions on both staves', () => {
  const document = score([note('E4', 0, 0.5, 64), note('F5', 1, 0.5, 77), note('A3', 2, 0.5, 57)], 4);
  const layout = layoutFormattedScore(document);
  const system = layout.systems[0];
  const expected: Record<string, number> = {E4: 70, F5: 38, A3: 112};
  for (const segment of document.segments) for (const value of segment.notes) {
    const id = value.performance_ids[0];
    const position = layout.notePositions.get(value.id)!;
    assert.equal(position.y, system.y + expected[id], `${id} must sit on its staff line`);
  }
});

test('ledger lines are staff-relative and spaced by staff lines', () => {
  const document = score([note('low', 0, 0.5, 55), note('high', 1, 0.5, 84)], 4);
  const view = render(<FormattedScore document={document} title="Ledger fixture"/>);
  const ledgers = [...view.container.querySelectorAll('.formatted-ledger')].map(line => Number(line.getAttribute('y1')));
  assert.ok(ledgers.length >= 1);
  for (const y of ledgers) assert.ok(Math.abs(((y - 92 - 38) % 8)) < 0.001 || Math.abs(((y - 92 - 112) % 8)) < 0.001,
    `ledger at ${y} must align to staff lines`);
  view.unmount();
});

test('values, flags, chords, keys and ties render distinctly', () => {
  const document = score([
    note('whole', 0, 2, 60),
    note('half', 2, 1, 62),
    note('quarter', 3, 0.5, 64),
    note('eighth', 3.5, 0.25, 65),
    note('sixteenth', 3.75, 0.125, 67),
    note('chord-a', 4.5, 0.5, 69),
    note('chord-b', 4.5, 0.5, 72),
  ], 8, 'G');
  const view = render(<FormattedScore document={document} title="Values fixture"/>);
  const values = new Map<string, string>();
  for (const notehead of view.container.querySelectorAll('[data-formatted-segment]')) {
    values.set(notehead.getAttribute('data-formatted-segment') ?? '', notehead.getAttribute('data-formatted-value') ?? '');
  }
  assert.ok([...values.values()].includes('whole'));
  assert.ok([...values.values()].includes('quarter'));
  assert.ok([...values.values()].includes('eighth'));
  assert.equal(view.container.querySelectorAll('.formatted-flag').length > 0, true, 'short values need flags');
  assert.ok(view.container.querySelectorAll('.formatted-notehead').length >= 7);
  const sharpKey = view.container.querySelectorAll('.formatted-key');
  assert.ok(sharpKey.length >= 2, 'sharp key must be printed on both staves');
  assert.equal(sharpKey[0].textContent, '♯');
  view.unmount();

  const flat = render(<FormattedScore document={score([note('flat', 0, 0.5, 65)], 4, 'F')} title="Flat key"/>);
  assert.equal(flat.container.querySelector('.formatted-key')?.textContent, '♭');
  flat.unmount();
});

test('long tied notes produce incoming and outgoing continuation stubs', () => {
  const document = score([note('tie', 0, 60, 60)], 62);
  const layout = layoutFormattedScore(document);
  assert.ok(layout.systems.length > 1);
  const view = render(<FormattedScore document={document} title="Tie fixture"/>);
  const stubs = [...view.container.querySelectorAll('.formatted-tie.is-broken')];
  assert.ok(stubs.length >= 2, 'tie should continue across a system break');
  const paths = stubs.map(path => path.getAttribute('d') ?? '');
  assert.ok(paths.some(path => /q 8 -6 14 0/.test(path)), 'outgoing stub');
  assert.ok(paths.some(path => /q 8 -6 11 0/.test(path)), 'incoming stub approaches the left edge');
  view.unmount();
});

test('formatted layout keeps every segment and measure exactly once', () => {
  const document = score(Array.from({length: 24}, (_, index) => note(`n-${index}`, index * 0.8, 0.5, 60 + index % 12)), 24);
  const layout = layoutFormattedScore(document);
  assert.equal(layout.droppedSegments, 0);
  const placed = layout.systems.flatMap(system => system.segments.map(segment => segment.id));
  assert.equal(placed.length, document.segments.length);
  assert.equal(new Set(placed).size, document.segments.length);
  const measures = layout.systems.flatMap(system => system.measures);
  assert.deepEqual(measures.sort((a, b) => a - b), document.measures.map(measure => measure.index));
});
