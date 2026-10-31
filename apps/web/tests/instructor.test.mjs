import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {styleInstructor} from '../src/instructor.ts';
import {measureStandingRig} from '../src/rig.ts';

globalThis.ProgressEvent??=class ProgressEvent{constructor(type,values){this.type=type;Object.assign(this,values);}};
async function load(path){const b=readFileSync(path);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const meshes=model=>{const result=[];model.traverse(n=>{if(n.isSkinnedMesh)result.push(n);});return result;};

test('unrelated rigs retain their geometry and original material',async()=>{
 const gltf=await load(new URL('../../../packages/lesson-schema/synthetic.glb',import.meta.url));
 const mesh=meshes(gltf.scene)[0],geometry=mesh.geometry,material=mesh.material,positions=Array.from(geometry.attributes.position.array);
 assert.deepEqual(styleInstructor(gltf.scene),[]);
 assert.equal(mesh.material,material);assert.equal(mesh.geometry,geometry);
 assert.deepEqual(Array.from(geometry.attributes.position.array),positions);
});

// Native motion assets are generated locally and are not bundled in fresh checkouts.
const native=new URL('../../../web/dist/assets/reference.glb',import.meta.url);
test('athletic instructor stays a single human mesh and preserves the captured animation',{skip:!existsSync(native)},async()=>{
 const gltf=await load(native),before=meshes(gltf.scene),body=before[0];
 const weights=Array.from(body.geometry.attributes.skinWeight.array),joints=Array.from(body.geometry.attributes.skinIndex.array);
 const positions=Array.from(body.geometry.attributes.position.array),indices=Array.from(body.geometry.index.array);
 const animations=JSON.stringify(gltf.animations.map(a=>a.toJSON()));
 const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(gltf.animations[0]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const times=[0,5,12.8,20,31.264597,42],poses=[];
 for(const t of times){action.paused=false;action.enabled=true;mixer.setTime(t);gltf.scene.updateMatrixWorld(true);poses.push(body.skeleton.bones.map(b=>b.matrixWorld.toArray()));}
 const materials=styleInstructor(gltf.scene,true);
 assert.deepEqual(meshes(gltf.scene),before,'no clothing or accessory meshes are added');
 assert.equal(materials.length,1);assert.ok(materials[0].transparent);
 assert.equal(body.geometry.attributes.position.count,positions.length/3,'no extra topology');
 assert.deepEqual(Array.from(body.geometry.index.array),indices);
 assert.deepEqual(Array.from(body.geometry.attributes.skinWeight.array),weights);
 assert.deepEqual(Array.from(body.geometry.attributes.skinIndex.array),joints);
 assert.equal(JSON.stringify(gltf.animations.map(a=>a.toJSON())),animations);
 let maxChange=0;for(let i=0;i<positions.length;i++)maxChange=Math.max(maxChange,Math.abs(positions[i]-body.geometry.attributes.position.array[i]));
 assert.ok(maxChange>.01&&maxChange<.06,'shape is visibly leaner without large surface displacements');
 const point=new THREE.Vector3();let sample=0;
 for(const t of times){
  action.paused=false;action.enabled=true;mixer.setTime(t);gltf.scene.updateMatrixWorld(true);
  assert.deepEqual(body.skeleton.bones.map(b=>b.matrixWorld.toArray()),poses[sample++]);
  for(let i=0;i<body.geometry.attributes.position.count;i++){point.fromBufferAttribute(body.geometry.attributes.position,i);body.applyBoneTransform(i,point);assert.ok(point.toArray().every(Number.isFinite));}
 }
});

test('camera loading, placement and mirroring cannot distort the human mesh',{skip:!existsSync(native)},async()=>{
 const styled=async(scale,position)=>{
  const gltf=await load(native),anchor=new THREE.Group();anchor.add(gltf.scene);anchor.scale.fromArray(scale);anchor.position.fromArray(position);
  const mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();mixer.setTime(31.264597);anchor.updateMatrixWorld(true);
  styleInstructor(gltf.scene,true);
  return {body:meshes(gltf.scene)[0],bounds:measureStandingRig(anchor,gltf.scene)};
 };
 const baseline=await styled([1,1,1],[0,0,0]);
 for(const [scale,position] of [[[-1.133333,1.133333,1.133333],[.6,-1.08,-.2]],[[3,3,3],[-2,-4,1]]]){
  const view=await styled(scale,position);
  for(const name of ['position','color','skinIndex','skinWeight'])assert.deepEqual(Array.from(view.body.geometry.getAttribute(name).array),Array.from(baseline.body.geometry.getAttribute(name).array),`${name} stays independent of camera placement`);
  assert.deepEqual(view.bounds,baseline.bounds);
 }
});
