import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  RECEIVER_LAYOUT_DEFAULTS,compareLayout,setupHeadline,setupHintCopy,setupPresentation,setupProgress,
} from '../src/receiver-layout.ts';

const VIEWPORTS = [
  {name: '16:9 television', width: 1920, height: 1080},
  {name: '16:10 monitor', width: 1600, height: 1000},
  {name: '4:3 display', width: 1024, height: 768},
  {name: '21:9 ultrawide', width: 2560, height: 1080},
  {name: 'portrait phone', width: 1080, height: 1920},
  {name: 'portrait tablet', width: 900, height: 1600},
  {name: 'square window', width: 900, height: 900},
];

test('the viewport matrix never overflows and never collapses a pane', () => {
  for (const viewport of VIEWPORTS) {
    const layout = compareLayout(viewport.width, viewport.height);
    assert.equal(layout.usable, true, viewport.name);
    const cameraEdge = layout.axis === 'columns' ? layout.cameraPaneWidth : layout.cameraPaneHeight;
    const instructorEdge = layout.axis === 'columns' ? viewport.width - layout.cameraPaneWidth : viewport.height - layout.cameraPaneHeight;
    const total = layout.axis === 'columns' ? viewport.width : viewport.height;
    assert.equal(Math.round(cameraEdge + instructorEdge), total, viewport.name);
    assert.ok(cameraEdge > 0 && instructorEdge > 0, `${viewport.name} has an empty pane`);
    assert.ok(Math.abs(cameraEdge / total - layout.cameraShare) < 1e-9, `${viewport.name} share mismatch`);
  }
});

test('landscape splits into columns and portrait stacks into rows at the tunable ratio', () => {
  assert.equal(compareLayout(1920, 1080).axis, 'columns');
  assert.equal(compareLayout(1600, 1000).axis, 'columns');
  assert.equal(compareLayout(1024, 768).axis, 'columns');
  assert.equal(compareLayout(2560, 1080).axis, 'columns');
  assert.equal(compareLayout(1080, 1920).axis, 'rows');
  assert.equal(compareLayout(900, 1600).axis, 'rows');
  // Exactly at the threshold is landscape; just below it stacks.
  assert.equal(compareLayout(RECEIVER_LAYOUT_DEFAULTS.landscapeRatio * 1000, 1000).axis, 'columns');
  assert.equal(compareLayout(RECEIVER_LAYOUT_DEFAULTS.landscapeRatio * 1000 - 1, 1000).axis, 'rows');
});

test('the camera keeps the larger share in landscape without squeezing the instructor', () => {
  const layout = compareLayout(1920, 1080);
  assert.ok(layout.cameraShare > 0.5);
  assert.ok(layout.cameraShare < 0.75);
  assert.ok(layout.instructorShare >= 0.3);
  assert.equal(layout.cameraShare + layout.instructorShare, 1);
});

test('shares are clamped so a pane never falls below the legibility floor', () => {
  const narrow = compareLayout(1000, 400);
  assert.ok(narrow.cameraPaneWidth >= RECEIVER_LAYOUT_DEFAULTS.minPanePx);
  assert.ok(narrow.cameraPaneWidth <= 1000 - RECEIVER_LAYOUT_DEFAULTS.minPanePx);
  const tiny = compareLayout(240, 240);
  assert.equal(tiny.cameraShare, 0.5);
  assert.equal(tiny.axis, 'rows');
});

test('a container that is not laid out yet yields a safe, non-finite-free layout', () => {
  for (const layout of [compareLayout(0, 0), compareLayout(Number.NaN, 720), compareLayout(-40, 100)]) {
    assert.equal(layout.usable, false);
    assert.ok(Number.isFinite(layout.cameraShare));
    assert.ok(layout.cameraShare >= 0 && layout.cameraShare <= 1);
  }
});

test('setup hands the main area to the camera and gives the instructor back before the countdown', () => {
  for (const phase of ['prepare', 'starting', 'positioning', 'measuring', 'help', 'error']) {
    assert.equal(setupPresentation(phase), 'takeover', phase);
    const layout = compareLayout(1920, 1080, {takeover: true});
    assert.equal(layout.cameraShare, 1);
    assert.equal(layout.instructorShare, 0);
    assert.equal(layout.cameraPaneWidth, 1920);
    assert.equal(layout.cameraPaneHeight, 1080);
  }
  for (const phase of ['ready', 'handoff']) assert.equal(setupPresentation(phase), 'compare', phase);
  for (const phase of [null, undefined, '', 'cancelled']) assert.equal(setupPresentation(phase), 'idle', String(phase));
});

test('takeover layout still stacks correctly in portrait', () => {
  const layout = compareLayout(1080, 1920, {takeover: true});
  assert.equal(layout.axis, 'rows');
  assert.equal(layout.cameraPaneHeight, 1920);
  assert.equal(layout.cameraShare, 1);
});

test('setup copy is bounded, readable and never invents a state', () => {
  assert.equal(setupHintCopy('person_missing'), 'Stand in front of the camera.');
  assert.match(setupHintCopy('feet_missing'), /both feet/);
  assert.equal(setupHintCopy(''), '');
  assert.equal(setupHintCopy(null), '');
  assert.equal(setupHintCopy('a_state_from_the_future'), 'Hold your position…');
});

test('progress is only reported while it is being measured, and stays finite', () => {
  assert.equal(setupProgress('measuring', 0.42), 0.42);
  assert.equal(setupProgress('ready', 1.2), 1);
  assert.equal(setupProgress('measuring', -1), 0);
  assert.equal(setupProgress('measuring', Number.NaN), 0);
  assert.equal(setupProgress('positioning', 0.9), 0);
  assert.equal(setupProgress(null, 0.9), 0);
});

test('every setup stage has a headline', () => {
  for (const phase of ['prepare', 'starting', 'positioning', 'measuring', 'ready', 'handoff', 'help', 'error']) {
    assert.ok(setupHeadline(phase).length > 0, phase);
  }
  assert.equal(setupHeadline(null), '');
});
