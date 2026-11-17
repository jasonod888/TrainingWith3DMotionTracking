/**
 * Phase 2 contextual editing: note editor lifecycle, keyboard pitch choice, the
 * Review and save gate, Add menu and Settings/More surfaces.
 */
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {
  closeHarness, fireEvent, open, openMore, openSettings, PianoWorkspaceHarness, render, total, waitFor,
} from './workspace-journeys-setup';

after(closeHarness);

const drawer = (view: ReturnType<typeof render>) =>
  view.container.querySelector('[data-settings-drawer]') as HTMLElement;
const notePanel = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.ws-note-section') as HTMLElement;

test('selecting a note opens the compact contextual editor and closing does not clear selection', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 1, button: 0});
  fireEvent.pointerUp(note, {pointerId: 1});
  await waitFor(() => assert.equal(drawer(view).hasAttribute('hidden'), false));
  assert.equal(drawer(view).getAttribute('data-mode'), 'note');
  const panel = notePanel(view);
  assert.ok([...panel.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Preview'));
  assert.ok([...panel.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Choose on keyboard'));
  assert.ok([...panel.querySelectorAll('button')].some(button => button.textContent?.trim() === '− semitone'));
  assert.ok([...panel.querySelectorAll('button')].some(button => button.textContent?.trim() === '+ semitone'));
  assert.ok([...panel.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Quarter'));
  assert.ok(panel.querySelector('.ws-field input[type="range"]'), 'loudness slider is present');
  assert.ok(view.getByRole('button', {name: 'Play', exact: true}), 'dock stays available');
  const occurrence = note.getAttribute('data-occurrence');
  const before = note.getAttribute('data-pitch');
  fireEvent.click(view.getByRole('button', {name: '+ semitone'}));
  await waitFor(() => assert.notEqual(
    view.container.querySelector(`.ws-roll-note[data-occurrence="${occurrence}"]`)?.getAttribute('data-pitch'), before));
  const committed = view.container.querySelector(`.ws-roll-note[data-occurrence="${occurrence}"]`)?.getAttribute('data-pitch');
  view.container.querySelector<HTMLButtonElement>('[data-settings-drawer] [aria-label="Close note editor"]')!.click();
  await waitFor(() => assert.equal(drawer(view).hasAttribute('hidden'), true));
  assert.ok(globalThis.document.activeElement === note, 'focus returns to the selected note');
  assert.equal(view.container.querySelector(`.ws-roll-note[data-occurrence="${occurrence}"]`)?.getAttribute('data-pitch'), committed,
    'closing the editor does not undo the committed edit');
  assert.ok(view.container.querySelector('.ws-roll-note.is-selected'), 'selection is preserved when the editor closes');
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 2, button: 0});
  fireEvent.pointerUp(note, {pointerId: 2});
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-mode'), 'note'));
});

test('desktop also starts with the simple layer; advanced timing is opt-in', async () => {
  const view = await open();
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 3, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 3});
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-note-expanded'), 'false'));
  assert.equal(drawer(view).getAttribute('data-note-advanced'), 'false');
  assert.ok(view.queryByLabelText('Recorded length (s)') === null, 'advanced timing is not shown by default');
  assert.ok(view.getByRole('button', {name: 'Choose on keyboard'}));
  assert.ok(view.getByLabelText(/Loudness/));
  assert.ok(view.queryByRole('button', {name: 'Replace pitch'}) === null,
    'legacy replace belongs to additional options');
  assert.ok(view.queryByRole('button', {name: '♯'}) === null,
    'spelling controls belong to additional options');
  assert.equal(drawer(view).querySelectorAll('[aria-label="Close note editor"]').length, 1,
    'the note surface has one visible close control');
  view.getByRole('button', {name: /Timing & more/}).click();
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-note-advanced'), 'true'));
  assert.equal(drawer(view).getAttribute('data-note-expanded'), 'false', 'desktop stays a simple drawer');
  assert.ok(view.getByLabelText('Recorded length (s)'));
  assert.ok(view.getByRole('button', {name: 'Replace pitch'}));
  assert.ok(view.getByRole('button', {name: '♯'}));
  view.getByRole('button', {name: 'Less timing'}).click();
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-note-advanced'), 'false'));
  assert.ok(view.queryByLabelText('Recorded length (s)') === null);
});

