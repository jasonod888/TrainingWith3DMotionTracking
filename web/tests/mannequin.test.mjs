import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMannequin,updateMannequin} from '../dist/mannequin.js';
const joints=()=>Object.fromEntries(Object.entries({ls:[-.2,.5,0],rs:[.2,.5,0],lh:[-.13,0,0],rh:[.13,0,0],nose:[0,.75,0]}).map(([n,p])=>[n,{p,confidence:1}]));
test('mannequin has solid torso pelvis and head following 3D body orientation',()=>{
 const rig=new THREE.Group(),parts=createMannequin(rig,new THREE.MeshStandardMaterial());
 const original=joints();updateMannequin(parts,original,true);
 for(const part of Object.values(parts)){assert.equal(part.visible,true);assert.ok(part.scale.toArray().every(v=>v>0));}
 const rotated=joints();for(const j of Object.values(rotated)){const [x,y,z]=j.p;j.p=[z,y,-x];}
 updateMannequin(parts,rotated,true);
 const axis=new THREE.Vector3(1,0,0).applyQuaternion(parts.torso.quaternion);
 assert.ok(axis.distanceTo(new THREE.Vector3(0,0,-1))<1e-6);
});
test('uncertain body landmarks and skeleton mode hide mannequin surfaces',()=>{
 const parts=createMannequin(new THREE.Group(),new THREE.MeshStandardMaterial()),pose=joints();pose.lh.confidence=.2;
 updateMannequin(parts,pose,true);assert.equal(parts.torso.visible,false);assert.equal(parts.pelvis.visible,false);assert.equal(parts.head.visible,true);
 updateMannequin(parts,pose,false);assert.ok(Object.values(parts).every(p=>!p.visible));
});
