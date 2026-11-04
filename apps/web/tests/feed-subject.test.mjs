import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  availableSubjects, matchesSubject, publicMovesPath, publicPageKey, resolveSubject, subjectFor,
} from '../src/feed-subject.ts';

const movement = (id, label = 'Full Body Movement') => ({lesson_id: id, subject: 'movement_other', subject_label: label});
const dance = (id) => ({lesson_id: id, subject: 'dance', subject_label: 'Dance'});

test('a movement-only account has a dormant filter', () => {
  const options = availableSubjects([movement('a'), movement('b')], []);
  assert.equal(options.length, 1);
  assert.equal(resolveSubject('all', options), 'all');
  // Even a stale selection cannot filter when the control is hidden.
  assert.equal(resolveSubject('dance', options), 'all');
});

test('a recipient-only subject is offered without an owned lesson', () => {
  const options = availableSubjects([movement('own')], [dance('shared')]);
  assert.deepEqual(options.map(option => option.id), ['movement_other', 'dance']);
  assert.equal(resolveSubject('dance', options), 'dance');
});

test('deleting or relabelling the selected subject falls back to all', () => {
  const before = availableSubjects([movement('a'), dance('b')], []);
  assert.equal(resolveSubject('dance', before), 'dance');
  const after = availableSubjects([movement('a')], []);
  assert.equal(resolveSubject('dance', after), 'all');
});

test('shared lessons use the shared summary metadata, not the workflow states', () => {
  const states = [movement('shared-lesson')];
  const summaries = [dance('shared-lesson')];
  assert.equal(subjectFor(states, 'shared-lesson'), 'movement_other');
  assert.equal(subjectFor(summaries, 'shared-lesson'), 'dance');
  assert.equal(subjectFor(summaries, 'unknown-lesson'), 'movement_other');
});

test('the public request carries the subject to the server before pagination', () => {
  assert.equal(publicMovesPath('', 'all', 0), '/public/moves');
  assert.equal(publicMovesPath('', 'dance', 0), '/public/moves?subject=dance');
  assert.equal(publicMovesPath('twist', 'dance', 24), '/public/moves?q=twist&subject=dance&offset=24');
});

test('switching subject changes the page identity so a stale response cannot win', () => {
  const first = publicPageKey('', 'dance', 0);
  const second = publicPageKey('', 'movement_other', 0);
  assert.notEqual(first, second);
  assert.notEqual(publicPageKey('', 'dance', 0), publicPageKey('', 'dance', 24));
});

test('matching honours the resolved filter only', () => {
  assert.equal(matchesSubject(undefined, 'all'), true);
  assert.equal(matchesSubject(undefined, 'dance'), false);
  assert.equal(matchesSubject('dance', 'dance'), true);
  assert.equal(matchesSubject('movement_other', 'dance'), false);
});
