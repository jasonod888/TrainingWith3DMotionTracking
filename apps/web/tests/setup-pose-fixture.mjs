// Synthetic MediaPipe-shaped poses for the guided camera setup tests.
// Not a test file: the runner only picks up `*.test.mjs`.
//
// The default pose is a complete standing body that satisfies both
// `assessStanding` (crouch-free legs, in-range height, inside the source
// margins) and `observeBody` (head, both feet and both wrists visible, no edge
// risk, centred).

const INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
};

export function setupPose({visibility = 0.99, feet = 0.9, top = 0.18, centre = 0.5, hands = true} = {}) {
  const point = (x, y) => ({x, y, z: 0, visibility, presence: 0.99});
  const image = Array.from({length: 33}, () => point(centre, 0.5));
  image[0] = point(centre, top);
  for (let i = 1; i <= 6; i++) image[i] = point(centre - (i % 2) * 0.012, top);
  for (let i = 7; i <= 10; i++) image[i] = point(centre + (i % 2) * 0.022, top + 0.01);
  image[11] = point(centre - 0.07, 0.3);
  image[12] = point(centre + 0.07, 0.3);
  image[13] = point(centre - 0.09, 0.4);
  image[14] = point(centre + 0.09, 0.4);
  image[15] = point(centre - (hands ? 0.09 : 0.012), 0.55);
  image[16] = point(centre + (hands ? 0.09 : 0.012), 0.55);
  for (const [i, dx] of [[17, -0.006], [18, -0.01], [19, -0.014], [20, -0.018]]) image[i] = point(centre - 0.09 + dx, 0.57);
  for (const [i, dx] of [[21, 0.006], [22, 0.018]]) image[i] = point(centre + 0.09 + dx, 0.57);
  image[23] = point(centre - 0.05, 0.55);
  image[24] = point(centre + 0.05, 0.55);
  image[25] = point(centre - 0.05, 0.72);
  image[26] = point(centre + 0.05, 0.72);
  image[27] = point(centre - 0.06, feet);
  image[28] = point(centre + 0.06, feet);
  image[29] = point(centre - 0.06, feet + 0.01);
  image[30] = point(centre + 0.06, feet + 0.01);
  image[31] = point(centre - 0.06, feet + 0.02);
  image[32] = point(centre + 0.06, feet + 0.02);
  return {image, world: image.map(value => ({...value}))};
}

/** Both landmark sets compressed vertically, used for "too far away" and scale changes. */
export function compressPose(pose, factor) {
  const squash = value => ({
    ...value,
    image: value.image.map(point => ({...point, y: 0.5 + (point.y - 0.5) * factor})),
    world: value.world.map(point => ({...point, y: 0.5 + (point.y - 0.5) * factor})),
  });
  return squash(pose);
}

/** Hide selected landmarks by lowering their visibility. */
export function hidePose(pose, indices, visibility = 0.2) {
  return {
    image: pose.image.map((point, index) => (indices.includes(index) ? {...point, visibility} : {...point})),
    world: pose.world.map(value => ({...value})),
  };
}

export {INDEX};
