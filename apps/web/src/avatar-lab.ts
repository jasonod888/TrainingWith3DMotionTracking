/**
 * MHR versus Mixamo comparison harness.
 *
 * Pick one of the signed-in account's projects (or the built-in demonstration), then watch the
 * canonical MHR reference and the prepared Mixamo body side by side on the same clip clock.
 *
 * The two assets are deliberately loaded through the same routes the real viewer uses, so a
 * broken derivative, a duration mismatch or a stale clip shows up here exactly as it would in a
 * lesson. The lab adds only inspection controls: shared playback, frame stepping, camera views,
 * skeleton/joint overlays and an upload slot for a local clip.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AVATAR_PROFILES, validateProfile,
  type AvatarId,
} from '../../../packages/avatar-rigs/index';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {disposeAvatarStage, loadAvatarStage, type AvatarStage} from './avatar-stage';
import {styleInstructor} from './instructor';
import {measureStandingRig} from './rig';
import {followHorizontal} from './camera-follow';
import {continuousPlayback} from './animation-sampling';

type Project = {
  id: string;
  title: string;
  duration: number;
  source: 'demo' | 'lesson';
  referenceUrl: string;
  clipUrl: (avatar: AvatarId) => string;
  reportUrl: string | null;
  clips?: Partial<Record<AvatarId, boolean>>;
};

type ReferenceStage = {
  scene: THREE.Group;
  mixer: THREE.AnimationMixer;
  clip: THREE.AnimationClip;
  root: THREE.Object3D | null;
};

type LoadResult = {
  project: Project;
  reference: ReferenceStage | null;
  avatar: AvatarStage | null;
  errors: string[];
};

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The lab is missing #${id}.`);
  return element as T;
};

const host = $<HTMLDivElement>('stage');
const overlay = $<HTMLDivElement>('stage-overlay');
const overlayText = $<HTMLParagraphElement>('overlay-text');
const status = $<HTMLParagraphElement>('status');
const projectSelect = $<HTMLSelectElement>('project');
const avatarSelect = $<HTMLSelectElement>('avatar');
const refreshButton = $<HTMLButtonElement>('refresh');
const playButton = $<HTMLButtonElement>('play');
const stepBack = $<HTMLButtonElement>('step-back');
const stepForward = $<HTMLButtonElement>('step-forward');
const timeInput = $<HTMLInputElement>('time');
const timeLabel = $<HTMLOutputElement>('time-label');
const speedSelect = $<HTMLSelectElement>('speed');
const stageClock = $<HTMLSpanElement>('stage-clock');
const leftLabel = $<HTMLSpanElement>('left-label');
const rightLabel = $<HTMLSpanElement>('right-label');
const showSkeleton = $<HTMLInputElement>('show-skeleton');
const showJoints = $<HTMLInputElement>('show-joints');
const showGround = $<HTMLInputElement>('show-ground');
const pinTravel = $<HTMLInputElement>('pin-travel');
const uploadInput = $<HTMLInputElement>('upload');
const clearUploadButton = $<HTMLButtonElement>('clear-upload');
const projectInfo = $<HTMLDListElement>('project-info');
const nextSourceJump = $<HTMLButtonElement>('next-source-jump');
const poseComparison = $<HTMLDListElement>('pose-comparison');

const params = new URLSearchParams(location.search);
const requestProject = params.get('project');
const requestAvatar: AvatarId = params.get('avatar') === 'female' ? 'female' : 'male';
const requestView = ['front', 'left', 'back', 'right'].includes(params.get('view') ?? '')
  ? params.get('view')!
  : 'front';
const requestTime = Math.max(0, Number(params.get('t') ?? 0) || 0);
const requestSpeed = [0.25, 0.5, 1].includes(Number(params.get('speed')))
  ? Number(params.get('speed'))
  : 1;

const ANGLES: Record<string, number> = {
  front: 0,
  left: Math.PI / 2,
  back: Math.PI,
  right: -Math.PI / 2,
};
const BODY_OFFSET = 0.98;

// ---------------------------------------------------------------------------------------------
// Scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1116);

scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x444039, 1.5));
const key = new THREE.DirectionalLight(0xfff4e5, 2.6);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xc4d9ff, 1.5);
rim.position.set(-3, 2, -2);
scene.add(rim);

const ground = new THREE.Group();
scene.add(ground);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshBasicMaterial({color: 0x0f1d16, side: THREE.DoubleSide}),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.005;
ground.add(floor);
const grid = new THREE.GridHelper(20, 40, 0x4c7664, 0x2a4036);
const gridMaterial = grid.material as THREE.Material;
gridMaterial.transparent = true;
gridMaterial.opacity = 0.65;
ground.add(grid);

const ringMaterial = new THREE.MeshBasicMaterial({
  color: 0x396552,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide,
});
const avatarRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.53, 64), ringMaterial);
const mhrRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.53, 64), ringMaterial);
for (const ring of [avatarRing, mhrRing]) {
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  ground.add(ring);
}

const avatarGroup = new THREE.Group();
const mhrGroup = new THREE.Group();
scene.add(avatarGroup, mhrGroup);

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
camera.position.set(0, 1.15, 5.6);
camera.lookAt(0, 0.95, 0);

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.setAttribute('aria-label', 'Side-by-side 3D comparison of the Mixamo and MHR bodies. Drag to rotate; scroll or pinch to zoom.');
renderer.domElement.setAttribute('role', 'img');
host.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.52;
controls.update();

const loader = new GLTFLoader();

// ---------------------------------------------------------------------------------------------
// State

let projects: Project[] = [];
let current: Project | null = null;
let referenceStage: ReferenceStage | null = null;
let avatarStage: AvatarStage | null = null;
let avatarHelper: THREE.SkeletonHelper | null = null;
let mhrHelper: THREE.SkeletonHelper | null = null;
let lastLoad: LoadResult | null = null;
let avatarId: AvatarId = requestAvatar;
let view = requestView;
let speed = requestSpeed;
let duration = 0;
let clipTime = 0;
let playing = false;
let libraryAvailable = false;
let loadToken = 0;
const avatarBase = new THREE.Vector2(-BODY_OFFSET, 0);
const mhrBase = new THREE.Vector2(BODY_OFFSET, 0);
let uploadedClipUrl: string | null = null;
let uploadedName = '';
let lastFrame = performance.now();
let lastUi = 0;
let comparisonReport: Record<string, any> | null = null;
const previousFollow = new THREE.Vector3();
let followReady = false;

avatarSelect.value = avatarId;
speedSelect.value = String(speed);
showSkeleton.checked = params.get('skeleton') === '1';
showJoints.checked = params.get('joints') !== '0';
showGround.checked = params.get('ground') !== '0';
pinTravel.checked = params.get('pin') !== '0';
if (!showGround.checked) ground.visible = false;

// ---------------------------------------------------------------------------------------------
// Helpers

function setStatus(message: string, tone: 'info' | 'ok' | 'warn' | 'error' = 'info') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function showOverlay(message: string, error = false) {
  overlay.hidden = false;
  overlay.classList.toggle('error', error);
  overlayText.textContent = message;
}

function hideOverlay() {
  overlay.hidden = true;
  overlay.classList.remove('error');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.00';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function basename(key: string): string {
  return key.split('/').pop() ?? key;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store'});
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Probe an asset without downloading it. HEAD is not implemented by the lesson asset route. */
async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {Range: 'bytes=0-0'},
    });
    const ok = response.ok;
    try {
      await response.body?.cancel();
    } catch {
      // The response is already closed; the status is still the answer.
    }
    return ok;
  } catch {
    return false;
  }
}

