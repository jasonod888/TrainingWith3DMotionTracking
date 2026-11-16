import React from 'react';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {render} from '@testing-library/react';
import {buildNotation, type PerformanceNote} from '../../../packages/music-notation/index.ts';
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

const notes: PerformanceNote[] = [];
for (let index = 0; index < 24; index += 1) {
  notes.push({id: `n-${index}`, onset: index * 1.2, duration: index === 4 ? 3.1 : 0.8,
    pitch: 60 + (index % 12), velocity: 0.6, confidence: null, optional: false, string: null, fret: null});
}
const document = buildNotation(notes, {bpm: 120, duration: 34});

test('formatted layout keeps every segment and measure exactly once', () => {
  const layout = layoutFormattedScore(document);
  assert.ok(layout.pages.length >= 1);
  assert.equal(layout.droppedSegments, 0);
  const placed = layout.systems.flatMap(system => system.segments.map(segment => segment.id));
  assert.equal(placed.length, document.segments.length);
  assert.equal(new Set(placed).size, document.segments.length);
  const measures = layout.systems.flatMap(system => system.measures);
  assert.equal(measures.length, document.measures.length);
  assert.equal(new Set(measures).size, document.measures.length);
  for (const page of layout.pages) assert.ok(page.systems.length > 0);
});

test('formatted score is read-only and renders the same document', () => {
  const before = JSON.stringify(document);
  const view = render(<FormattedScore document={document} title="Boundary etude" selectedOccurrenceId="n-4"/>);
  assert.ok(view.container.querySelector('[data-formatted-page="1"]'));
  assert.ok(view.container.textContent?.includes('Boundary etude'));
  const noteheads = view.container.querySelectorAll('.formatted-notehead');
  const expected = document.segments.reduce((total, segment) => total + segment.notes.length, 0);
  assert.equal(noteheads.length, expected);
  assert.ok(view.container.querySelectorAll('.formatted-tie').length >= 1, 'tied note should draw a tie');
  assert.equal(JSON.stringify(document), before, 'rendering must not mutate the shared document');
  view.unmount();
});

test('system/page packing preserves all measures in a long score', () => {
  const longNotes: PerformanceNote[] = [];
  for (let index = 0; index < 240; index += 1) {
    longNotes.push({id: `long-${index}`, onset: index * 0.5, duration: 0.4, pitch: 55 + (index % 24),
      velocity: 0.6, confidence: null, optional: false, string: null, fret: null});
  }
  const long = buildNotation(longNotes, {bpm: 120, duration: 120});
  const layout = layoutFormattedScore(long);
  assert.ok(layout.pages.length > 1, `expected multiple pages, got ${layout.pages.length}`);
  const placed = layout.systems.flatMap(system => system.measures);
  assert.deepEqual(placed.sort((a, b) => a - b), long.measures.map(measure => measure.index));
});
