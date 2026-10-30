import * as THREE from 'three';

export function measureStandingRig(anchor:THREE.Group,model:THREE.Object3D){
 // Loading can finish after the display loop has already positioned the anchor.
 // Measure rig units independently of that provisional display transform.
 anchor.scale.setScalar(1);anchor.position.set(0,0,0);anchor.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(model,true);
 const height=bounds.max.y-bounds.min.y;
 if(!Number.isFinite(height)||height<=0)throw new Error('Invalid standing rig bounds.');
 return {height,baseFoot:bounds.min.y};
}
