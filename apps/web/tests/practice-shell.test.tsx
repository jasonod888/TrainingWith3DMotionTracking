import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/practice.html', pretendToBeVisual: true});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  location: window.location,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
if (!window.matchMedia) window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 4)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;

const {render, fireEvent, cleanup} = await import('@testing-library/react');
const {PracticeShell} = await import('../src/practice/PracticeShell.tsx');
const {definePracticePlan} = await import('../../../packages/learning-engine/practice-plan.ts');
const {emptyPracticeSnapshot: snapshotFor} = await import('../../../packages/learning-engine/practice-runtime.ts');
const {MUSIC_CAPABILITIES} = await import('../../../packages/learning-engine/practice-capabilities.ts');

after(() => { cleanup(); dom.window.close(); });

const plan = definePracticePlan({
  lessonId: 'shell', revisionId: 'r1', duration: 6, title: 'Shell fixture',
  units: [
    {id: 'one', label: 'One', start: 0, end: 2},
    {id: 'two', label: 'Two', start: 2, end: 4},
    {id: 'three', label: 'Three', start: 4, end: 6},
  ],
});

function voice(overrides: any = {}) {
  return {
    status: 'off', error: '', listening: false, supported: true,
    control: {supported: true, enabled: true, off: true, status: 'Off'},
    start: () => true, stop: () => {}, toggle: () => {}, started: 0, stopped: 0,
    ...overrides,
  };
}

test('shared shell asks before voice and Without voice never starts recognition', () => {
  const commands: any[] = [];
  const v = voice({start: () => { v.started += 1; return true; }, stop: () => { v.stopped += 1; }});
  const renderShell = () => <PracticeShell title="Piano" plan={plan} snapshot={snapshotFor(plan)}
    capabilities={{...MUSIC_CAPABILITIES, voice: v.control}} voice={v as any} autoStartVoice
    onCommand={command => commands.push(command)} onSeek={() => {}} onSelect={() => {}}
    stage={<div>stage</div>}/>;
  const view = render(renderShell());
  fireEvent.click(view.container.querySelector('.practice-player-primary')!);
  assert.equal(v.started, 0, 'the first Start asks instead of silently opening the microphone');
  assert.equal(commands.length, 0);
  fireEvent.click(view.getByText('Start with voice'));
  assert.equal(v.started, 1);
  assert.equal(commands.length, 0, 'practice waits for observed listening');
  view.unmount();

  commands.length = 0;
  v.started = 0;
  const second = render(renderShell());
  fireEvent.click(second.container.querySelector('.practice-player-primary')!);
  assert.equal(v.started, 0);
  fireEvent.click(second.getByText('Without voice'));
  assert.equal(v.started, 0, 'Without voice must never call recognition.start()');
  assert.deepEqual(commands, [{type: 'action', action: 'start'}]);
  second.unmount();
});

test('unsupported capabilities hide voice/repeat and the section heading opens a picker', () => {
  const v = voice({supported: false, control: {supported: false, enabled: false, reason: 'Browser speech unavailable'}});
  const view = render(<PracticeShell title="Piano" plan={plan} snapshot={snapshotFor(plan)}
    capabilities={{...MUSIC_CAPABILITIES, voice: v.control, repeat: 'unsupported'}} voice={v as any}
    onCommand={() => {}} onSeek={() => {}} onSelect={() => {}} stage={<div>stage</div>}/>);
  assert.equal(view.container.querySelector('.practice-voice-status'), null);
  fireEvent.click(view.container.querySelector('[aria-label^="Browse sections"]')!);
  assert.ok(document.querySelector('[aria-label="Practice sections"]'));
  fireEvent.click(view.container.querySelector('.practice-runtime-header-actions [aria-label="Practice settings"]')!);
  assert.equal(document.body.textContent?.includes('Repeat automatically'), false);
  view.unmount();
});

test('shared keyboard mapping dispatches the same normalized commands and ignores inputs', () => {
  const commands: any[] = [];
  const v = voice();
  const view = render(<PracticeShell title="Piano" plan={plan} snapshot={snapshotFor(plan)}
    capabilities={{...MUSIC_CAPABILITIES, voice: v.control}} voice={v as any}
    onCommand={command => commands.push(command)} onSeek={() => {}} onSelect={() => {}} stage={<div>stage</div>}/>);
  fireEvent.keyDown(document.body, {key: ' '});
  fireEvent.keyDown(document.body, {key: 'ArrowRight'});
  fireEvent.keyDown(document.body, {key: 'r'});
  window.dispatchEvent(new window.KeyboardEvent('keydown', {key: ' ', bubbles: true}));
  window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
  window.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'r', bubbles: true}));
  assert.deepEqual(commands.map(command => command.action).slice(-3), ['toggle', 'next', 'repeat-section']);
  const input = view.container.querySelector('.practice-section-picker input') ?? document.createElement('input');
  document.body.append(input);
  fireEvent.keyDown(input, {key: 'ArrowRight'});
  assert.equal(commands.length, 6);
  input.remove();
  view.unmount();
});
