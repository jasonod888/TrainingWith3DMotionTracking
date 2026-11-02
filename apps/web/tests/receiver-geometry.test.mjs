import {test} from 'node:test';
import assert from 'node:assert/strict';
import {containedTransform,mapSourcePoint} from '../src/camera-framing.ts';
import {boxFromOutline,guideBox,marginBands,rectForBox,rectInsideDestination} from '../src/camera-setup-guide.ts';
import {compareLayout} from '../src/receiver-layout.ts';

const SOURCE = {width: 1280, height: 720};

/** The receiver's full-view fit: contain, centred, letterboxed if needed. */
function fit(paneWidth, paneHeight, mirrored = false) {
  return containedTransform(SOURCE.width, SOURCE.height, paneWidth, paneHeight, mirrored);
}

test('the complete camera image is contained, never cropped, at every pane shape', () => {
  const panes = [
    [640, 900],
    [1920, 1080],
    [800, 800],
    [2560, 700],
    [320, 480],
  ];
  for (const [w, h] of panes) {
    const transform = fit(w, h);
    const {destination} = transform;
    const scale = Math.min(w / SOURCE.width, h / SOURCE.height);
    assert.ok(Math.abs(destination.width - SOURCE.width * scale) < 1e-6, `${w}x${h} width`);
    assert.ok(Math.abs(destination.height - SOURCE.height * scale) < 1e-6, `${w}x${h} height`);
    assert.ok(destination.x >= -1e-6 && destination.y >= -1e-6, `${w}x${h} offset`);
    assert.ok(destination.x + destination.width <= w + 1e-6, `${w}x${h} overflow x`);
    assert.ok(destination.y + destination.height <= h + 1e-6, `${w}x${h} overflow y`);
    // Source aspect ratio is preserved exactly: no stretching.
    assert.ok(Math.abs(destination.width / destination.height - SOURCE.width / SOURCE.height) < 1e-6);
    // All four source corners are inside the rendered rectangle.
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const point = mapSourcePoint(transform, {x, y});
      assert.ok(point.x >= destination.x - 1e-6 && point.x <= destination.x + destination.width + 1e-6);
      assert.ok(point.y >= destination.y - 1e-6 && point.y <= destination.y + destination.height + 1e-6);
    }
  }
});

test('letterboxing is symmetric and expected when the pane ratio differs', () => {
  const transform = fit(640, 900);
  const bands = marginBands(transform);
  assert.equal(Math.round(bands.top), Math.round(bands.bottom));
  assert.equal(Math.round(bands.left), 0);
  assert.ok(bands.top + transform.destination.height + bands.bottom === 900);
});

test('mirroring flips the image once, about the centre of the rendered rectangle', () => {
  const plain = fit(800, 450, false);
  const mirrored = fit(800, 450, true);
  const left = mapSourcePoint(plain, {x: 0.1, y: 0.5});
  const right = mapSourcePoint(plain, {x: 0.9, y: 0.5});
  const flipped = mapSourcePoint(mirrored, {x: 0.1, y: 0.5});
  assert.ok(Math.abs(flipped.x - right.x) < 1e-6);
  assert.ok(Math.abs(flipped.y - left.y) < 1e-6);
  // The centre is a fixed point.
  assert.ok(Math.abs(mapSourcePoint(mirrored, {x: 0.5, y: 0.5}).x - 400) < 1e-6);
});

test('the guide reconstructed from source dimensions stays inside the image', () => {
  const box = guideBox({videoWidth: SOURCE.width, videoHeight: SOURCE.height});
  for (const [w, h] of [[640, 900], [1920, 1080], [700, 700], [1080, 1920]]) {
    for (const mirrored of [false, true]) {
      const transform = fit(w, h, mirrored);
      const rect = rectForBox(transform, box);
      assert.ok(rectInsideDestination(transform, rect), `${w}x${h} mirrored=${mirrored}`);
      assert.ok(rect.width > 0 && rect.height > 0);
    }
  }
});

test('an accepted body outline is reproduced exactly in normalised space', () => {
  const outline = {left: 0.2, top: 0.1, right: 0.8, bottom: 0.95};
  const box = boxFromOutline(outline);
  assert.deepEqual(box, outline);
  const transform = fit(1000, 600);
  const rect = rectForBox(transform, box);
  // The guide must scale with the image, not with the pane.
  assert.ok(rect.width < transform.destination.width);
  assert.ok(rectInsideDestination(transform, rect));
});

test('the guide uses the camera pane the comparison layout actually measured', () => {
  for (const viewport of [{width: 1920, height: 1080}, {width: 1080, height: 1920}, {width: 2560, height: 1080}]) {
    const layout = compareLayout(viewport.width, viewport.height);
    const transform = fit(layout.cameraPaneWidth, layout.cameraPaneHeight);
    const rect = rectForBox(transform, guideBox({videoWidth: SOURCE.width, videoHeight: SOURCE.height}));
    assert.ok(rectInsideDestination(transform, rect), `${viewport.width}x${viewport.height}`);
    assert.ok(transform.destination.width <= layout.cameraPaneWidth + 1e-6);
    assert.ok(transform.destination.height <= layout.cameraPaneHeight + 1e-6);
  }
});

test('a zero-sized pane during a transition produces finite geometry', () => {
  for (const [w, h] of [[0, 0], [0, 720], [1280, 0]]) {
    const transform = fit(w, h);
    for (const value of [transform.scale, transform.destination.x, transform.destination.y, transform.destination.width, transform.destination.height]) {
      assert.ok(Number.isFinite(value), `${w}x${h}`);
    }
  }
});