function lessonAsset(lessonId: string, name: string): string {
  return `/api/lessons/${encodeURIComponent(lessonId)}/assets/${encodeURIComponent(name)}`;
}

function projectFromLesson(lesson: LessonManifest): Project {
  const referenceName = basename(lesson.animation.key);
  return {
    id: lesson.lesson_id,
    title: lesson.title,
    duration: lesson.duration,
    source: 'lesson',
    referenceUrl: lessonAsset(lesson.lesson_id, referenceName),
    clipUrl: avatar => lessonAsset(lesson.lesson_id, `avatar-${avatar}.glb`),
    reportUrl: lessonAsset(lesson.lesson_id, 'avatar-report.json'),
  };
}

function projectFromDemo(lesson: LessonManifest): Project {
  const referenceName = basename(lesson.animation.key);
  return {
    id: lesson.lesson_id,
    title: lesson.title,
    duration: lesson.duration,
    source: 'demo',
    referenceUrl: `/api/demo/assets/${encodeURIComponent(referenceName)}`,
    clipUrl: avatar => `/api/demo/assets/avatar-${avatar}.glb`,
    reportUrl: '/api/demo/assets/avatar-report.json',
  };
}

function projectLabel(project: Project): string {
  const parts = [project.title];
  if (project.source === 'demo') parts.push('demo');
  parts.push(`${project.duration.toFixed(1)} s`);
  if (project.clips) {
    if (project.clips[avatarId] === true) parts.push('clip ready');
    else if (project.clips[avatarId] === false) parts.push('no Mixamo clip');
  }
  return parts.join(' · ');
}

