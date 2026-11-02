import {test} from 'node:test';
import assert from 'node:assert/strict';
import {containedTransform} from '../src/camera-framing.ts';
import {
  GUIDE_DEFAULTS,
  guideBox,
  guideRegions,
  rectForBox,
  rectInsideDestination,
  marginBands,
  boxFromOutline,
  pointInBox,
} from '../src/camera-setup-guide.ts';

const LANDSCAPE = {videoWidth: 1280, videoHeight: 720};
const PORTRAIT_SOURCE = {videoWidth: 720, videoHeight: 1280};
const PHONE = {width: 390, height: 844};
const DESKTOP = {width: 1280, height: 800};

test('the guide sits inside the visible video for a landscape source in a portrait pane', () => {
  const transform = containedTransform(LANDSCAPE.videoWidth, LANDSCAPE.videoHeight, PHONE.width, PHONE.height, false);
  const box = guideBox(LANDSCAPE);
  const rect = rectForBox(transform, box);
  assert.ok(rectInsideDestination(transform, rect), 'guide must stay inside the video, not the letterbox');
  // 70% of the source height, scaled by the contained fit.
  assert.ok(Math.abs(rect.height - 0.7 * transform.destination.height) < 0.5, `${rect.height}`);
  // Horizontally centred on the video, not the viewport.
  assert.ok(Math.abs(rect.x + rect.width / 2 - (transform.destination.x + transform.destination.width / 2)) < 0.5);
});

test('a landscape source in a portrait pane leaves usable bands for instructions', () => {
  const transform = containedTransform(LANDSCAPE.videoWidth, LANDSCAPE.videoHeight, PHONE.width, PHONE.height, false);
  const bands = marginBands(transform);
  assert.ok(bands.top > 100, `top band was ${bands.top}`);
  assert.ok(bands.bottom > 100, `bottom band was ${bands.bottom}`);
  assert.equal(bands.left, 0);
  // The instruction band is real estate the video does not use, so the layout
  // can put copy there without cropping the image.
  assert.ok(bands.top + transform.destination.height + bands.bottom === PHONE.height);
});

test('the guide adapts to source aspect without being clipped', () => {
  for (const source of [
    {videoWidth: 1920, videoHeight: 1080},
    {videoWidth: 1080, videoHeight: 1920},
    {videoWidth: 640, videoHeight: 480},
    {videoWidth: 2560, videoHeight: 720},
    {videoWidth: 480, videoHeight: 640},
  ]) {
    const pane = source.videoWidth > source.videoHeight ? PHONE : DESKTOP;
    const transform = containedTransform(source.videoWidth, source.videoHeight, pane.width, pane.height, false);
    for (const centreX of [0.3, 0.5, 0.7]) {
      const box = guideBox({...source, centreX});
      assert.ok(box.left >= 0 && box.right <= 1 && box.top >= 0 && box.bottom <= 1, JSON.stringify(box));
      const rect = rectForBox(transform, box);
      assert.ok(rectInsideDestination(transform, rect), `${JSON.stringify(source)} ${centreX}`);
    }
  }
});

test('the figure keeps its own proportions as the source aspect changes', () => {
  const wide = guideBox({videoWidth: 1920, videoHeight: 1080});
  const tall = guideBox({videoWidth: 1080, videoHeight: 1920});
  const aspectOf = box => ((box.right - box.left) * 1920) / ((box.bottom - box.top) * 1080);
  // Convert back to pixels using each source's own dimensions.
  const wideAspect = ((wide.right - wide.left) * 1920) / ((wide.bottom - wide.top) * 1080);
  const tallAspect = ((tall.right - tall.left) * 1080) / ((tall.bottom - tall.top) * 1920);
  assert.ok(Math.abs(wideAspect - GUIDE_DEFAULTS.silhouetteAspect) < 1e-9, `${wideAspect}`);
  assert.ok(Math.abs(tallAspect - GUIDE_DEFAULTS.silhouetteAspect) < 1e-9, `${tallAspect}`);
  assert.ok(Math.abs(aspectOf(wide) - wideAspect) < 1e-9);
});