test('Choose on keyboard changes the selected pitch only in explicit mode and Escape cancels', async () => {
  const view = await open();
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!, {clientX: 100, clientY: 100, pointerId: 4, button: 0});
  fireEvent.pointerUp(view.container.querySelector('.ws-roll-note')!, {pointerId: 4});
  const pitchOf = (id: string) => view.container.querySelector(`.ws-roll-note[data-occurrence="${id}"]`)?.getAttribute('data-pitch');
  const selection = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot().selection;
  const id = selection.occurrenceId as string;
  const before = pitchOf(id);
  fireEvent.click(view.getByRole('button', {name: /Timing & more/}));
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-note-advanced'), 'true'));
  const choose = view.getByRole('button', {name: 'Choose on keyboard'});
  fireEvent.click(choose);
  await waitFor(() => assert.ok(view.container.querySelector('[data-pitch-pick-active="true"]')));
  assert.equal(drawer(view).getAttribute('data-mode'), 'note');
  assert.equal(drawer(view).getAttribute('data-suppressed'), 'true',
    'the editor is temporarily hidden so the keyboard is physically usable');
  assert.ok(view.getByRole('button', {name: 'Previous keyboard range'})
    .closest('[data-settings-drawer]') === null, 'range controls are outside the hidden editor');
  assert.ok(view.getByRole('button', {name: 'Next keyboard range'})
    .closest('[data-settings-drawer]') === null, 'both range controls are exposed');
  const target = Number(before) + 2;
  const key = view.container.querySelector(`.keyboard-white[data-pitch="${target}"], .keyboard-black[data-pitch="${target}"]`) as SVGRectElement;
  assert.ok(key, `keyboard key ${target} is missing`);
  fireEvent.click(key);
  await waitFor(() => assert.equal(pitchOf(id), String(target)));
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-suppressed'), 'false'));
  assert.equal(drawer(view).getAttribute('data-mode'), 'note', 'the contextual editor is restored after commit');
  assert.equal(drawer(view).getAttribute('data-note-advanced'), 'true', 'previous advanced state is preserved');

  fireEvent.click(view.getByRole('button', {name: 'Choose on keyboard'}));
  await waitFor(() => assert.ok(view.container.querySelector('[data-pitch-pick-active="true"]')));
  assert.equal(drawer(view).getAttribute('data-suppressed'), 'true');
  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.ok(view.container.querySelector('[data-pitch-pick-active="true"]') === null));
  assert.equal(pitchOf(id), String(target), 'cancelled pitch choice must not edit');
  assert.equal(drawer(view).getAttribute('data-suppressed'), 'false', 'Escape restores the editor');
  assert.equal(drawer(view).getAttribute('data-mode'), 'note', 'the note editor stays open after mode cancellation');
  assert.equal(drawer(view).getAttribute('data-note-advanced'), 'true', 'Escape preserves the advanced state');
  assert.equal(drawer(view).hasAttribute('hidden'), false, 'the note editor stays open after mode cancellation');

  fireEvent.click(view.getByRole('button', {name: 'Choose on keyboard'}));
  await waitFor(() => assert.ok(view.container.querySelector('[data-pitch-pick-active="true"]')));
  fireEvent.click(view.container.querySelector('[data-pitch-pick-active="true"] button')!);
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-suppressed'), 'false'));
  assert.equal(pitchOf(id), String(target), 'banner Cancel must not edit');
  assert.equal(drawer(view).getAttribute('data-mode'), 'note');

  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.equal(drawer(view).hasAttribute('hidden'), true),
    'a subsequent Escape closes the note editor');
});

test('manual hand assignment, auto reset and shared waterfall colour', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const occurrence = note.getAttribute('data-occurrence')!;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 40, button: 0});
  fireEvent.pointerUp(note, {pointerId: 40});
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-mode'), 'note'));
  assert.ok(view.container.querySelector('[data-hand-assignment="true"]'));
  let snapshot = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  assert.equal(snapshot.dirty, false, 'derived hand estimates do not dirty the lesson');
  assert.equal(snapshot.document.hand_assignments, undefined);
  fireEvent.click(view.container.querySelector('[data-hand-choice="left"]')!);
  await waitFor(() => assert.equal(
    view.container.querySelector('[data-hand-assignment="true"]')?.getAttribute('data-hand-current'), 'left'));
  snapshot = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  assert.equal(snapshot.document.hand_assignments?.[occurrence]?.manual, true);
  assert.equal(snapshot.document.hand_assignments?.[occurrence]?.hand, 'left');
  const block = view.container.querySelector(`.ws-waterfall-note[data-occurrence="${occurrence}"]`);
  assert.ok(block?.classList.contains('hand-left'), 'waterfall uses the same manual hand');
  assert.equal(block?.getAttribute('data-hand'), 'left');

  fireEvent.click(view.container.querySelector('[data-hand-reset="true"]')!);
  await waitFor(() => assert.ok(
    view.container.querySelector('[data-hand-assignment="true"]')?.getAttribute('data-hand-current')));
  snapshot = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  assert.equal(snapshot.document.hand_assignments?.[occurrence], undefined,
    'Auto removes the manual override');

  fireEvent.click(view.container.querySelector('[data-hand-choice="unassigned"]')!);
  await waitFor(() => assert.equal(
    view.container.querySelector('[data-hand-assignment="true"]')?.getAttribute('data-hand-current'), 'unassigned'));
  snapshot = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  assert.equal(snapshot.document.hand_assignments?.[occurrence]?.hand, 'unassigned');
  assert.equal(snapshot.document.hand_assignments?.[occurrence]?.manual, true,
    'manual unknown is an explicit lock');
  fireEvent.click(view.container.querySelector('[data-hand-reset="true"]')!);
  await waitFor(() => assert.ok(
    view.container.querySelector('[data-hand-assignment="true"]')?.getAttribute('data-hand-current')));
  snapshot = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  assert.equal(snapshot.document.hand_assignments?.[occurrence], undefined);

  view.getByRole('button', {name: 'Settings'}).click();
  await waitFor(() => assert.ok(view.container.querySelector('[data-hands-legend="true"]')));
  assert.ok(view.container.querySelector('[data-hands-status="baseline"]'));
  assert.ok(view.container.querySelector('[data-hands-inline-legend="true"]'));
  assert.ok(view.container.querySelector('[data-hands-reliability="true"]'));
});

