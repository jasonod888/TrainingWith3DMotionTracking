import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Vector3} from '../../apps/web/node_modules/three/build/three.module.js';
import {OrbitControls} from '../../apps/web/node_modules/three/examples/jsm/controls/OrbitControls.js';
import {followHorizontal} from '../../apps/web/src/camera-follow';

test('following translates camera and target together, including the first pose and seeks',()=>{
  const camera=new PerspectiveCamera();camera.position.set(0,1,4);
  const controls=new OrbitControls(camera,null);controls.target.set(0,.9,0);controls.update();
  const offset=camera.position.clone().sub(controls.target),previous=new Vector3();
  followHorizontal(camera,controls.target,new Vector3(3,2,-1),previous,false);controls.update();
  assert.ok(camera.position.clone().sub(controls.target).distanceTo(offset)<1e-9);
  followHorizontal(camera,controls.target,new Vector3(-2,0,7),previous,true);controls.update();
  assert.ok(camera.position.clone().sub(controls.target).distanceTo(offset)<1e-9);
  assert.equal(controls.target.x,-2);assert.equal(controls.target.z,7);
});