function makeOption(project: Project): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = project.id;
  option.textContent = projectLabel(project);
  return option;
}

function renderProjectOptions() {
  const previous = current?.id ?? projectSelect.value;
  projectSelect.replaceChildren();
  const lessons = projects.filter(project => project.source === 'lesson');
  const demos = projects.filter(project => project.source === 'demo');

  if (lessons.length) {
    const group = document.createElement('optgroup');
    group.label = 'Your projects';
    for (const project of lessons) group.append(makeOption(project));
    projectSelect.append(group);
  }
  if (demos.length) {
    const group = document.createElement('optgroup');
    group.label = 'Demonstration';
    for (const project of demos) group.append(makeOption(project));
    projectSelect.append(group);
  }
  if (!projects.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No projects available';
    projectSelect.append(option);
  }
  projectSelect.disabled = projects.length < 2;
  if (previous && projects.some(project => project.id === previous)) {
    projectSelect.value = previous;
  } else if (projects[0]) {
    projectSelect.value = projects[0].id;
  }
}

/** Mark which projects actually carry a prepared clip, without downloading 5 MB apiece. */
async function annotateAvailability() {
  const targets = projects.slice(0, 30);
  await Promise.all(targets.map(async project => {
    const [male, female] = await Promise.all([
      assetExists(project.clipUrl('male')),
      assetExists(project.clipUrl('female')),
    ]);
    project.clips = {male, female};
  }));
  renderProjectOptions();
  if (lastLoad) renderInfo();
}

// ---------------------------------------------------------------------------------------------
// Loading

function disposeObject(root: THREE.Object3D) {
  root.traverse(node => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}

function disposeReference(value: ReferenceStage | null) {
  if (!value) return;
  value.mixer.stopAllAction();
  value.mixer.uncacheRoot(value.scene);
  disposeObject(value.scene);
}

function removeHelpers() {
  for (const helper of [avatarHelper, mhrHelper]) {
    if (!helper) continue;
    scene.remove(helper);
    helper.dispose();
  }
  avatarHelper = null;
  mhrHelper = null;
}

function clearStage() {
  removeHelpers();
  if (avatarStage) {
    avatarGroup.remove(avatarStage.scene);
    disposeAvatarStage(avatarStage);
    avatarStage = null;
  }
  if (referenceStage) {
    mhrGroup.remove(referenceStage.scene);
    disposeReference(referenceStage);
    referenceStage = null;
  }
  avatarGroup.clear();
  mhrGroup.clear();
  duration = 0;
  clipTime = 0;
  lastLoad = null;
}

async function loadReference(url: string): Promise<ReferenceStage> {
  const gltf = await loader.loadAsync(url);
  const sourceClip = gltf.animations[0];
  if (!sourceClip) throw new Error('the reference GLB carries no animation');
  const clip=continuousPlayback(sourceClip);
  styleInstructor(gltf.scene, false);
  gltf.scene.traverse(node => {
    if (node instanceof THREE.Mesh) node.frustumCulled = false;
  });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  return {
    scene: gltf.scene,
    mixer,
    clip,
    root: gltf.scene.getObjectByName('root') ?? gltf.scene.getObjectByName('body_world') ?? null,
  };
}

function styleHelper(helper: THREE.SkeletonHelper, color: number) {
  const material = helper.material as THREE.LineBasicMaterial;
  material.depthTest = false;
  material.transparent = true;
  material.opacity = 0.72;
  material.color.setHex(color);
  helper.renderOrder = 10;
}

function refreshHelpers() {
  removeHelpers();
  if (!showSkeleton.checked) return;
  if (avatarStage) {
    avatarHelper = new THREE.SkeletonHelper(avatarStage.scene);
    styleHelper(avatarHelper, 0x67d9ad);
    scene.add(avatarHelper);
  }
  if (referenceStage) {
    mhrHelper = new THREE.SkeletonHelper(referenceStage.scene);
    styleHelper(mhrHelper, 0x7fb6ff);
    scene.add(mhrHelper);
  }
}

function applyJointVisibility() {
  const joints = avatarStage?.scene.getObjectByName('Joints');
  if (joints) joints.visible = showJoints.checked;
}

/**
 * The separation has to follow the camera, not the world axes: from the left or right view the
 * two bodies would otherwise sit exactly behind one another. `front`/`back` separate on x;
 * `left`/`right` separate on z so the labels still read Mixamo on the screen's left.
 */
function bodyOffsets(nextView: string): {avatar: THREE.Vector2; mhr: THREE.Vector2} {
  const d = BODY_OFFSET;
  switch (nextView) {
    case 'back':
      return {avatar: new THREE.Vector2(d, 0), mhr: new THREE.Vector2(-d, 0)};
    case 'left':
      return {avatar: new THREE.Vector2(0, d), mhr: new THREE.Vector2(0, -d)};
    case 'right':
      return {avatar: new THREE.Vector2(0, -d), mhr: new THREE.Vector2(0, d)};
    default:
      return {avatar: new THREE.Vector2(-d, 0), mhr: new THREE.Vector2(d, 0)};
  }
}

function pinGroup(
  group: THREE.Group,
  model: THREE.Object3D | null,
  baseX: number,
  baseZ: number,
  rootName: string,
) {
  if (!model) {
    group.position.x = baseX;
    group.position.z = baseZ;
    return;
  }
  const root = model.getObjectByName(rootName);
  if (!root) {
    group.position.x = baseX;
    group.position.z = baseZ;
    return;
  }
  model.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const point = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).applyMatrix4(inverse);
  group.position.x = baseX - point.x * group.scale.x;
  group.position.z = baseZ - point.z * group.scale.z;
}

