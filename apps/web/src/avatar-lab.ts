/**
 * Experiment harness for avatar retargeting.
 *
 * Not part of the app bundle: open /avatar-lab.html from the Vite dev server. It loads a
 * prepared avatar plus a converted clip, and can put the canonical MHR reference beside it
 * at the same time, so a retarget can be judged against the motion it came from. Upload a
 * clip GLB to try any animation without rebuilding.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AVATAR_IDS, AVATAR_PROFILES, avatarAssetUrl, validateProfile,
  type AvatarId, type AvatarProfile,
} from '../../../packages/avatar-rigs/index';
import {styleInstructor} from './instructor';
import {measureStandingRig} from './rig';

const host = document.getElementById('stage') as HTMLDivElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const info = document.getElementById('info') as HTMLDivElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11161c);
scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x444039, 1.5));
const key = new THREE.DirectionalLight(0xfff4e5, 2.6);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xc4d9ff, 1.5);
rim.position.set(-3, 2, -2);
scene.add(rim);
const grid = new THREE.GridHelper(12, 24, 0x44564c, 0x283c32);
scene.add(grid);

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 12;

const anchor = new THREE.Group();
scene.add(anchor);
const refAnchor = new THREE.Group();
refAnchor.position.x = 0;
refAnchor.visible = false;
scene.add(refAnchor);

const loader = new GLTFLoader();
let model: THREE.Object3D | null = null;
let helper: THREE.SkeletonHelper | null = null;
let current: AvatarId = 'male';
let showSkeleton = false;
let showJoints = true;
let loadToken = 0;

const ANGLES: Record<string, number> = {front: 0, left: Math.PI / 2, back: Math.PI, right: -Math.PI / 2};

let currentView = 'front';

function placeCamera(view: string, distance = 4, targetY = 0.9) {
  currentView = view;
  // Same framing rule as the lesson viewer: orbit at eye level around a target.
  const yaw = ANGLES[view] ?? 0;
  camera.position.set(Math.sin(yaw) * distance, targetY + 0.2, Math.cos(yaw) * distance);
  camera.lookAt(0, targetY, 0);
  controls.target.set(0, targetY, 0);
  controls.update();
}

/** Frame a single bone, for close inspection of hands, feet or the head. */
function focusBone(boneName: string, distance: number) {
  if (!model) return;
  const bone = model.getObjectByName(boneName);
  if (!bone) {
    status.textContent += ` · focus bone ${boneName} not found`;
    return;
  }
  const point = new THREE.Vector3();
  bone.getWorldPosition(point);
  const yaw = ANGLES.front;
  camera.position.set(point.x + Math.sin(yaw) * distance, point.y + 0.05,
    point.z + Math.cos(yaw) * distance);
  camera.lookAt(point);
  controls.target.copy(point);
  controls.update();
}

function describe(profile: AvatarProfile) {
  const rig = profile.rig;
  const bones = new Map(rig.bones.map(bone => [bone.name, bone]));
  const chain = (name: string) => {
    const parts: string[] = [];
    let cursor: string | null = name;
    while (cursor) {
      parts.unshift(cursor);
      cursor = bones.get(cursor)?.parent ?? null;
    }
    return parts.join(' → ');
  };
  const landmark = (key: string) => {
    const entry = profile.landmarks[key];
    return entry ? `${key}: ${entry.bone} @ ${entry.rest.map(v => v.toFixed(3)).join(', ')}` : `${key}: —`;
  };
  info.innerHTML = `
    <dl>
      <dt>Asset</dt><dd>${profile.asset.file} · ${(profile.asset.bytes / 1024).toFixed(0)} KiB · ${profile.asset.sha256.slice(0, 16)}…</dd>
      <dt>Bones</dt><dd>${rig.joint_count} · root ${rig.root_bone}</dd>
      <dt>Height</dt><dd>${profile.measurements.standing_height.toFixed(3)} m · floor ${profile.measurements.floor_y.toFixed(4)} m · hips ${profile.measurements.hip_height.toFixed(3)} m</dd>
      <dt>Facing</dt><dd>${profile.orientation.forward.map(v => v.toFixed(3)).join(', ')} (yaw ${profile.orientation.facing_yaw_degrees.toFixed(2)}°)</dd>
      <dt>Wrist chain</dt><dd>${chain(profile.landmarks.left_wrist.bone)}</dd>
      <dt>Ankle chain</dt><dd>${chain(profile.landmarks.left_ankle.bone)}</dd>
      <dt>Toe chain</dt><dd>${chain(profile.landmarks.left_toe.bone)}</dd>
    </dl>
    <pre>${['hips', 'head_top', 'left_wrist', 'right_wrist', 'left_ankle', 'right_ankle', 'left_toe', 'right_toe']
      .map(landmark).join('\n')}</pre>`;
}

