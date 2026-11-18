import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/body-controller.html', pretendToBeVisual: true});
const {window} = dom;
Object.assign(globalThis, {
  window: window as unknown as Window & typeof globalThis,
  document: window.document,
  location: window.location,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
if (!window.matchMedia) window.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}});

const {render, fireEvent, cleanup, waitFor} = await import('@testing-library/react');
const {PracticeSession} = await import('../../../packages/learning-engine/practice-session.ts');
const {Playback} = await import('../../../packages/learning-engine/playback.ts');
const {BODY_CAPABILITIES} = await import('../../../packages/learning-engine/practice-capabilities.ts');
const {derivePracticeView} = await import('../../../packages/learning-engine/practice-view.ts');
const {PracticePrimaryActions} = await import('../src/practice/PracticePrimaryActions.tsx');
const {bodyPracticePlan} = await import('../src/practice/practice-plans.ts');

const lesson = {
  lesson_id: 'body', revision_id: 'rev', title: 'Body', duration: 4,
  section_set: {id: 's', revision: 1, duration: 4, sections: [
    {id: 'one', label: 'One', start: 0, end: 2},
    {id: 'two', label: 'Two', start: 2, end: 4},
  ]},
} as unknown as import('../../../packages/lesson-schema/index').LessonManifest;

after(() => { cleanup(); dom.window.close(); });

test('body controller view/actions refresh through start, pause, resume, next and completion', async () => {
  const player = new Playback([{id: 'one', label: 'One', start: 0, end: 2}, {id: 'two', label: 'Two', start: 2, end: 4}], 4);
  const plan = bodyPracticePlan(lesson);
  const session = new PracticeSession(player, plan);
  session.countdownSeconds = 0;
  function Harness() {
    const [, redraw] = React.useState(0);
    React.useEffect(() => {
      let frame = 0;
      const tick = () => { session.tick(0.05); redraw(value => value + 1); frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, []);
    const view = derivePracticeView(session.snapshot, BODY_CAPABILITIES);
    return <div><span data-view>{view.primary.label}</span><PracticePrimaryActions primary={view.primary}
      secondary={view.secondary} onCommand={command => {
        if (command.type === 'action') session.action(command.action);
      }}/></div>;
  }
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 15)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
  const view = render(<Harness/>);
  const primary = () => view.container.querySelector('.practice-player-primary') as HTMLButtonElement;
  await waitFor(() => assert.match(primary().textContent ?? '', /Start practice/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Resume/));
  fireEvent.click(primary());
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  session.action('next');
  await waitFor(() => assert.match(primary().textContent ?? '', /Pause practice/));
  session.tick(2.2);
  await waitFor(() => assert.match(primary().textContent ?? '', /Practise again/));
  assert.equal(view.container.querySelector('[data-view]')?.textContent, 'Practise again');
  view.unmount();
});
