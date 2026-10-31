import * as THREE from 'three';

/** Shape the native MHR reference as one athletic human mesh.
 * Only bind-space surface positions and colors change; motion and skin weights
 * remain intact. No clothing or accessory meshes are created.
 */
export function styleInstructor(model:THREE.Object3D,transparent=false):THREE.MeshStandardMaterial[]{
 const materials:THREE.MeshStandardMaterial[]=[];
 model.traverse(node=>{
  if(!(node instanceof THREE.SkinnedMesh))return;
  const mesh=node,skeleton=mesh.skeleton;
  const bone=(name:string)=>skeleton.bones.findIndex(b=>b.name===name);
  const required=['root','c_head',...['l','r'].flatMap(s=>['uparm','lowarm','wrist','upleg','lowleg','foot'].map(n=>`${s}_${n}`))];
  if(required.some(n=>bone(n)<0))return;
  // Attached meshes update bindMatrixInverse with camera display transforms.
  // The immutable bind matrix is the coordinate system used by the source skin.
  const inverseBind=mesh.bindMatrix.clone().invert();
  const rest=(name:string)=>new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[bone(name)].clone().invert()).applyMatrix4(inverseBind);
  const height=rest('c_head').y/1.537;
  if(!Number.isFinite(height)||height<=0)return;
  const segments=['l','r'].flatMap(side=>[
   {a:rest(`${side}_uparm`),b:rest(`${side}_lowarm`),pattern:`${side}_uparm`,strength:.12},
   {a:rest(`${side}_lowarm`),b:rest(`${side}_wrist`),pattern:`${side}_lowarm`,strength:.06},
   {a:rest(`${side}_upleg`),b:rest(`${side}_lowleg`),pattern:`${side}_upleg`,strength:-.06},
   {a:rest(`${side}_lowleg`),b:rest(`${side}_foot`),pattern:`${side}_lowleg`,strength:.06},
  ]);
  const geometry=mesh.geometry,positions=geometry.getAttribute('position');
  const weights=geometry.getAttribute('skinWeight'),joints=geometry.getAttribute('skinIndex');
  const colors:number[]=[],skin=new THREE.Color(0xb98462),hair=new THREE.Color(0x28211f);
  const p=new THREE.Vector3(),along=new THREE.Vector3(),radial=new THREE.Vector3();
  for(let i=0;i<positions.count;i++){
   p.fromBufferAttribute(positions,i);const x=p.x/height,y=p.y/height,z=p.z/height;
   let dominant=0;for(let k=1;k<4;k++)if(weights.getComponent(i,k)>weights.getComponent(i,dominant))dominant=k;
   const name=skeleton.bones[joints.getComponent(i,dominant)]?.name??'';
   const segment=segments.find(s=>name.startsWith(s.pattern));
   if(segment){
    along.subVectors(segment.b,segment.a);
    const t=THREE.MathUtils.clamp(radial.subVectors(p,segment.a).dot(along)/along.lengthSq(),0,1);
    radial.copy(p).sub(segment.a).addScaledVector(along,-t);
    p.addScaledVector(radial,segment.strength*Math.sin(Math.PI*t));
   }else if(y>.85&&y<1.46&&!/wrist|finger|thumb|index|middle|ring|pinky/.test(name)){
    // Broader upper chest and shoulders, with a lean waist and narrower hips.
    const chest=Math.exp(-Math.pow((y-1.34)/.12,2));
    const waist=Math.exp(-Math.pow((y-1.07)/.15,2));
    const hips=Math.exp(-Math.pow((y-.92)/.09,2));
    const edge=THREE.MathUtils.smoothstep(y,.85,.94)*(1-THREE.MathUtils.smoothstep(y,1.40,1.46));
    p.x*=1+edge*(.10*chest-.11*waist-.07*hips);
    p.z*=1+edge*(.06*chest-(z>0?.22:.08)*waist-.07*hips);
   }
   positions.setXYZ(i,p.x,p.y,p.z);
   const hairline=1.635+(z>.055?(z-.055)*.65:0);
   const color=skin.clone().lerp(hair,THREE.MathUtils.smoothstep(y,hairline-.006,hairline+.006));
   if(/[lr]_eye$/.test(name)){
    const eye=rest(name).divideScalar(height),iris=Math.hypot(x-eye.x,y-eye.y);
    color.set(iris<.0055?0x493c2b:0xe7e3da);if(iris<.0027)color.set(0x161a1c);
   }
   const browY=1.646-.08*Math.abs(Math.abs(x)-.032);
   if(z>.104&&Math.abs(Math.abs(x)-.032)<.017&&Math.abs(y-browY)<.0035)color.lerp(hair,.8);
   colors.push(color.r,color.g,color.b);
  }
  positions.needsUpdate=true;geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({name:'Athletic human instructor',color:0xffffff,vertexColors:true,roughness:.86,transparent});
  for(const old of Array.isArray(mesh.material)?mesh.material:[mesh.material])old.dispose();
  geometry.clearGroups();mesh.material=material;mesh.frustumCulled=false;materials.push(material);
 });
 return materials;
}
