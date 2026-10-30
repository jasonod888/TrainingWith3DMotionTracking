import * as THREE from 'three';
// Solid diagnostic mannequin driven by estimated landmarks, not a recovered mesh.
export function createMannequin(rig,material){
 const parts={};
 for(const name of ['torso','pelvis','head']){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),material);mesh.name=`body_${name}`;rig.add(mesh);parts[name]=mesh;}
 return parts;
}
export function updateMannequin(parts,joints,enabled){
 for(const part of Object.values(parts))part.visible=false;
 if(!enabled||!joints)return;
 const good=(...names)=>names.every(n=>joints[n]?.confidence>=.5);
 const point=n=>new THREE.Vector3().fromArray(joints[n].p);
 if(good('ls','rs','lh','rh')){
  const shoulders=point('ls').add(point('rs')).multiplyScalar(.5),hips=point('lh').add(point('rh')).multiplyScalar(.5);
  const y=shoulders.clone().sub(hips),height=y.length();y.normalize();
  const x=point('rs').sub(point('ls'));x.addScaledVector(y,-x.dot(y)).normalize();
  const z=new THREE.Vector3().crossVectors(x,y).normalize();
  const orientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
  const width=point('rs').distanceTo(point('ls'));
  parts.torso.visible=true;parts.torso.position.copy(hips).lerp(shoulders,.58);parts.torso.quaternion.copy(orientation);parts.torso.scale.set(Math.max(.08,width*.56),Math.max(.1,height*.62),Math.max(.065,width*.3));
  parts.pelvis.visible=true;parts.pelvis.position.copy(hips);parts.pelvis.quaternion.copy(orientation);parts.pelvis.scale.set(Math.max(.08,point('lh').distanceTo(point('rh'))*.72),.13,Math.max(.07,width*.29));
 }
 if(good('ls','rs','nose')){
  const shoulders=point('ls').add(point('rs')).multiplyScalar(.5),direction=point('nose').sub(shoulders);
  parts.head.visible=true;parts.head.position.copy(shoulders).addScaledVector(direction,.92);parts.head.scale.set(.095,.125,.1);
  if(direction.lengthSq()>1e-6)parts.head.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
 }
}