function measure(root: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(root);
  return {min: box.min.clone(), max: box.max.clone()};
}

let mixer: THREE.AnimationMixer | null = null;
let clip: THREE.AnimationClip | null = null;
let clipTime = 0;

// The canonical MHR reference, loaded on demand so the retarget can be judged against the
// motion it came from at the same timestamp.
let referenceScene: THREE.Group | null = null;
let referenceMixer: THREE.AnimationMixer | null = null;
let showReference = false;
let pinToOrigin = true;
let referenceUrl = '/api/demo/assets/reference.glb';

async function ensureReference() {
  if (referenceScene) return;
  const loaded = await loader.loadAsync(referenceUrl);
  const reference = loaded.scene;
  const bounds = measureStandingRig(refAnchor, reference);
  refAnchor.scale.setScalar(1.8 / bounds.height);
  refAnchor.position.y = -bounds.baseFoot * refAnchor.scale.y;
  styleInstructor(reference, false);
  reference.traverse(node => { if (node instanceof THREE.Mesh) node.frustumCulled = false; });
  refAnchor.add(reference);
  refAnchor.updateMatrixWorld(true);

  const animation = loaded.animations[0];
  if (!animation) throw new Error('the reference GLB carries no animation');
  referenceMixer = new THREE.AnimationMixer(reference);
  const action = referenceMixer.clipAction(animation);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  referenceMixer.setTime(clipTime);
  referenceScene = reference;
}

/** Load the converted clip and park it at clipTime. Tracks bind to the avatar by name. */
async function applyClip() {
  if (mixer) {
    mixer.stopAllAction();
    mixer.uncacheRoot(mixer.getRoot() as THREE.Object3D);
    mixer = null;
  }
  if (!clipUrl || !model) return;
  if (!clip) {
    const loaded = await loader.loadAsync(clipUrl);
    clip = loaded.animations[0] ?? null;
    if (!clip) throw new Error('the clip file carries no animation');
  }
  const animation = clip;
  mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(animation);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(clipTime);
  if (referenceMixer) referenceMixer.setTime(clipTime);
  model.updateMatrixWorld(true);
  status.textContent += ` · clip ${animation.duration.toFixed(3)} s at ${clipTime.toFixed(2)} s`;
}

let clipUrl = '';

function renderScrubber() {
  const host = document.getElementById('scrub');
  if (!host) return;
  if (!clip) {
    host.replaceChildren();
    return;
  }
  const animation = clip;
  const label = document.createElement('label');
  label.textContent = `Clip time ${clipTime.toFixed(2)} s / ${animation.duration.toFixed(2)} s`;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = String(animation.duration);
  input.step = '0.01';
  input.value = String(clipTime);
  input.setAttribute('aria-label', 'Clip time');
  input.oninput = () => {
    clipTime = Number(input.value);
    mixer?.setTime(clipTime);
    referenceMixer?.setTime(clipTime);
    model?.updateMatrixWorld(true);
    referenceScene?.updateMatrixWorld(true);
    label.textContent = `Clip time ${clipTime.toFixed(2)} s / ${animation.duration.toFixed(2)} s`;
  };
  host.replaceChildren(label, input);
}

