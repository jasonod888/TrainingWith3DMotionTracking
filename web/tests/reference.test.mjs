import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
// Three's embedded buffer loader emits progress events even in this Node-only
// data test. No browser, renderer, or camera is involved.
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,values){this.type=type;Object.assign(this,values);}};
test('accepted GLB loads in Three.js, has a valid standing height, and can restart after completion',async()=>{
  const bytes=readFileSync(new URL('../dist/assets/reference.glb',import.meta.url));
  const reference=JSON.parse(readFileSync(new URL('../dist/assets/reference.json',import.meta.url)));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.ok(gltf.animations.length);assert.ok(Math.abs(gltf.animations[0].duration-reference.duration)<.001);
  assert.ok(gltf.scene.getObjectByName('l_wrist'),'Anatomical left hand label anchor');
  assert.ok(gltf.scene.getObjectByName('r_wrist'),'Anatomical right hand label anchor');
  const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(gltf.animations[0]);
  action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  mixer.setTime(reference.standingTime);gltf.scene.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(gltf.scene,true),height=box.max.y-box.min.y;
  assert.ok(height>1&&height<2.5,`Standing height ${height}`);
  mixer.setTime(reference.duration);action.paused=false;action.enabled=true;mixer.setTime(.5);
  assert.ok(Math.abs(action.time-.5)<1e-6);
});