test('mirroring flips the mapping but not the guide rectangle', () => {
  const plain = containedTransform(1280, 720, 390, 844, false);
  const mirrored = containedTransform(1280, 720, 390, 844, true);
  const box = guideBox({...LANDSCAPE, centreX: 0.5});
  const a = rectForBox(plain, box);
  const b = rectForBox(mirrored, box);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.width - b.width) < 1e-9);
  // A point off-centre does move, and stays inside the rectangle.
  const left = pointInBox(plain, box, 0.1, 0.5);
  const mirroredLeft = pointInBox(mirrored, box, 0.1, 0.5);
  assert.ok(left.x < a.x + a.width / 2);
  assert.ok(mirroredLeft.x > a.x + a.width / 2);
  for (const point of [left, mirroredLeft]) {
    assert.ok(point.x >= a.x - 1e-6 && point.x <= a.x + a.width + 1e-6);
  }
});

test('region anchors follow the drawn figure and stay inside the guide', () => {
  const transform = containedTransform(1280, 720, 390, 844, true);
  const box = guideBox(LANDSCAPE);
  const rect = rectForBox(transform, box);
  const regions = guideRegions(transform, box);
  const inside = point =>
    point.x >= rect.x - 1e-6 && point.x <= rect.x + rect.width + 1e-6 && point.y >= rect.y - 1e-6 && point.y <= rect.y + rect.height + 1e-6;
  for (const point of [regions.head, ...regions.hands, ...regions.feet]) assert.ok(inside(point), JSON.stringify(point));
  // Head is above the feet, on any source.
  assert.ok(regions.head.y < regions.feet[0].y);
  assert.ok(regions.hands[0].y > regions.head.y && regions.hands[0].y < regions.feet[0].y);
});

test('accepted body bounds become a frozen guide box without owning measurement', () => {
  const outline = boxFromOutline({left: 0.62, right: 0.31, top: 0.12, bottom: 0.88});
  assert.deepEqual(outline, {left: 0.31, right: 0.62, top: 0.12, bottom: 0.88});
  const transform = containedTransform(1280, 720, 390, 844, false);
  const rect = rectForBox(transform, outline);
  assert.ok(rectInsideDestination(transform, rect));
});

test('degenerate transforms do not produce NaN geometry', () => {
  const zero = containedTransform(0, 0, 0, 0, false);
  const rect = rectForBox(zero, guideBox(LANDSCAPE));
  for (const value of [rect.x, rect.y, rect.width, rect.height]) assert.ok(Number.isFinite(value));
  const box = guideBox({videoWidth: 0, videoHeight: 0});
  for (const value of [box.left, box.top, box.right, box.bottom]) assert.ok(Number.isFinite(value));
});

test('landscape phone: the guide keeps clear of the compact chrome', () => {
  // A landscape source fills the short viewport, so there are no top/bottom
  // bands to put copy in. The compact landscape layout therefore has to stay
  // inside the free strips above and below the 70% figure.
  const source = {videoWidth: 1280, videoHeight: 720};
  for (const height of [320, 360, 390, 430]) {
    const width = Math.round(height * 2.17);
    const transform = containedTransform(source.videoWidth, source.videoHeight, width, height, false);
    const bands = marginBands(transform);
    assert.equal(bands.top, 0, `${height}px: this is the tight case, the video uses the full height`);
    const box = guideBox(source);
    const rect = rectForBox(transform, box);
    const regions = guideRegions(transform, box);
    assert.ok(rectInsideDestination(transform, rect));
    assert.ok(regions.head.y >= 48, `${height}px: head at ${regions.head.y} would sit under the top bar`);
    assert.ok(regions.feet[0].y <= height - 52, `${height}px: feet at ${regions.feet[0].y} would sit under the bottom bar`);
  }
});
