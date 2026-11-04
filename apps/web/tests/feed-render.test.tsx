import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

// The feed is rendered for real, so labels, rollout gating and retry behaviour are
// checked against the DOM instead of against the helper functions alone.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
const {window} = dom;
globalThis.window = window;
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

const {render, screen, fireEvent, waitFor, cleanup} = await import('@testing-library/react');
const {PracticeFeed} = await import('../src/PracticeFeed.tsx');

afterEach(() => {
  cleanup();
  delete globalThis.fetch;
});

const sha = 'a'.repeat(64);

function body(id, title) {
  return {
    schema_version: 1, lesson_id: id, revision_id: `${id}-rev`, title, duration: 2, source_start: 0,
    standing_time: 0, engine: 'synthetic', engine_version: '1', units: 'metres',
    landmark_axes: 'x-right/y-down/z-forward', root_motion: 'in-place', confidence: 'unmeasured',
    animation: {key: `lessons/${id}/synthetic.glb`, mime: 'model/gltf-binary', bytes: 10, sha256: sha},
    landmarks: {key: `lessons/${id}/landmarks.json`, mime: 'application/json', bytes: 10, sha256: sha},
    source_video: null, thumbnail: null,
    section_set: {id: 'sections', revision: 1, duration: 2, sections: [{id: 'a', label: 'Whole', start: 0, end: 2}]},
    warnings: [],
  };
}

function publicMove(index) {
  return {lesson_id: `public-${index}`, title: `Public ${index}`, creator_name: 'Ari', description: '',
    tags: [], duration: 40 + index, thumbnail_url: null, subject: 'movement_other', subject_label: 'Full Body Movement'};
}

function props(overrides) {
  return {
    filter: 'all', setFilter() {}, active: true, query: '', onQuery() {},
    account: {id: 'tester', email: 'test@example.test', platform_role: 'member', status: 'active', mfa_enrolled: false},
    library: [], shared: [], states: [], sharedSummaries: [], subjectFilterEnabled: false, demo: null, loading: false,
    onOpen() {}, onPublic() {}, onManage() {}, onCreate() {}, onSignIn() {},
    ...overrides,
  };
}

function response(value, status = 200) {
  return {ok: status >= 200 && status < 300, status, json: async () => value};
}

function stubFetch(handler) {
  globalThis.fetch = async (url) => handler(String(url));
}

const subjectFilter = (container: HTMLElement) => container.querySelector('[aria-label="Lesson subjects"]');
const subjectButtons = (container: HTMLElement) => Array.from(
  container.querySelectorAll('[aria-label="Lesson subjects"] button'),
).map(button => button.textContent);

test('the subject filter is hidden from a movement library unless rollout enables it', async () => {
  stubFetch(() => response({moves: []}));
  const {container} = render(<PracticeFeed {...props({
    library: [body('own-1', 'Taegeuk'), body('own-2', 'Dance basics')],
    states: [
      {lesson_id: 'own-1', subject: 'movement_other', subject_label: 'Full Body Movement'},
      {lesson_id: 'own-2', subject: 'dance', subject_label: 'Dance'},
    ],
  })}/>);
  assert.equal(subjectFilter(container), null);
  assert.deepEqual(subjectButtons(container), []);
});

test('the subject filter appears when rollout enables it', async () => {
  stubFetch(() => response({moves: []}));
  const {container} = render(<PracticeFeed {...props({
    library: [body('own-1', 'Taegeuk'), body('own-2', 'Dance basics')],
    states: [
      {lesson_id: 'own-1', subject: 'movement_other', subject_label: 'Full Body Movement'},
      {lesson_id: 'own-2', subject: 'dance', subject_label: 'Dance'},
    ],
    subjectFilterEnabled: true,
  })}/>);
  assert.ok(subjectFilter(container));
  assert.deepEqual(subjectButtons(container), ['All subjects', 'Full Body Movement', 'Dance']);
});

test('a shared card labels itself from the released summary, not our workflow state', async () => {
  stubFetch(() => response({moves: []}));
  const {container} = render(<PracticeFeed {...props({
    shared: [body('shared-1', 'Shared dance')],
    // The owner states are about our own lessons; a shared lesson is absent from them.
    states: [{lesson_id: 'shared-1', subject: 'movement_other', subject_label: 'Full Body Movement'}],
    sharedSummaries: [{lesson_id: 'shared-1', subject: 'dance', subject_label: 'Dance'}],
  })}/>);
  await waitFor(() => assert.ok(container.querySelector('.feed-card-shared')));
  assert.match(container.textContent, /Dance · 1 section/);
  assert.doesNotMatch(container.textContent, /Full Body Movement · 1 section/);
});

test('retry after a first-page failure loads the feed', async () => {
  // While failing, every request fails, so a stray request from another mounted feed
  // cannot consume the success that the retry needs.
  let failing = true;
  stubFetch(() => failing
    ? response({detail: 'Public unavailable'}, 503)
    : response({moves: [publicMove(1)]}));
  render(<PracticeFeed {...props()}/>);
  const retry = await screen.findByRole('button', {name: 'Try again'}, {timeout: 3000});
  failing = false;
  fireEvent.click(retry);
  await screen.findByRole('button', {name: 'Open Public 1'}, {timeout: 3000});
});

test('retry after a pagination failure resumes the same page instead of resetting', async () => {
  const firstPage = Array.from({length: 24}, (_, index) => publicMove(index));
  let moreCalls = 0;
  stubFetch((url) => {
    if (url.includes('offset=24')) {
      moreCalls += 1;
      return moreCalls === 1
        ? response({detail: 'More unavailable'}, 503)
        : response({moves: [publicMove(24), publicMove(25)]});
    }
    return response({moves: firstPage});
  });
  const {container} = render(<PracticeFeed {...props()}/>);
  await waitFor(() => assert.equal(container.querySelectorAll('.feed-card-public').length, 24));

  fireEvent.click(screen.getByRole('button', {name: /More practices/}));
  await screen.findByText('More practices could not load.');
  fireEvent.click(screen.getByRole('button', {name: 'Try again'}));

  await waitFor(() => assert.equal(container.querySelectorAll('.feed-card-public').length, 26));
  assert.equal(moreCalls, 2);
});
