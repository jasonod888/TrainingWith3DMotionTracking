import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createMannequin,updateMannequin} from './mannequin.js';
import {JOINTS,EDGES,extractFrame,conditionFrames} from './motion-processing.js';
const $=id=>document.getElementById(id),video=$('source');
let reference,sam,mixer,samAction,samRoot,samAnchor,worker,pending,raw=[],motion=null,playing=false,clock=0,duration=0,start=0,busy=false,cancelled=false,bundled=true,objectURL,epoch=0;
const status=message=>$('status').textContent=message;
const up=new THREE.Vector3(0,1,0),v1=new THREE.Vector3(),v2=new THREE.Vector3();
function viewport(id){const renderer=new THREE.WebGLRenderer({canvas:$(id),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0e171c);const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x334455,3));const camera=new THREE.OrthographicCamera(-1.4,1.4,1.4,-1.4,.01,100);return {renderer,scene,camera};}
const samView=viewport('sam'),browserView=viewport('browser');
function setViews(){for(const view of [samView,browserView]){const width=view.renderer.domElement.clientWidth,height=view.renderer.domElement.clientHeight;view.renderer.setSize(width,height,false);view.camera.left=-1.4*width/height;view.camera.right=-view.camera.left;view.camera.position.set(...({front:[0,0,6],side:[6,0,0],top:[0,6,.001]})[$('view').value]);view.camera.lookAt(0,0,0);view.camera.updateProjectionMatrix();}}
new ResizeObserver(setViews).observe($('sam'));new ResizeObserver(setViews).observe($('browser'));$('view').onchange=setViews;
const rig=new THREE.Group(),dots={},limbs={};browserView.scene.add(rig);
const material=new THREE.MeshStandardMaterial({color:0x99e3be});
for(const name of Object.keys(JOINTS)){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.025,8,6),material);mesh.name=`joint_${name}`;rig.add(mesh);dots[name]=mesh;}
for(const [a,b] of EDGES){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1,8),material);mesh.name=`bone_${a}_${b}`;rig.add(mesh);limbs[b]=mesh;}
const bodyParts=createMannequin(rig,material);
function poseRig(joints){rig.visible=!!joints;if(!joints)return;for(const [name,node] of Object.entries(dots)){node.visible=joints[name].confidence>=.5;node.position.fromArray(joints[name].p);}for(const [a,b] of EDGES){const node=limbs[b];node.visible=joints[a].confidence>=.5&&joints[b].confidence>=.5;v1.fromArray(joints[a].p);v2.fromArray(joints[b].p).sub(v1);node.position.copy(v1).addScaledVector(v2,.5);node.scale.set(1,v2.length(),1);if(v2.length()>1e-6)node.quaternion.setFromUnitVectors(up,v2.normalize());}
 const solid=$('display').value==='mannequin';
 for(const [name,node] of Object.entries(dots)){const radius=['lw','rw'].includes(name)?.045:['la','ra'].includes(name)?.045:.055;node.scale.setScalar(solid?radius/.025:1);if(solid&&['nose','hips'].includes(name))node.visible=false;}
 for(const [a,b] of EDGES){const node=limbs[b];if(solid&&['hips','nose'].includes(a==='hips'?a:b)){node.visible=false;}const radius=['lk','rk'].includes(b)?.065:['la','ra'].includes(b)?.045:['le','re'].includes(b)?.045:.032;node.scale.x=node.scale.z=solid?radius/.012:1;}
 updateMannequin(bodyParts,joints,solid);
}
rig.visible=false;
function lockControls(value){busy=value;for(const id of ['file','demo','start','end','fps','convert'])$(id).disabled=value;$('cancel').disabled=!value;for(const id of ['play','seek','json','glb'])$(id).disabled=value||!motion;}
function rpc(message,transfer=[]){return new Promise((resolve,reject)=>{pending={resolve,reject};worker.postMessage(message,transfer);});}
function stopWorker(){worker?.terminate();worker=null;if(pending){pending.reject(new Error('Cancelled'));pending=null;}}
function seekVideo(time){return new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-time)<.00001&&video.readyState>=2){resolve();return;}const timer=setTimeout(()=>finish(new Error('Video seek timed out')),12000);function finish(error){clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);error?reject(error):resolve();}const done=()=>finish(),failed=()=>finish(new Error('Video could not be decoded'));video.addEventListener('seeked',done,{once:true});video.addEventListener('error',failed,{once:true});video.currentTime=time;});}
async function loadVideo(url,isBundled){epoch++;playing=false;motion=null;raw=[];rig.visible=false;bundled=isBundled;lockControls(true);$('cancel').disabled=true;status('Loading video…');try{await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('This video format could not be loaded'));video.src=url;video.load();});$('start').value=isBundled?reference.sourceStart:0;$('end').value=isBundled?reference.sourceStart+reference.duration:Math.min(video.duration,20);$('end').max=video.duration;$('samNote').textContent=isBundled?'Same source time · body-relative':'SAM unavailable for your uploaded video';samAnchor.visible=isBundled;status('Ready. Select Convert in browser.');}catch(e){status(e.message);}finally{lockControls(false);$('convert').disabled=video.readyState<2;}}
$('demo').onclick=()=>{if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}void loadVideo('./assets/demonstration.mp4',true);};
$('file').onchange=()=>{const file=$('file').files[0];if(!file)return;if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(file);void loadVideo(objectURL,false);};
$('cancel').onclick=()=>{cancelled=true;stopWorker();status('Cancelling…');};
$('convert').onclick=async()=>{
 const end=Number($('end').value),fps=Number($('fps').value);start=Number($('start').value);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>video.duration+.001||end-start>120){status('Choose a valid range up to 120 seconds within the video.');return;}
 playing=false;video.pause();motion=null;raw=[];cancelled=false;duration=end-start;clock=0;lockControls(true);const begun=performance.now();
 try{
  status('Loading MediaPipe Heavy…');worker=new Worker('./converter-worker.js');worker.onmessage=({data})=>{const request=pending;pending=null;if(data.type==='error')request?.reject(new Error(data.message));else request?.resolve(data);};worker.onerror=e=>{pending?.reject(new Error(e.message));pending=null;};
  const {delegate}=await rpc({type:'init'});const count=Math.ceil(duration*fps)+1;
  for(let i=0;i<count;i++){
   if(cancelled)throw new Error('Cancelled');const t=Math.min(i/fps,duration-.0001);await seekVideo(start+t);if(cancelled)throw new Error('Cancelled');
   const bitmap=await createImageBitmap(video);const r=await rpc({type:'frame',bitmap,timestamp:(i+1)*1000/fps},[bitmap]);
   raw.push({time:t,joints:extractFrame(r.world,r.image)});status(`Converting on ${delegate} · ${i+1} / ${count} frames (${Math.round((i+1)/count*100)}%)`);
  }
  const conditioned=conditionFrames(raw);motion={version:1,model:'MediaPipe Pose Landmarker Heavy float16 v1',source:bundled?'bundled demonstration':$('file').files[0]?.name,sourceStart:start,duration,fps,axes:'x-right/y-up/z-toward-viewer; hip-relative; estimated metres',rootTravel:false,footContactCorrection:false,smoothing:{alpha:.65},boneLengths:conditioned.lengths,rawFrames:raw,frames:conditioned.frames};
  const missing=raw.filter(f=>!f.joints).length;status(`Complete · ${raw.length} samples · ${missing} missing poses · ${((performance.now()-begun)/1000).toFixed(1)} seconds processing. Inspect turns and feet in all views.`);$('seek').max=duration;clock=0;await seekVideo(start);showFrame();
 }catch(e){motion=null;rig.visible=false;status(cancelled?'Conversion cancelled. No partial export retained.':`Conversion failed: ${e.message}`);}finally{stopWorker();lockControls(false);}
};
function showFrame(){if(!motion)return;const index=Math.min(motion.frames.length-1,Math.round(clock*motion.fps));const frame=motion.frames[index];poseRig(frame.joints);$('frameNote').textContent=frame.joints?`${Object.values(frame.joints).filter(j=>j.confidence>=.5).length} / ${Object.keys(JOINTS).length} joints visible · hip-relative`:'No pose detected at this time';$('seek').value=clock;$('time').textContent=`${clock.toFixed(2)} / ${duration.toFixed(2)} s`;}
$('display').onchange=showFrame;
$('seek').oninput=()=>{playing=false;video.pause();clock=Number($('seek').value);video.currentTime=start+clock;showFrame();$('play').textContent='Play comparison';};
$('play').onclick=async()=>{if(playing){playing=false;video.pause();}else{if(clock>=duration-.02){clock=0;await seekVideo(start);}try{await video.play();playing=true;}catch(e){status(e.message);}}$('play').textContent=playing?'Pause':'Play comparison';};
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('json').onclick=()=>download(JSON.stringify(motion),'browser-motion.json','application/json');
$('glb').onclick=async()=>{
 $('glb').disabled=true;playing=false;video.pause();
 try{
  const tracks=[],times=motion.frames.map(f=>f.time),values={};
  for(const node of rig.children)values[node.name]={position:[],quaternion:[],scale:[]};
  for(const frame of motion.frames){poseRig(frame.joints);for(const node of rig.children){const v=values[node.name];v.position.push(...node.position.toArray());v.quaternion.push(...node.quaternion.toArray());v.scale.push(...(frame.joints&&node.visible?node.scale.toArray():[0,0,0]));}}
  for(const [name,data] of Object.entries(values)){tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`,times,data.position),new THREE.QuaternionKeyframeTrack(`${name}.quaternion`,times,data.quaternion),new THREE.VectorKeyframeTrack(`${name}.scale`,times,data.scale,THREE.InterpolateDiscrete));}
  const clip=new THREE.AnimationClip('Browser motion',-1,tracks);rig.visible=true;const result=await new GLTFExporter().parseAsync(rig,{binary:true,animations:[clip],onlyVisible:false});download(result,$('display').value==='mannequin'?'browser-mannequin.glb':'browser-skeleton.glb','model/gltf-binary');status('3D GLB downloaded. This is a generic joint-driven model without reconstructed appearance or root travel.');
 }catch(e){status(`GLB export failed: ${e.message}`);}finally{$('glb').disabled=false;showFrame();}
};
function animate(){requestAnimationFrame(animate);if(playing){clock=Math.max(0,Math.min(duration,video.currentTime-start));if(clock>=duration-.01||video.ended){playing=false;video.pause();$('play').textContent='Play comparison';}showFrame();}if(mixer&&samAnchor.visible){samAction.paused=false;samAction.enabled=true;const samTime=motion?start+clock-reference.sourceStart:reference.standingTime;mixer.setTime(Math.max(0,Math.min(reference.duration,samTime)));if(samRoot){samAnchor.position.x=-samRoot.position.x;samAnchor.position.y=-samRoot.position.y;samAnchor.position.z=-samRoot.position.z;}}samView.renderer.render(samView.scene,samView.camera);browserView.renderer.render(browserView.scene,browserView.camera);}
async function init(){try{reference=await(await fetch('./assets/reference.json')).json();const gltf=await new GLTFLoader().loadAsync('./assets/reference.glb');sam=gltf.scene;samAnchor=new THREE.Group();samAnchor.add(sam);samView.scene.add(samAnchor);sam.traverse(node=>{if(node.name==='body_world')samRoot=node;});mixer=new THREE.AnimationMixer(sam);samAction=mixer.clipAction(gltf.animations[0]);samAction.setLoop(THREE.LoopOnce,1);samAction.clampWhenFinished=true;samAction.play();setViews();animate();await loadVideo('./assets/demonstration.mp4',true);}catch(e){status(`Could not initialize comparison: ${e.message}`);}}
window.addEventListener('pagehide',()=>{cancelled=true;stopWorker();video.pause();if(objectURL)URL.revokeObjectURL(objectURL);});void init();