function updateGroups() {
  if (pinTravel.checked) {
    pinGroup(avatarGroup, avatarStage?.scene ?? null, avatarBase.x, avatarBase.y,
      avatarStage?.profile.rig.root_bone ?? 'Hips');
    pinGroup(mhrGroup, referenceStage?.scene ?? null, mhrBase.x, mhrBase.y, referenceStage?.root?.name ?? 'body_world');
    followReady = false;
  } else {
    avatarGroup.position.x = avatarBase.x;
    avatarGroup.position.z = avatarBase.y;
    mhrGroup.position.x = mhrBase.x;
    mhrGroup.position.z = mhrBase.y;
    const points: THREE.Vector3[] = [];
    for (const root of [avatarStage?.root, referenceStage?.root]) {
      if (root) points.push(root.getWorldPosition(new THREE.Vector3()));
    }
    if (points.length) {
      const centre = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
      followHorizontal(camera, controls.target, centre, previousFollow, followReady);
      followReady = true;
    }
  }
  avatarRing.position.set(avatarBase.x, 0.003, avatarBase.y);
  mhrRing.position.set(mhrBase.x, 0.003, mhrBase.y);
}

function seek(time: number) {
  clipTime = duration > 0 ? THREE.MathUtils.clamp(time, 0, duration) : 0;
  setStageTime(avatarStage, clipTime);
  setStageTime(referenceStage, clipTime);
  avatarStage?.scene.updateMatrixWorld(true);
  referenceStage?.scene.updateMatrixWorld(true);
  updateGroups();
  updateTimeUi();
  updatePoseComparison();
}

function setStageTime(stage: AvatarStage | ReferenceStage | null, time: number) {
  if (!stage) return;
  const action = stage.mixer.clipAction(stage.clip);
  action.paused=false;action.enabled=true;
  stage.mixer.setTime(time);
}

function updatePoseComparison() {
  poseComparison.replaceChildren();
  if (!avatarStage || !referenceStage) return;
  const jointAngle = (model: THREE.Object3D, names: string[]) => {
    const points = names.map(name => model.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()));
    if (points.some(point => !point)) return null;
    const [a,b,c] = points as THREE.Vector3[];
    return THREE.MathUtils.radToDeg(a.sub(b).angleTo(c.sub(b)));
  };
  for (const [label, target, source] of [
    ['Left elbow',['LeftArm','LeftForeArm','LeftHand'],['l_uparm','l_lowarm','l_wrist']],
    ['Right elbow',['RightArm','RightForeArm','RightHand'],['r_uparm','r_lowarm','r_wrist']],
    ['Left knee',['LeftUpLeg','LeftLeg','LeftFoot'],['l_upleg','l_lowleg','l_foot']],
    ['Right knee',['RightUpLeg','RightLeg','RightFoot'],['r_upleg','r_lowleg','r_foot']],
  ] as [string,string[],string[]][]) {
    const a=jointAngle(avatarStage.scene,target), b=jointAngle(referenceStage.scene,source);
    const term=document.createElement('dt'),value=document.createElement('dd');
    term.textContent=label;value.textContent=a===null||b===null?'Unavailable':`${Math.abs(a-b).toFixed(1)}° difference`;
    if (a!==null && b!==null) {
      value.dataset.mixamoAngle=String(a);value.dataset.referenceAngle=String(b);
      value.title=`Mixamo ${a.toFixed(1)}°; MHR ${b.toFixed(1)}°`;
    }
    poseComparison.append(term,value);
  }
}

