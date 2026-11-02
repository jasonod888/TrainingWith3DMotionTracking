// Source-space guide geometry for guided camera setup.
//
// One coordinate system: the original, unmirrored video frame. The guide is
// described as a normalised box in that space and mapped to the pane through
// the same `DisplayTransform` that positions the video and the pose overlay, so
// the figure can never drift into the letterbox margins.
//
// Nothing here is measurement: the box is an instructional target, not an
// acceptance rule.

import {mapSourcePoint, type DisplayTransform, type Rect} from './camera-framing.ts';

export type GuideBox = {left: number; top: number; right: number; bottom: number};
export type GuidePoint = {x: number; y: number};

export const GUIDE_DEFAULTS = {
  /** Illustrative height of the figure, as a fraction of source height. */
  heightFraction: 0.7,
  /** Horizontal centre of the figure in source space. */
  centreX: 0.5,
  /** Bounding-box width / height of the drawn figure. */
  silhouetteAspect: 0.5,
  /** Minimum clearance from any source edge, as a fraction of the source. */
  marginFraction: 0.02,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * The instructional target. Vertically centred at source y=0.5, width derived
 * from the source aspect ratio so the figure keeps its own proportions and is
 * never clipped by the frame.
 */
export function guideBox({
  videoWidth,
  videoHeight,
  heightFraction = GUIDE_DEFAULTS.heightFraction,
  centreX = GUIDE_DEFAULTS.centreX,
  silhouetteAspect = GUIDE_DEFAULTS.silhouetteAspect,
  marginFraction = GUIDE_DEFAULTS.marginFraction,
}: {
  videoWidth: number;
  videoHeight: number;
  heightFraction?: number;
  centreX?: number;
  silhouetteAspect?: number;
  marginFraction?: number;
}): GuideBox {
  const safeWidth = Math.max(1, videoWidth);
  const safeHeight = Math.max(1, videoHeight);
  const margin = clamp(marginFraction, 0, 0.2);
  const height = clamp(heightFraction, 0.2, 1 - margin * 2);
  const aspect = clamp(silhouetteAspect, 0.1, 1);
  // Bounding-box width, expressed in source-normalised units.
  const widthNorm = Math.min((aspect * height * safeHeight) / safeWidth, 1 - margin * 2);
  const halfWidth = widthNorm / 2;
  const centre = clamp(centreX, margin + halfWidth, 1 - margin - halfWidth);
  const top = clamp(0.5 - height / 2, margin, 1 - margin - height);
  return {left: centre - halfWidth, right: centre + halfWidth, top, bottom: top + height};
}

/** Map a normalised source box to pane pixels through the shared transform. */
export function rectForBox(transform: DisplayTransform, box: GuideBox): Rect {
  const topLeft = mapSourcePoint(transform, {x: box.left, y: box.top});
  const bottomRight = mapSourcePoint(transform, {x: box.right, y: box.bottom});
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  return {x, y, width: Math.abs(bottomRight.x - topLeft.x), height: Math.abs(bottomRight.y - topLeft.y)};
}

/** A point inside the box, in 0..1 box coordinates, mapped to pane pixels. */
export function pointInBox(transform: DisplayTransform, box: GuideBox, fx: number, fy: number): GuidePoint {
  return mapSourcePoint(transform, {
    x: box.left + (box.right - box.left) * clamp(fx, 0, 1),
    y: box.top + (box.bottom - box.top) * clamp(fy, 0, 1),
  });
}

export type GuideRegions = {
  head: GuidePoint;
  hands: [GuidePoint, GuidePoint];
  feet: [GuidePoint, GuidePoint];
};

/** Region anchors match the drawn figure's proportions. */
export function guideRegions(transform: DisplayTransform, box: GuideBox): GuideRegions {
  return {
    head: pointInBox(transform, box, 0.5, 0.1),
    hands: [pointInBox(transform, box, 0.2, 0.53), pointInBox(transform, box, 0.8, 0.53)],
    feet: [pointInBox(transform, box, 0.4, 0.965), pointInBox(transform, box, 0.6, 0.965)],
  };
}

/**
 * A guide box derived from accepted body bounds, used for the one-time
 * transition to detected proportions. It is frozen at acceptance; it must not be
 * re-derived from later frames.
 */
export function boxFromOutline(outline: GuideBox): GuideBox {
  const left = Math.min(outline.left, outline.right);
  const right = Math.max(outline.left, outline.right);
  const top = Math.min(outline.top, outline.bottom);
  const bottom = Math.max(outline.top, outline.bottom);
  return {left, top, right, bottom};
}

/** True when the mapped rect lies inside the visible video destination. */
export function rectInsideDestination(transform: DisplayTransform, rect: Rect, epsilon = 0.5): boolean {
  const {destination} = transform;
  return (
    rect.x >= destination.x - epsilon &&
    rect.y >= destination.y - epsilon &&
    rect.x + rect.width <= destination.x + destination.width + epsilon &&
    rect.y + rect.height <= destination.y + destination.height + epsilon
  );
}

/** The empty bands above and below the visible video, in pane pixels. */
export function marginBands(transform: DisplayTransform): {top: number; bottom: number; left: number; right: number} {
  const {destination, paneWidth, paneHeight} = transform;
  return {
    top: Math.max(0, destination.y),
    bottom: Math.max(0, paneHeight - (destination.y + destination.height)),
    left: Math.max(0, destination.x),
    right: Math.max(0, paneWidth - (destination.x + destination.width)),
  };
}