function dispose(root: THREE.Object3D) {
  root.traverse(node => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}

async function load(id: AvatarId) {
  const token = ++loadToken;
  current = id;
  const profile = AVATAR_PROFILES[id];
  status.textContent = `Loading ${profile.asset.file}…`;
  const url = avatarAssetUrl(id);
  try {
    const gltf = await loader.loadAsync(url);
    if (token !== loadToken) {
      dispose(gltf.scene);
      return;
    }
    if (gltf.animations.length) throw new Error('the static avatar must not ship clips');
    if (model) {
      anchor.remove(model);
      dispose(model);
      model = null;
    }
    if (helper) {
      scene.remove(helper);
      helper.dispose();
      helper = null;
    }
    model = gltf.scene;
    anchor.add(model);
    const jointsMesh = model.getObjectByName('Joints');
    if (jointsMesh) jointsMesh.visible = showJoints;
    anchor.scale.setScalar(1.8 / profile.measurements.standing_height);
    anchor.position.y = -profile.measurements.floor_y * anchor.scale.y;
    anchor.updateMatrixWorld(true);

    const bounds = measure(model);
    const names = (gltf.scene.getObjectByName('Hips') ? 'normalised bone names' : 'unexpected bone naming');
    const meshCount = (() => {
      let count = 0;
      model!.traverse(node => { if (node instanceof THREE.Mesh) count += 1; });
      return count;
    })();
    status.textContent = `${profile.display_name} · ${url} · ${meshCount} mesh${meshCount === 1 ? '' : 'es'} · ${names}`
      + ` · world height ${(bounds.max.y - bounds.min.y).toFixed(3)} m`;

    if (showSkeleton) {
      helper = new THREE.SkeletonHelper(model);
      (helper.material as THREE.Material).depthTest = false;
      scene.add(helper);
    }
    await applyClip();
    describe(profile);
    renderControls();
  } catch (error) {
    if (token === loadToken) status.textContent = `Failed: ${(error as Error).message}`;
  }
}

// Controls: plain buttons so this page has no framework dependency.
function button(label: string, pressed: boolean, onClick: () => void) {
  const element = document.createElement('button');
  element.textContent = label;
  element.setAttribute('aria-pressed', String(pressed));
  element.className = pressed ? 'on' : '';
  element.onclick = onClick;
  return element;
}

function renderControls() {
  const controlsHost = document.getElementById('controls') as HTMLDivElement;
  controlsHost.replaceChildren(
    ...AVATAR_IDS.map(id => button(
      AVATAR_PROFILES[id].display_name, current === id,
      () => { void load(id); renderControls(); })),
    button('Front', false, () => placeCamera('front')),
    button('Left', false, () => placeCamera('left')),
    button('Back', false, () => placeCamera('back')),
    button('Right', false, () => placeCamera('right')),
    button(`Skeleton ${showSkeleton ? 'on' : 'off'}`, showSkeleton, () => {
      showSkeleton = !showSkeleton;
      void load(current);
      renderControls();
    }),
    button(`Joints mesh ${showJoints ? 'on' : 'off'}`, showJoints, () => {
      showJoints = !showJoints;
      const jointsMesh = model?.getObjectByName('Joints');
      if (jointsMesh) jointsMesh.visible = showJoints;
      renderControls();
    }),
    button(`Reference ${showReference ? 'on' : 'off'}`, showReference, async () => {
      showReference = !showReference;
      if (showReference) {
        try {
          await ensureReference();
        } catch (error) {
          showReference = false;
          status.textContent = `Reference unavailable: ${(error as Error).message}`;
        }
      }
      refAnchor.visible = showReference;
      // Side by side, so the segment directions can be compared directly.
      anchor.position.x = showReference ? -0.9 : 0;
      refAnchor.position.x = showReference ? 0.9 : 0;
      placeCamera(currentView, showReference ? 6.2 : 4, 0.9);
      renderControls();
    }),
    button(`Pin to origin ${pinToOrigin ? 'on' : 'off'}`, pinToOrigin, () => {
      pinToOrigin = !pinToOrigin;
      renderControls();
    }),
    uploadButton(),
  );
}

/** Pick any clip GLB from disk and retarget-test it without rebuilding. */
function uploadButton() {
  const wrapper = document.createElement('label');
  wrapper.className = 'upload';
  wrapper.textContent = 'Upload clip';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.glb,.gltf';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    clipUrl = URL.createObjectURL(file);
    clip = null;
    status.textContent = `Uploaded ${file.name} (${Math.round(file.size / 1024)} KiB)`;
    await load(current);
    renderScrubber();
    // The reference keeps its own animation; only the avatar clip changed.
    referenceMixer?.setTime(clipTime);
  };
  wrapper.append(input);
  return wrapper;
}