test('Note Editor Preview uses the selected occurrence velocity', async () => {
  const view = await open();
  const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
  const occurrence = note.getAttribute('data-occurrence')!;
  fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 41, button: 0});
  fireEvent.pointerUp(note, {pointerId: 41});
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-mode'), 'note'));
  const snapshot = (globalThis as unknown as {__pianoWorkspaceSnapshot: () => any}).__pianoWorkspaceSnapshot();
  const velocity = snapshot.document.performance.find((item: any) => item.id === occurrence).velocity;
  const {NotationAudio} = await import('../src/music/notation/notation-audio.ts');
  const calls: {seconds: number | undefined; velocity: number | null | undefined}[] = [];
  const original = NotationAudio.prototype.play;
  NotationAudio.prototype.play = function (_pitches: number[], seconds?: number,
    previewVelocity?: number | null) {
    calls.push({seconds, velocity: previewVelocity});
  };
  try {
    fireEvent.click(view.getAllByRole('button', {name: 'Preview', exact: true})[0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].velocity, velocity);
  } finally {
    NotationAudio.prototype.play = original;
  }
});

test('Review and save opens from the header, gates on confirmation and restores focus', async () => {
  const view = await open();
  const trigger = view.container.querySelector('[data-review-save]') as HTMLButtonElement;
  assert.equal(trigger.disabled, false, 'header Save must open review rather than be blocked by a hidden checkbox');
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() => assert.ok(view.queryByRole('dialog', {name: 'Review and save'}) !== null,
    'the review dialog opens'));
  assert.equal((view.container.querySelector('[data-save-button]') as HTMLButtonElement).disabled, true);
  fireEvent.click(view.getByLabelText('Confirm reviewed'));
  await waitFor(() => assert.equal((view.container.querySelector('[data-save-button]') as HTMLButtonElement).disabled, false));
  fireEvent.keyDown(window, {key: 'Escape'});
  await waitFor(() => assert.ok(view.queryByRole('dialog', {name: 'Review and save'}) === null,
    'the review dialog is closed'));
  assert.ok(globalThis.document.activeElement === trigger, 'focus returns to the header Save action');
});

test('Add note is discoverable outside Settings and adds at the playhead', async () => {
  const view = await open();
  const start = total(view);
  fireEvent.click(view.container.querySelector('[data-add-menu-toggle]')!);
  await waitFor(() => assert.ok(view.queryByRole('dialog', {name: 'Add note options'}) !== null,
    'the Add note menu opens'));
  fireEvent.click(view.getByRole('button', {name: 'Insert at playhead'}));
  await waitFor(() => assert.equal(total(view), start + 1));
  assert.ok(view.queryByRole('dialog', {name: 'Add note options'}) === null,
    'the Add note menu closes after inserting');
});

