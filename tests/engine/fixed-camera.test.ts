import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,PerspectiveCamera,Vector3} from '../../apps/web/node_modules/three/build/three.module.js';
import {OrbitControls} from '../../apps/web/node_modules/three/examples/jsm/controls/OrbitControls.js';
import {frameMotion} from '../../apps/web/src/fixed-camera';

for(const aspect of [.55,1,2.8])test(`fixed overview contains the full motion at aspect ${aspect}`,()=>{
 const camera=new PerspectiveCamera(34,aspect,.01,100);camera.position.set(2.7,1.7,5);
 const controls=new OrbitControls(camera,null);controls.enableDamping=false;controls.target.set(0,.9,0);controls.update();
 const box=new Box3(new Vector3(-1.1,-.1,-2.2),new Vector3(2.6,2.7,1.2));
 frameMotion(camera,controls.target,box);controls.update();camera.updateMatrixWorld(true);
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  const projected=new Vector3(x,y,z).project(camera);
  assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1,projected.toArray().join(','));
 }
 const eye=camera.position.clone(),target=controls.target.clone(),quaternion=camera.quaternion.clone();
 for(let frame=0;frame<735;frame++){
  // OrbitControls runs during playback, but its fixed target must not drift.
  controls.update();
  assert.ok(camera.position.distanceTo(eye)<1e-10);
  assert.ok(controls.target.distanceTo(target)<1e-10);
  assert.ok(camera.quaternion.angleTo(quaternion)<1e-7);
 }
 const before=camera.position.distanceTo(controls.target);
 frameMotion(camera,controls.target,box);controls.update();
 assert.ok(Math.abs(camera.position.distanceTo(controls.target)-before)<1e-9,'fitting twice must not zoom or recenter again');
});
