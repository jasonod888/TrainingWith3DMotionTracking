import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {measureStandingRig} from '../src/rig.ts';
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,values){this.type=type;Object.assign(this,values);}};
test('original synthetic rig parses, animates, holds an end pose, and restarts',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../packages/lesson-schema/fixture.json',import.meta.url),'utf8'));
 const bytes=readFileSync(new URL('../../../packages/lesson-schema/synthetic.glb',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.animation.sha256);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 assert.equal(gltf.animations[0].duration,fixture.duration);
 const mesh=gltf.scene.getObjectByName('synthetic-triangle');assert.equal(mesh.isSkinnedMesh,true);assert.equal(mesh.skeleton.bones.length,2);
 const mixer=new THREE.AnimationMixer(gltf.scene);const action=mixer.clipAction(gltf.animations[0]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(1);
 const arm=gltf.scene.getObjectByName('arm');assert.ok(Math.abs(arm.quaternion.z-Math.SQRT1_2)<1e-6);
 mixer.setTime(2);assert.ok(Math.abs(arm.quaternion.z)<1e-6);
 action.paused=false;action.enabled=true;mixer.setTime(1);assert.ok(Math.abs(arm.quaternion.z-Math.SQRT1_2)<1e-6);
});

test('camera display transforms applied during loading do not alter standing height or floor',async()=>{
 const bytes=readFileSync(new URL('../../../packages/lesson-schema/synthetic.glb',import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const expected=new THREE.Box3().setFromObject(gltf.scene,true);
 const anchor=new THREE.Group();anchor.scale.set(-3,3,3);anchor.position.set(8,-4,2);anchor.add(gltf.scene);anchor.updateMatrixWorld(true);
 const measured=measureStandingRig(anchor,gltf.scene);
 assert.ok(Math.abs(measured.height-(expected.max.y-expected.min.y))<1e-6);
 assert.ok(Math.abs(measured.baseFoot-expected.min.y)<1e-6);
});
