import {Box3,MathUtils,PerspectiveCamera,Vector3} from 'three';

/** Fit the whole motion once. Playback must never move the camera or its target. */
export function frameMotion(camera:PerspectiveCamera,target:Vector3,bounds:Box3,padding=1.15){
 if(bounds.isEmpty())return;
 const direction=camera.position.clone().sub(target).normalize();
 if(direction.lengthSq()<.5)direction.set(0,0,1);
 const right=new Vector3().crossVectors(camera.up,direction).normalize();
 const up=new Vector3().crossVectors(direction,right).normalize();
 const centre=bounds.getCenter(new Vector3()),point=new Vector3();
 const tan=Math.tan(MathUtils.degToRad(camera.fov/2));
 let distance=2;
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  point.set(x,y,z).sub(centre);
  const depth=point.dot(direction);
  distance=Math.max(distance,depth+Math.abs(point.dot(right))*padding/(tan*camera.aspect),depth+Math.abs(point.dot(up))*padding/tan);
 }
 target.copy(centre);
 camera.position.copy(direction.multiplyScalar(distance).add(centre));
 camera.lookAt(centre);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 return distance;
}