function updateTimeUi() {
  const safeDuration = Math.max(duration, 0);
  timeInput.max = String(Math.max(safeDuration, 0.01));
  timeInput.value = String(Math.min(clipTime, safeDuration));
  timeLabel.textContent = `${formatClock(clipTime)} / ${formatClock(safeDuration)}`;
  stageClock.textContent = `${clipTime.toFixed(2)}s / ${safeDuration.toFixed(2)}s`;
  const ready = safeDuration > 0 && !!(avatarStage || referenceStage);
  playButton.disabled = !ready;
  stepBack.disabled = !ready;
  stepForward.disabled = !ready;
  timeInput.disabled = !ready;
  playButton.dataset.playing = String(playing);
  playButton.textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  playButton.setAttribute('aria-label', playing ? 'Pause comparison' : 'Play comparison');
}

function updateTransport() {
  updateTimeUi();
}

/** Keep both bodies in the camera's screen plane; a single available body is centred. */
function updateBodyLayout() {
  if (avatarStage && referenceStage) {
    const offsets = bodyOffsets(view);
    avatarBase.copy(offsets.avatar);
    mhrBase.copy(offsets.mhr);
  } else {
    avatarBase.set(0, 0);
    mhrBase.set(0, 0);
  }
  updateGroups();
}

/**
 * A fixed distance frames a wide window well and a phone badly. Fit the width of the two
 * bodies into the horizontal field of view, keeping the desktop framing as a floor.
 */
function fitDistance(): number {
  const both = !!(avatarStage && referenceStage);
  const aspect = Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1);
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const widthFit = (both ? 1.9 : 1.2) / Math.max(tan * aspect, 0.05);
  return Math.max(both ? 5.6 : 4.6, widthFit);
}

function placeCamera(nextView: string, targetY = 0.95) {
  view = nextView;
  const distance = fitDistance();
  const yaw = ANGLES[nextView] ?? 0;
  camera.position.set(Math.sin(yaw) * distance, targetY + 0.2, Math.cos(yaw) * distance);
  camera.lookAt(0, targetY, 0);
  controls.target.set(0, targetY, 0);
  controls.update();
  updateBodyLayout();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    const active = button.dataset.view === nextView;
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/** Preserve the orbit direction while re-fitting the distance after a resize. */
function refitCamera() {
  const distance = fitDistance();
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 1e-8) return;
  camera.position.copy(controls.target).addScaledVector(direction.normalize(), distance);
  controls.update();
}

function togglePlay() {
  if (!duration || !(avatarStage || referenceStage)) return;
  if (!playing && clipTime >= duration - 1e-4) clipTime = 0;
  playing = !playing;
  updateTransport();
  if (!playing) syncUrl();
}

function step(delta: number) {
  if (!duration) return;
  playing = false;
  const times = (referenceStage?.clip ?? avatarStage?.clip)?.tracks[0]?.times;
  let time = delta > 0 ? duration : 0;
  if (times) {
    if (delta > 0) { for (const sample of times) if (sample > clipTime + 1e-5) {time=sample;break;} }
    else { for (const sample of times) {if (sample >= clipTime-1e-5) break;time=sample;} }
  } else time=clipTime+delta;
  seek(time);
  updateTransport();
  syncUrl();
}

function syncUrl() {
  const query = new URLSearchParams(location.search);
  if (current) query.set('project', current.id);
  else query.delete('project');
  query.set('avatar', avatarId);
  query.set('view', view);
  query.set('speed', String(speed));
  query.set('t', clipTime.toFixed(2));
  const next = `${location.pathname}?${query.toString()}`;
  if (next !== location.pathname + location.search) {
    history.replaceState(null, '', next);
  }
}

function addRow(label: string, ...values: (string | Node)[]) {
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  for (const value of values) {
    detail.append(typeof value === 'string' ? document.createTextNode(value) : value);
  }
  projectInfo.append(term, detail);
  return detail;
}

function badge(text: string, tone: 'ok' | 'warn' | 'error'): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = `badge ${tone}`;
  element.textContent = text;
  return element;
}

function link(url: string, text = url): HTMLAnchorElement {
  const element = document.createElement('a');
  element.href = url;
  element.target = '_blank';
  element.rel = 'noreferrer';
  element.textContent = text;
  return element;
}

