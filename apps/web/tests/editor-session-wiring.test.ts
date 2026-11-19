import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEditorSession} from '../src/editor/editor-session';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('active editors delegate save/conflict/review bookkeeping to the shared session', () => {
  for (const path of ['../src/SectionEditor.tsx', '../src/MoveCheck.tsx',
    '../src/music/workspace/PianoWorkspaceHarness.tsx']) {
    const text = source(path);
    assert.match(text, /createEditorSession/, `${path} creates the shared session`);
    assert.match(text, /\.saved\(|\.reviewed\(|\.conflict\(/, `${path} drives lifecycle events`);
  }
});

test('the shared session carries dirty -> saved -> conflict -> review -> publish', () => {
  const session = createEditorSession({state: 'needs-review', revisionId: 'r0'});
  assert.equal(session.getSnapshot().state, 'needs-review');
  session.beginEdit();
  assert.equal(session.getSnapshot().dirty, true);
  session.saved('r1');
  assert.equal(session.getSnapshot().revisionId, 'r1');
  session.conflict('A newer revision exists.');
  assert.equal(session.getSnapshot().errorCode, 'conflict');
  assert.equal(session.getSnapshot().dirty, true);
  session.reviewed('r1');
  assert.equal(session.getSnapshot().reviewed, true);
  session.readyToRelease();
  assert.equal(session.canPublish(), true);
  session.published('r1');
  assert.equal(session.getSnapshot().releasedRevisionId, 'r1');
  // Publishing the same revision keeps the private state; release is tracked separately.
  assert.equal(session.getSnapshot().state, 'saved-private');
});
