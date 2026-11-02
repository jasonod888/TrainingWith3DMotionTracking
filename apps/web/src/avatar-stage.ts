/**
 * Avatar controller: loads a prepared static avatar and its converted clip separately.
 *
 * The lesson viewer's clock stays authoritative; this module only turns an avatar id plus a
 * clip URL into a scene, a mixer and the bone references the stage needs. Nothing here
 * knows about lessons, scoring or camera framing.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  avatarAssetUrl, avatarProfile, validateProfile,
  type AvatarId, type AvatarProfile,
} from '../../../packages/avatar-rigs/index';

export type AvatarStage = {
  scene: THREE.Group;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  clip: THREE.AnimationClip;
  profile: AvatarProfile;
  /** Bone the viewer pins horizontally; resolved from the profile, never by name guess. */
  root: THREE.Object3D | null;
  hands: {left: THREE.Object3D | null; right: THREE.Object3D | null};
  /** Standing height and floor offset in the avatar's own units. */
  height: number;
  baseFoot: number;
};

export class AvatarUnavailable extends Error {}

// Captured at module load: the app's router rewrites the query string after mount, so
// reading location.search later loses the pilot override.
const REQUESTED_AVATAR = new URLSearchParams(location.search).get('instructor');

/** Which prepared avatar the viewer should use. Phase E replaces this with a real control. */
export function avatarRequested(): AvatarId {
  return REQUESTED_AVATAR === 'female' ? 'female' : 'male';
}

/**
 * Where a lesson's converted clip lives.
 *
 * Uploaded lessons keep their clips beside the lesson in storage, so the existing authorized
 * asset route serves them. The built-in demonstration has no database lesson and serves its
 * avatar clips from the demo fixture directory. A missing clip simply 404s and the viewer
 * keeps the canonical reference.
 */
export function pilotClipFor(
  lesson: {lesson_id: string; animation?: {key: string}},
  id: AvatarId,
): string {
  const key = lesson.animation?.key ?? '';
  if (key.startsWith('demo/')) return `/api/demo/assets/avatar-${id}.glb`;
  return `/api/lessons/${encodeURIComponent(lesson.lesson_id)}/assets/avatar-${id}.glb`;
}

function bone(model: THREE.Object3D, name: string | null): THREE.Object3D | null {
  return name ? model.getObjectByName(name) ?? null : null;
}

export async function loadAvatarStage(
  loader: GLTFLoader,
  id: AvatarId,
  clipUrl: string,
  expectedDuration?: number,
): Promise<AvatarStage> {
  const profile = avatarProfile(id);
  validateProfile(profile);

  const [avatarGltf, clipGltf] = await Promise.all([
    loader.loadAsync(avatarAssetUrl(id)),
    loader.loadAsync(clipUrl),
  ]);
  if (avatarGltf.animations.length) {
    throw new AvatarUnavailable('the prepared avatar must not carry clips');
  }
  const clip = clipGltf.animations[0];
  if (!clip) throw new AvatarUnavailable('the converted clip carries no animation');
  // The clip must belong to this lesson's animation. A stale or borrowed clip is worse than
  // showing the canonical reference, so a duration mismatch is a hard rejection.
  if (expectedDuration !== undefined && Math.abs(clip.duration - expectedDuration) > 0.1) {
    throw new AvatarUnavailable(
      `clip is ${clip.duration.toFixed(2)}s but the lesson is ${expectedDuration.toFixed(2)}s`);
  }

  const scene = avatarGltf.scene;
  // Tracks bind by node name, so an unresolved track means the wrong clip for this avatar.
  const missing = clip.tracks
    .map(track => track.name.split('.')[0])
    .filter(name => !scene.getObjectByName(name));
  if (missing.length) {
    throw new AvatarUnavailable(
      `clip tracks do not resolve on ${id}: ${[...new Set(missing)].slice(0, 5).join(', ')}`);
  }

  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  return {
    scene,
    mixer,
    action,
    clip,
    profile,
    root: bone(scene, profile.rig.root_bone),
    hands: {
      left: bone(scene, profile.landmarks.left_wrist?.bone ?? null),
      right: bone(scene, profile.landmarks.right_wrist?.bone ?? null),
    },
    height: profile.measurements.standing_height,
    baseFoot: profile.measurements.floor_y,
  };
}

/** Release instance-owned GPU resources. Cached geometry must not be passed here twice. */
export function disposeAvatarStage(stage: AvatarStage | null) {
  if (!stage) return;
  stage.mixer.stopAllAction();
  stage.mixer.uncacheRoot(stage.scene);
  stage.scene.traverse(node => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}