function renderInfo() {
  projectInfo.replaceChildren();
  if (!lastLoad) {
    addRow('Status', 'Nothing loaded yet.');
    return;
  }
  const {project, reference, avatar, errors} = lastLoad;
  addRow('Title', project.title);
  addRow('Lesson id', project.id);
  addRow('Source', project.source === 'demo' ? 'Built-in demonstration' : 'Your project');
  addRow('Expected duration', `${project.duration.toFixed(2)} s`);
  addRow('Clip time', `${clipTime.toFixed(2)} s`);

  if (reference) {
    addRow('MHR reference', badge('loaded', 'ok'), ` ${reference.clip.duration.toFixed(2)} s`);
    addRow('MHR tracks', String(reference.clip.tracks.length));
    addRow('MHR root', reference.root?.name ?? 'body_world not found');
    addRow('MHR file', link(project.referenceUrl));
  } else {
    addRow('MHR reference', badge('unavailable', 'error'));
  }

  if (avatar) {
    addRow('Mixamo body', badge('loaded', 'ok'), ` ${avatar.profile.display_name}`);
    addRow('Mixamo clip', `${avatar.clip.duration.toFixed(2)} s · ${avatar.clip.tracks.length} tracks`);
    addRow('Mixamo root', avatar.profile.rig.root_bone);
    addRow('Mixamo file', uploadedClipUrl
      ? `Uploaded file: ${uploadedName || 'clip.glb'}`
      : link(project.clipUrl(avatarId)));
  } else {
    addRow('Mixamo body', badge('unavailable', 'error'));
  }

  if (project.reportUrl && !uploadedClipUrl) addRow('Retarget report', link(project.reportUrl, 'avatar-report.json'));
  const report = comparisonReport?.avatars?.[avatarId];
  nextSourceJump.hidden = !report?.source_rotation_jumps?.length;
  if (report && !uploadedClipUrl) {
    addRow('Conversion version', String(report.retargeter?.version ?? 'unknown'));
    addRow('Hand motion', report.mapping?.fingers?.preset === 'tracked' ? 'Captured finger motion' : 'Static finger pose (older clip)');
    if (report.foot_placement) {
      addRow('Foot placement error', `${(100*report.foot_placement.max_ankle_error_after_m).toFixed(1)} cm maximum`);
      addRow('Leg reach limits', String(report.foot_placement.unreachable_leg_frames));
    }
    const jump = Number(report.checks?.max_step_rotation_source_degrees ?? 0);
    if (jump > 60) addRow('Source motion', badge('review', 'warn'), ` ${jump.toFixed(1)}° rotation between source frames`);
    if (report.warnings?.length) addRow('Motion notes', report.warnings.join(' · '));
  }
  if (errors.length) addRow('Load notes', errors.join(' · '));
  if (!libraryAvailable) addRow('Library', 'Sign in to Form to compare your own projects.');
}

nextSourceJump.addEventListener('click', () => {
  const jumps = comparisonReport?.avatars?.[avatarId]?.source_rotation_jumps ?? [];
  const times = [...new Set<number>(jumps.map((jump: {time: number}) => jump.time))].sort((a,b) => a-b);
  const time = times.find(time => time > clipTime + .01) ?? times[0];
  if (time !== undefined) { playing=false;seek(time);updateTransport();syncUrl(); }
});