/** Pin a group horizontally, the way the lesson viewer keeps the instructor in frame. */
function pinGroup(group: THREE.Group, scene: THREE.Object3D | null, baseX: number) {
  const root = scene?.getObjectByName('Hips') ?? scene?.getObjectByName('body_world') ?? null;
  if (!scene || !root) {
    group.position.x = baseX;
    return;
  }
  // Same rule as MotionStage: resolve the root in the model's own space, which is metres for
  // both rigs, so the anchor cancels travel without touching vertical motion.
  scene.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const point = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).applyMatrix4(inverse);
  group.position.x = baseX - point.x * group.scale.x;
  group.position.z = -point.z * group.scale.z;
}

const observer = new ResizeObserver(() => {
  const {width, height} = host.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
});
observer.observe(host);

// Fail loudly here rather than in a lesson: the harness validates both profiles.
for (const id of AVATAR_IDS) validateProfile(AVATAR_PROFILES[id]);

const params = new URLSearchParams(location.search);
placeCamera(params.get('view') ?? 'front', Number(params.get('d') ?? 4) || 4,
  Number(params.get('y') ?? 0.9) || 0.9);
showSkeleton = params.get('skeleton') === '1';
// The joints mesh is part of the look, so it is on unless explicitly disabled.
showJoints = params.get('joints') !== '0';
clipUrl = params.get('clip') ?? '';
clipTime = Number(params.get('t') ?? 0) || 0;
showReference = params.get('ref') === '1';
pinToOrigin = params.get('pin') !== '0';
if (params.get('refurl')) referenceUrl = params.get('refurl') as string;
const focus = params.get('focus');
const requested = params.get('avatar');
const initialAvatar: AvatarId = requested === 'female' || requested === 'male' ? requested : 'male';
renderControls();
void load(initialAvatar).then(async () => {
  renderScrubber();
  if (showReference) {
    try {
      await ensureReference();
      refAnchor.visible = true;
      anchor.position.x = -0.9;
      refAnchor.position.x = 0.9;
      placeCamera(currentView, 6.2, 0.9);
      renderControls();
    } catch (error) {
      showReference = false;
      status.textContent = `Reference unavailable: ${(error as Error).message}`;
    }
  }
  if (focus) focusBone(focus, Number(params.get('fd') ?? 1.0) || 1.0);
});

renderer.setAnimationLoop(() => {
  controls.update();
  if (pinToOrigin) {
    pinGroup(anchor, model, showReference ? -0.9 : 0);
    pinGroup(refAnchor, referenceScene, showReference ? 0.9 : 0);
  } else {
    // Unpinned shows the clip's real root travel, which the lesson viewer cancels.
    anchor.position.x = showReference ? -0.9 : 0;
    anchor.position.z = 0;
    refAnchor.position.x = showReference ? 0.9 : 0;
    refAnchor.position.z = 0;
  }
  renderer.render(scene, camera);
});