test('mobile note sheet starts compact and expands explicitly', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({matches: query.includes('max-width: 760px'), media: query,
    onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false});
  try {
    window.history.replaceState(null, '', '/workspace-harness.html?demo=frames');
    const view = render(<PianoWorkspaceHarness/>);
    await waitFor(() => assert.ok(view.container.querySelector('.ws-roll-note')));
    await waitFor(() => assert.ok(view.container.querySelector('[data-mobile-actions]')));
    const note = view.container.querySelector('.ws-roll-note') as SVGRectElement;
    note.getBoundingClientRect = () => ({top: 500, bottom: 510, left: 100, right: 120,
      width: 20, height: 10, x: 100, y: 500, toJSON: () => ({})});
    fireEvent.pointerDown(note, {clientX: 100, clientY: 100, pointerId: 8, button: 0});
    fireEvent.pointerUp(note, {pointerId: 8});
    await waitFor(() => assert.equal(drawer(view).getAttribute('data-mode'), 'note'));
    assert.equal(drawer(view).getAttribute('data-note-expanded'), 'false');
    assert.equal(drawer(view).getAttribute('data-peek-position'), 'bottom',
      'a low bass note keeps the compact peek below it when that leaves the note clear');
    assert.ok(view.container.querySelector('.ws-note-primary') === null, 'the compact peek is not the full form');
    assert.ok(view.container.querySelector('.ws-note-secondary') === null);
    assert.ok(view.getByRole('button', {name: 'Edit note'}), 'the peek has an explicit expand control');
    fireEvent.click(view.getByRole('button', {name: 'Edit note'}));
    await waitFor(() => assert.equal(drawer(view).getAttribute('data-note-expanded'), 'true'));
    assert.equal(drawer(view).getAttribute('data-note-advanced'), 'false',
      'Edit note opens the simple layer only');
    assert.ok(view.container.querySelector('.ws-note-primary'));
    assert.ok(view.container.querySelector('.ws-note-secondary') === null);
    fireEvent.click(view.getByRole('button', {name: /Timing & more/}));
    await waitFor(() => assert.equal(drawer(view).getAttribute('data-note-advanced'), 'true'));
    assert.ok(view.container.querySelector('.ws-note-secondary'));
    assert.ok(view.getByRole('button', {name: 'Play', exact: true}), 'dock remains available on the compact sheet');
  } finally {
    window.matchMedia = original;
  }
});

test('mobile peek follows the clicked score bass while the roll is open', async () => {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({matches: query.includes('max-width: 760px'), media: query,
    onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false});
  try {
    const view = await open();
    await waitFor(() => assert.ok(view.container.querySelector('[data-mobile-actions]')));
    const scoreNote = [...view.container.querySelectorAll<SVGEllipseElement>('.ws-score-notehead[data-occurrence]')]
      .find(element => Boolean(element.getAttribute('data-occurrence')))!;
    const id = scoreNote.getAttribute('data-occurrence')!;
    const rollNote = [...view.container.querySelectorAll<SVGRectElement>('.ws-roll-note[data-occurrence]')]
      .find(element => element.getAttribute('data-occurrence') === id)!;
    scoreNote.getBoundingClientRect = () => ({top: 600, bottom: 610, left: 100, right: 120,
      width: 20, height: 10, x: 100, y: 600, toJSON: () => ({})});
    rollNote.getBoundingClientRect = () => ({top: 300, bottom: 310, left: 100, right: 120,
      width: 20, height: 10, x: 100, y: 300, toJSON: () => ({})});
    fireEvent.pointerDown(scoreNote, {clientX: 100, clientY: 600, pointerId: 12, button: 0});
    fireEvent.pointerUp(scoreNote, {clientX: 100, clientY: 600, pointerId: 12});
    await waitFor(() => assert.equal(drawer(view).getAttribute('data-mode'), 'note'));
    assert.equal(drawer(view).getAttribute('data-peek-position'), 'top',
      'the peek must protect the score glyph that was clicked, not the roll note');
    assert.ok(view.container.querySelector('.ws-note-primary') === null, 'the compact simple peek remains');
    assert.equal((globalThis as any).__pianoWorkspaceSnapshot().selection.occurrenceId, id);
  } finally {
    window.matchMedia = original;
  }
});

test('Settings and More expose named sections and the formatted preview lives in More', async () => {
  const view = await open();
  openSettings(view);
  const tabs = [...view.container.querySelectorAll('.ws-drawer-tabs button')].map(button => button.textContent?.trim());
  for (const name of ['Playback & view', 'Editing', 'Lesson', 'Advanced timing', 'More']) {
    assert.ok(tabs.includes(name), `settings tab ${name} is missing`);
  }
  const editing = [...view.container.querySelectorAll<HTMLButtonElement>('.ws-drawer-tabs button')]
    .find(button => button.textContent?.trim() === 'Editing')!;
  fireEvent.click(editing);
  assert.equal(drawer(view).getAttribute('data-settings-tab'), 'editing');
  assert.equal(editing.getAttribute('aria-pressed'), 'true', 'the active settings group is exposed');
  openMore(view);
  await waitFor(() => assert.equal(drawer(view).getAttribute('data-mode'), 'more'));
  assert.ok(view.container.querySelector('[data-formatted-toggle]'));
  assert.ok(view.getByRole('button', {name: 'Reopen saved'}));
  assert.ok(view.getByRole('button', {name: 'MusicXML'}));
  assert.ok(view.getByRole('button', {name: 'Download reference'}));
});