async function loadProject(project: Project, options: {time?: number} = {}) {
  const token = ++loadToken;
  comparisonReport = null;
  followReady = false;
  current = project;
  playing = false;
  projectSelect.value = project.id;
  renderProjectOptions();
  projectSelect.value = project.id;
  clearStage();
  updateTransport();
  setStatus(`Loading ${project.title}…`);
  showOverlay(`Loading ${project.title}’s MHR reference and Mixamo clip…`);
  leftLabel.textContent = `Mixamo · ${AVATAR_PROFILES[avatarId].display_name}`;
  rightLabel.textContent = 'MHR reference';

  const startTime = options.time ?? 0;
  const freshness = `lab=${Date.now()}`;
  const clipUrl = uploadedClipUrl ?? `${project.clipUrl(avatarId)}?${freshness}`;
  const expected = uploadedClipUrl ? undefined : project.duration;

  const [referenceResult, avatarResult, reportResult] = await Promise.allSettled([
    loadReference(`${project.referenceUrl}?${freshness}`),
    loadAvatarStage(loader, avatarId, clipUrl, expected),
    project.reportUrl && !uploadedClipUrl ? getJson<Record<string, any>>(project.reportUrl) : Promise.resolve(null),
  ]);

  if (token !== loadToken) {
    if (referenceResult.status === 'fulfilled') disposeReference(referenceResult.value);
    if (avatarResult.status === 'fulfilled') disposeAvatarStage(avatarResult.value);
    return;
  }
  comparisonReport = reportResult.status === 'fulfilled' ? reportResult.value : null;

  let reference = referenceResult.status === 'fulfilled' ? referenceResult.value : null;
  let avatar = avatarResult.status === 'fulfilled' ? avatarResult.value : null;
  const errors: string[] = [];
  if (referenceResult.status === 'rejected') errors.push(`MHR reference: ${messageOf(referenceResult.reason)}`);
  if (avatarResult.status === 'rejected') errors.push(`Mixamo clip: ${messageOf(avatarResult.reason)}`);

  if (reference) {
    try {
      referenceStage = reference;
      mhrGroup.add(reference.scene);
      const bounds = measureStandingRig(mhrGroup, reference.scene);
      const scale = 1.8 / bounds.height;
      mhrGroup.scale.setScalar(scale);
      mhrGroup.position.y = -bounds.baseFoot * scale;
      mhrGroup.position.x = BODY_OFFSET;
    } catch (error) {
      mhrGroup.remove(reference.scene);
      disposeReference(reference);
      referenceStage = null;
      reference = null;
      errors.push(`MHR reference placement: ${messageOf(error)}`);
    }
  }

  if (avatar) {
    try {
      avatarStage = avatar;
      avatarGroup.add(avatar.scene);
      const scale = 1.8 / avatar.height;
      avatarGroup.scale.setScalar(scale);
      avatarGroup.position.y = -avatar.baseFoot * scale;
      avatarGroup.position.x = -BODY_OFFSET;
      applyJointVisibility();
    } catch (error) {
      avatarGroup.remove(avatar.scene);
      disposeAvatarStage(avatar);
      avatarStage = null;
      avatar = null;
      errors.push(`Mixamo body placement: ${messageOf(error)}`);
    }
  }

  if (!referenceStage && !avatarStage) {
    lastLoad = {project, reference: null, avatar: null, errors};
    setStatus(`${project.title} could not be compared: ${errors.join(' · ')}`, 'error');
    showOverlay(errors.join('\n'), true);
    leftLabel.textContent = 'Mixamo · unavailable';
    rightLabel.textContent = 'MHR · unavailable';
    renderInfo();
    return;
  }

  leftLabel.textContent = avatarStage
    ? `Mixamo · ${AVATAR_PROFILES[avatarId].display_name}`
    : 'Mixamo · unavailable';
  rightLabel.textContent = referenceStage ? 'MHR reference' : 'MHR · unavailable';

  updateBodyLayout();

  duration = referenceStage?.clip.duration ?? avatarStage?.clip.duration ?? project.duration;
  if (referenceStage && Math.abs(referenceStage.clip.duration - project.duration) > 0.1) {
    errors.push(`MHR duration ${referenceStage.clip.duration.toFixed(2)}s differs from the project’s ${project.duration.toFixed(2)}s`);
  }
  if (referenceStage && avatarStage && Math.abs(referenceStage.clip.duration - avatarStage.clip.duration) > 0.1) {
    errors.push(`MHR ${referenceStage.clip.duration.toFixed(2)}s and Mixamo ${avatarStage.clip.duration.toFixed(2)}s will not stay in step`);
  }

  refreshHelpers();
  placeCamera(view);
  seek(startTime);
  updateTransport();
  hideOverlay();
  lastLoad = {project, reference: referenceStage, avatar: avatarStage, errors};
  renderInfo();

  const loaded = [
    referenceStage ? `MHR ${referenceStage.clip.duration.toFixed(2)} s` : null,
    avatarStage ? `Mixamo ${avatarStage.clip.duration.toFixed(2)} s` : null,
  ].filter(Boolean).join(' · ');
  setStatus(
    `${project.title} · ${loaded}${errors.length ? ` · ${errors.join(' · ')}` : ''}`,
    errors.length ? 'warn' : 'ok',
  );
  syncUrl();
}

async function loadProjects(keepCurrent = false) {
  refreshButton.disabled = true;
  const previous = current;
  const previousTime = clipTime;
  setStatus('Loading projects…');
  showOverlay('Loading projects…');
  try {
    const [demo, library] = await Promise.all([
      getJson<LessonManifest>('/api/demo'),
      getJson<LessonManifest[]>('/api/lessons'),
    ]);
    libraryAvailable = Array.isArray(library);

    const lessons: Project[] = [];
    if (Array.isArray(library)) {
      for (const lesson of library) {
        if (lesson?.animation?.key) lessons.push(projectFromLesson(lesson));
      }
    }
    const demoProject = demo?.animation?.key ? projectFromDemo(demo) : null;
    projects = [...lessons, ...(demoProject ? [demoProject] : [])];
    renderProjectOptions();

    if (!projects.length) {
      setStatus('No projects could be loaded. Sign in to Form, then reload this page.', 'error');
      showOverlay('No projects could be loaded. Sign in to Form, then reload this page.', true);
      return;
    }

    const preferred = keepCurrent ? previous?.id : requestProject;
    const initial = projects.find(project => project.id === preferred)
      ?? lessons[0]
      ?? demoProject
      ?? projects[0];
    await loadProject(initial, {time: keepCurrent ? previousTime : requestTime});
    void annotateAvailability();
    if (!libraryAvailable && initial.source === 'demo'
      && lastLoad && lastLoad.reference && lastLoad.avatar && !lastLoad.errors.length) {
      setStatus(`${status.textContent} · Sign in to Form to compare your own projects.`, 'warn');
    }
  } catch (error) {
    setStatus(`Projects could not be loaded: ${messageOf(error)}`, 'error');
    showOverlay(`Projects could not be loaded: ${messageOf(error)}`, true);
  } finally {
    refreshButton.disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Controls

projectSelect.addEventListener('change', () => {
  const project = projects.find(item => item.id === projectSelect.value);
  if (!project) return;
  if (uploadedClipUrl) {
    URL.revokeObjectURL(uploadedClipUrl);
    uploadedClipUrl = null;
    uploadedName = '';
    clearUploadButton.hidden = true;
  }
  void loadProject(project, {time: 0});
});

avatarSelect.addEventListener('change', () => {
  avatarId = avatarSelect.value === 'female' ? 'female' : 'male';
  if (uploadedClipUrl) {
    URL.revokeObjectURL(uploadedClipUrl);
    uploadedClipUrl = null;
    uploadedName = '';
    clearUploadButton.hidden = true;
  }
  renderProjectOptions();
  if (current) void loadProject(current, {time: clipTime});
  syncUrl();
});

refreshButton.addEventListener('click', () => { void loadProjects(true); });

playButton.addEventListener('click', togglePlay);
stepBack.addEventListener('click', () => step(-1 / 30));
stepForward.addEventListener('click', () => step(1 / 30));

timeInput.addEventListener('input', () => {
  const requestedTime = Number(timeInput.value) || 0;
  playing = false;
  seek(requestedTime);
  updateTransport();
});
timeInput.addEventListener('change', syncUrl);

speedSelect.addEventListener('change', () => {
  speed = Number(speedSelect.value) || 1;
  syncUrl();
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => {
    const next = button.dataset.view ?? 'front';
    placeCamera(next);
    syncUrl();
  });
}

showSkeleton.addEventListener('change', () => {
  refreshHelpers();
});

showJoints.addEventListener('change', () => {
  applyJointVisibility();
});

showGround.addEventListener('change', () => {
  ground.visible = showGround.checked;
});

pinTravel.addEventListener('change', () => {
  seek(clipTime);
});

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files?.[0];
  if (!file || !current) return;
  if (uploadedClipUrl) URL.revokeObjectURL(uploadedClipUrl);
  uploadedClipUrl = URL.createObjectURL(file);
  uploadedName = file.name;
  clearUploadButton.hidden = false;
  setStatus(`Using uploaded clip ${file.name} with the project’s MHR reference.`, 'info');
  void loadProject(current, {time: clipTime});
});

clearUploadButton.addEventListener('click', () => {
  if (uploadedClipUrl) URL.revokeObjectURL(uploadedClipUrl);
  uploadedClipUrl = null;
  uploadedName = '';
  clearUploadButton.hidden = true;
  if (current) void loadProject(current, {time: clipTime});
});

window.addEventListener('keydown', event => {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag && /INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    step(-1 / 30);
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    step(1 / 30);
  }
});

window.addEventListener('beforeunload', () => {
  if (uploadedClipUrl) URL.revokeObjectURL(uploadedClipUrl);
});

const observer = new ResizeObserver(() => {
  const {width, height} = host.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  refitCamera();
});
observer.observe(host);

// Fail loudly in the lab rather than in a lesson: both profiles must validate.
for (const id of ['male', 'female'] as AvatarId[]) validateProfile(AVATAR_PROFILES[id]);

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const delta = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  controls.update();

  if (playing && duration > 0) {
    clipTime = Math.min(duration, clipTime + delta * speed);
    if (clipTime >= duration) {
      clipTime = duration;
      playing = false;
      updateTransport();
      syncUrl();
    }
    setStageTime(avatarStage, clipTime);
    setStageTime(referenceStage, clipTime);
    avatarStage?.scene.updateMatrixWorld(true);
    referenceStage?.scene.updateMatrixWorld(true);
    updateGroups();
    if (now - lastUi > 80) {
      updateTimeUi();
      updatePoseComparison();
      lastUi = now;
    }
  }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------------------------
// Start

placeCamera(view);
updateTransport();
renderInfo();
void loadProjects(false);
