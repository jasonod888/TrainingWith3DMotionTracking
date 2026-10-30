import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HeightCalibration,heightPlacement,videoFit,fromMediaPipe,bestMatch,MP,LINKS,clamp} from './pose.js';
import {liveHandPositions,placeHandLabels} from './hand-labels.js';
import {SectionSequence,defaultSegments,validateSegments} from './segments.js';
import {VoiceCommands} from './voice.js';
import {compositeOffset,suggestedAvatarPosition} from './composite.js';

const $=id=>document.getElementById(id);
const video=$('camera'),studentPane=$('studentPane'),referencePane=$('referencePane'),overlay=$('poseOverlay'),ctx=overlay.getContext('2d');
const calibration=new HeightCalibration();
let reference,mixer,clip,animationAction,avatar,bodyRoot,avatarHeight=1.7,baseFoot=0,stream,worker,trackerReady=false,inFlight=false,lastVideoTime=-1,lastSent=0,lastPoseAt=0,lastScoreAt=0;
let playing=false,started=false,time=0,speed=1,calibrating=false,locked=null,score=null,poseResult=null,sourceMode=null,sourceEpoch=0,videoDimensions='',calibrationTimer;
let sections,sectionStorageKey;
const sectionMode=()=>$('playbackMode').value==='sections';
const frustumHeight=3;
let avatarOffsetX=0;
const compositeMode=()=>$('viewMode').value==='composite';
const cameraMirrored=()=>sourceMode==='camera'&&$('facing').value==='user';
const scene=new THREE.Scene();
const camera=new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.01,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('avatar'),antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;}
catch(error){showNotice('3D rendering is unavailable in this browser. Try a browser with WebGL enabled.');}
scene.add(new THREE.HemisphereLight(0xe9fff7,0x203439,2.3));
const key=new THREE.DirectionalLight(0xe5fff4,3.5);key.position.set(2,4,5);scene.add(key);
const rim=new THREE.DirectionalLight(0xc7ef87,2);rim.position.set(-3,1,-2);scene.add(rim);
const anchor=new THREE.Group();scene.add(anchor);
// A soft contact cue, composited over the camera; it does not detect room depth.
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=64;
const shadowContext=shadowCanvas.getContext('2d');
const shadowGradient=shadowContext.createRadialGradient(64,32,0,64,32,32);shadowGradient.addColorStop(0,'rgba(0,0,0,.45)');shadowGradient.addColorStop(1,'rgba(0,0,0,0)');
shadowContext.save();shadowContext.translate(64,32);shadowContext.scale(2,1);shadowContext.translate(-64,-32);shadowContext.fillStyle=shadowGradient;shadowContext.fillRect(0,0,128,64);shadowContext.restore();
const groundShadow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,opacity:.75}));groundShadow.visible=false;scene.add(groundShadow);
const referenceHands={},handPosition=new THREE.Vector3();
const studentHandLabels={left:$('studentLeftHand'),right:$('studentRightHand')};
const referenceHandLabels={left:$('referenceLeftHand'),right:$('referenceRightHand')};
function hideStudentHands(){studentHandLabels.left.hidden=studentHandLabels.right.hidden=true;}
function drawReferenceHands(){
  const positions={};
  for(const side of ['left','right']){
    const bone=referenceHands[side];positions[side]=null;if(!bone)continue;
    bone.getWorldPosition(handPosition);handPosition.project(camera);
    if(handPosition.z< -1||handPosition.z>1||Math.abs(handPosition.x)>1||Math.abs(handPosition.y)>1)continue;
    positions[side]={x:(handPosition.x+1)/2*referencePane.clientWidth,y:(1-handPosition.y)/2*referencePane.clientHeight};
  }
  placeHandLabels(referenceHandLabels,positions,referencePane.clientWidth,referencePane.clientHeight);
}

function showNotice(message){$('notice').textContent=message;$('notice').hidden=!message;}
function setStatus(message){$('sessionState').textContent=message;}
const format=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function clearScore(message){score=null;lastScoreAt=0;poseResult=null;$('score').textContent='—';$('scoreStatus').textContent=message;$('scoreStatus').className='scorestatus';}
function setPlayback(value){playing=value;const atEnd=sectionMode()&&sections?.current&&time>=sections.current.end-.001;$('play').innerHTML=value?'Ⅱ <span>Pause lesson</span>':`▶ <span>${atEnd?'Replay move':started?'Continue':sectionMode()?'Start first section':'Start lesson'}</span>`;}
function updateSectionUI(){
  if(!sections)return;
  $('sectionLabel').textContent=sections.current?`${sections.index+1} / ${sections.segments.length} · ${sections.current.label}`:`${sections.segments.length} sections · Ready to start`;
  $('sectionHint').textContent=playing?'Follow this section. It will pause for you.':sections.current&&time>=sections.current.end-.001?'Hold this pose. Say “Next” when ready, or “Again” to replay.':'Say “Next” to play a section. “Back” goes to the previous one.';
}
function sectionCommand(command){
  if(command==='pause'){setPlayback(false);setStatus('Paused. Say “Again” to replay or “Next” to advance.');updateSectionUI();return;}
  if(!sections){setStatus('Wait for the reference to finish loading.');return;}
  if(calibrating){setStatus('Finish matching your height before starting a section.');return;}
  $('playbackMode').value='sections';const section=sections.command(command);
  if(!section){setPlayback(false);setStatus(time>=reference.duration?'Lesson complete. Say “Again” to replay the final section.':'This is the final section. Say “Again” to replay it.');updateSectionUI();return;}
  started=true;time=section.start;setPlayback(true);clearScore(locked?'Follow this move':'Match your height to score');setStatus(`${section.label} · playing`);updateSectionUI();
}
function persistSections(){
  try{localStorage.setItem(sectionStorageKey,JSON.stringify(sections.segments));$('editorStatus').textContent='Sections saved on this browser.';}
  catch{$('editorStatus').textContent='Sections updated for this session. Browser storage is unavailable.';}
}
function renderSegmentEditor(){
  const rows=$('segmentRows');rows.replaceChildren();
  sections.segments.forEach((section,i)=>{
    const row=document.createElement('div');row.className='segmentrow';
    const label=document.createElement('input');label.type='text';label.value=section.label;label.maxLength=80;label.setAttribute('aria-label',`Section ${i+1} name`);label.dataset.field='label';
    const start=document.createElement('span');start.textContent=`${section.start.toFixed(2)} →`;
    const end=document.createElement('input');end.type='number';end.step='0.01';end.min=section.start+.05;end.max=reference.duration;end.value=section.end.toFixed(6);end.dataset.field='end';end.setAttribute('aria-label',`Section ${i+1} end in seconds`);end.disabled=i===sections.segments.length-1;
    const merge=document.createElement('button');merge.className='textbutton';merge.textContent='Merge next';merge.disabled=i===sections.segments.length-1;merge.onclick=()=>{try{commitEditor(false);sections.mergeNext(i);sections.seek(time);persistSections();renderSegmentEditor();setPlayback(false);updateSectionUI();}catch(error){$('editorStatus').textContent=error.message;}};
    row.append(label,start,end,merge);rows.append(row);
  });
}
function commitEditor(save=true){
  let previous=0;const draft=[...$('segmentRows').children].map((row,i)=>{const end=i===sections.segments.length-1?reference.duration:Number(row.querySelector('[data-field="end"]').value);const s={label:row.querySelector('[data-field="label"]').value,start:previous,end};previous=end;return s;});
  sections.segments=validateSegments(draft,reference.duration);sections.seek(time);setPlayback(false);if(save){persistSections();renderSegmentEditor();updateSectionUI();}
}
const voice=new VoiceCommands({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,onCommand:command=>{sectionCommand(command);$('voiceStatus').textContent=`Listening · heard “${command}”`;},onState:state=>{$('voiceToggle').textContent=state==='off'?'Enable voice control':'Turn voice off';$('voiceToggle').setAttribute('aria-pressed',String(state!=='off'));$('voiceStatus').textContent=({off:'Voice off',starting:'Starting microphone…',listening:'● Listening for commands',reconnecting:'Reconnecting voice…'})[state];$('voiceStatus').className=state==='listening'?'listening':'';},onError:message=>{$('voiceStatus').textContent=message;}});
function invalidateHeight(message){locked=null;calibrating=false;calibration.reset();$('calibrationBanner').hidden=true;$('heightBadge').textContent='Original height';$('heightBadge').className='heightbadge';$('studentFloor').hidden=$('referenceFloor').hidden=true;clearScore(message??'Match your height to begin');applyPlacement();}
function enterCalibration(){
  if(!sourceMode||!trackerReady)return;
  clearTimeout(calibrationTimer);calibration.reset();calibrating=true;locked=null;started=false;time=0;setPlayback(false);clearScore('Matching your height…');
  if(sections)sections.index=-1;updateSectionUI();
  $('calibrationBanner').hidden=false;$('calibrationTitle').textContent='Let’s match your height.';$('calibrationMessage').textContent='Face the camera. Stand upright and hold still.';$('calibrationProgress').style.width='0%';
  $('heightBadge').textContent='Matching height…';$('heightBadge').className='heightbadge';$('studentFloor').hidden=$('referenceFloor').hidden=true;
  setStatus('Stand upright for calibration');applyPlacement();
}
function finishCalibration(value){
  locked=Object.freeze({...value});calibrating=false;$('calibrationTitle').textContent='Your height is matched.';$('calibrationMessage').textContent='Size is locked. You’re ready to move.';
  suggestAvatarPosition();
  $('heightBadge').textContent='↕ Height matched · locked';$('heightBadge').className='heightbadge locked';$('calibrate').textContent='↕ Recalibrate height';
  $('scoreStatus').textContent='Ready to practise';$('hint').textContent='Height is locked. Crouch, turn or kick — your reference keeps the same size.';
  setStatus(sourceMode==='demo'?'Demo calibration complete':'Height matched. Ready to move.');applyPlacement();
  calibrationTimer=setTimeout(()=>{$('calibrationBanner').hidden=true;},2400);
}
function applyPlacement(){
  if(!avatar)return;
  const w=referencePane.clientWidth,h=referencePane.clientHeight;
  let scale=frustumHeight*.68/avatarHeight,floorY=-frustumHeight*.36;
  if(locked&&video.videoWidth){
    const result=heightPlacement(locked,video.videoWidth,video.videoHeight,w,h,frustumHeight,avatarHeight);scale=result.scale;floorY=result.floorY;
    const fit=videoFit(video.videoWidth,video.videoHeight,studentPane.clientWidth,studentPane.clientHeight);
    $('studentFloor').style.top=`${fit.y+locked.floor*fit.height}px`;
    $('referenceFloor').style.top=`${(.5-floorY/frustumHeight)*h}px`;
    $('studentFloor').hidden=$('referenceFloor').hidden=false;
  }
  const previewMirrored=sourceMode==='camera'&&$('facing').value==='user';
  const reflect=previewMirrored!==$('mirrorReference').checked;
  anchor.scale.set(reflect?-scale:scale,scale,scale);
  anchor.position.y=floorY-baseFoot*scale;
  avatarOffsetX=compositeMode()?compositeOffset(Number($('avatarPosition').value)/100,video.videoWidth||16,video.videoHeight||9,w,h,frustumHeight).worldX:0;
  groundShadow.visible=compositeMode()&&!!sourceMode;
  groundShadow.position.set(avatarOffsetX,floorY-.01,-.1);groundShadow.scale.set(avatarHeight*scale*.48,avatarHeight*scale*.07,1);
}
function suggestAvatarPosition(){
  const fraction=suggestedAvatarPosition(locked,$('avatarSide').value,video.videoWidth||16,video.videoHeight||9,cameraMirrored());
  $('avatarPosition').value=Math.round(fraction*100);
  $('compositeHint').textContent=`Leave room on your ${$('avatarSide').value} for the avatar. Landscape works best.`;
  applyPlacement();
}
function setViewMode(){
  const composite=compositeMode();$('practiceStage').classList.toggle('composite',composite);$('practiceStage').setAttribute('aria-label',composite?'Camera composite movement practice':'Side-by-side movement practice');
  $('compositeControls').hidden=!composite;$('compositeHint').hidden=!composite;
  // Normalized calibration remains valid; both image fit and projection are
  // recomputed for the new layout without changing the user's stored height.
  resize();hideStudentHands();ctx.clearRect(0,0,studentPane.clientWidth,studentPane.clientHeight);
}
function resize(){
  if(renderer){const w=referencePane.clientWidth,h=referencePane.clientHeight;renderer.setSize(w,h,false);camera.left=-frustumHeight*w/h/2;camera.right=-camera.left;camera.top=frustumHeight/2;camera.bottom=-camera.top;camera.updateProjectionMatrix();}
  const ratio=Math.min(devicePixelRatio,2);overlay.width=Math.round(studentPane.clientWidth*ratio);overlay.height=Math.round(studentPane.clientHeight*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);applyPlacement();
}
new ResizeObserver(resize).observe(referencePane);
new ResizeObserver(resize).observe(studentPane);

async function loadReference(){
  try{
    const response=await fetch('./assets/reference.json');if(!response.ok)throw new Error('Reference data could not be loaded');reference=await response.json();
    const gltf=await new GLTFLoader().loadAsync('./assets/reference.glb');avatar=gltf.scene;anchor.add(avatar);clip=gltf.animations[0];
    if(!clip)throw new Error('The reference contains no animation');
    avatar.traverse(node=>{if(node.isMesh){node.material=new THREE.MeshStandardMaterial({color:0x8ed9c6,roughness:.47,metalness:.18,transparent:true,opacity:Number($('avatarOpacity').value)/100,side:THREE.DoubleSide});node.frustumCulled=false;}if(node.name==='body_world')bodyRoot=node;if(node.name==='l_wrist')referenceHands.left=node;if(node.name==='r_wrist')referenceHands.right=node;});
    mixer=new THREE.AnimationMixer(avatar);animationAction=mixer.clipAction(clip);animationAction.setLoop(THREE.LoopOnce,1);animationAction.clampWhenFinished=true;animationAction.play();
    mixer.setTime(reference.standingTime);avatar.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(avatar,true);avatarHeight=bounds.max.y-bounds.min.y;baseFoot=bounds.min.y;
    if(!Number.isFinite(avatarHeight)||avatarHeight<.3)throw new Error('Reference body height is invalid');
    sectionStorageKey=`form-sections-v1-${reference.duration}`;let saved;
    try{saved=JSON.parse(localStorage.getItem(sectionStorageKey));}catch{}
    try{sections=new SectionSequence(saved??defaultSegments(reference.duration),reference.duration);}catch{sections=new SectionSequence(defaultSegments(reference.duration),reference.duration);}
    renderSegmentEditor();updateSectionUI();
    for(const id of ['sectionBack','sectionAgain','sectionPause','sectionNext','splitSection','resetSections','saveSections'])$(id).disabled=false;
    $('voiceToggle').disabled=!voice.Recognition;if(!voice.Recognition)$('voiceStatus').textContent='Voice unavailable in this browser · buttons work normally';
    $('timeline').max=reference.duration;$('timeline').disabled=false;$('play').disabled=false;$('referenceLabel').textContent='Raw 3D animation';applyPlacement();resize();setPlayback(false);
    $('timeLabel').textContent=`0:00 / ${format(reference.duration)}`;
  }catch(error){$('referenceLabel').textContent='Reference unavailable';showNotice(`Could not load the lesson: ${error.message}`);}
}

function ensureTracker(){
  if(trackerReady)return Promise.resolve();
  if(worker?.initializing)return worker.initializing;
  worker?.terminate();worker=new Worker('./tracker-worker.js');
  worker.initializing=new Promise((resolve,reject)=>{
    let settled=false;
    const fail=message=>{if(!settled){settled=true;reject(new Error(message));}else showNotice(`Tracking stopped: ${message}`);trackerReady=false;inFlight=false;clearScore('Tracking unavailable');$('calibrate').disabled=true;};
    worker.onmessage=({data})=>{
      if(data.type==='ready'){settled=true;trackerReady=true;resolve();}
      if(data.type==='error')fail(data.message);
      if(data.type==='frame-error'){inFlight=false;clearScore('Tracking unclear');showNotice('The camera frame could not be tracked. Stop and restart the camera if this continues.');}
      if(data.type==='pose'){inFlight=false;if(data.epoch!==undefined&&data.epoch!==sourceEpoch)return;handlePose(data);}
    };
    worker.onerror=event=>fail(event.message||'The tracking worker could not start.');
    worker.postMessage({type:'init'});
  });
  return worker.initializing;
}
function stopSource(){
  sourceEpoch++;setPlayback(false);hideStudentHands();stream?.getTracks().forEach(track=>track.stop());stream=null;sourceMode=null;
  video.pause();video.srcObject=null;video.removeAttribute('src');video.load();video.classList.remove('mirrored');
  // Restart the worker on the next source so pending frames cannot cross cameras.
  worker?.terminate();worker=null;trackerReady=false;inFlight=false;lastVideoTime=-1;lastPoseAt=0;ctx.clearRect(0,0,overlay.width,overlay.height);
  $('cameraEmpty').hidden=false;$('cameraDot').className='statusdot';$('cameraLabel').textContent='Camera off';$('calibrate').disabled=true;$('stopCamera').hidden=true;$('startCamera').disabled=false;$('demoButton').disabled=false;
  $('trackingLabel').textContent='Front or back camera · Phone or TV';invalidateHeight();setStatus('Ready when you are');showNotice('');
}
async function startSource(mode){
  stopSource();const epoch=sourceEpoch;sourceMode=mode;lastVideoTime=-1;$('startCamera').disabled=true;$('demoButton').disabled=true;
  setStatus(mode==='demo'?'Loading demonstration test…':'Starting your camera…');
  try{
    if(mode==='camera'){
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs HTTPS on your phone. Open the HTTPS address shown by the local server.');
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:$('facing').value},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}});
      if(epoch!==sourceEpoch){stream.getTracks().forEach(t=>t.stop());return;}
      video.srcObject=stream;video.classList.toggle('mirrored',$('facing').value==='user');
      stream.getVideoTracks()[0].onended=()=>{stopSource();showNotice('The camera stopped. Start it again to continue.');};
    }else{
      video.src='./assets/demonstration.mp4';video.loop=true;video.currentTime=6;video.classList.remove('mirrored');
    }
    await video.play();if(epoch!==sourceEpoch)return;
    videoDimensions=`${video.videoWidth}x${video.videoHeight}`;$('cameraEmpty').hidden=true;$('cameraLabel').textContent=mode==='demo'?'Demo video · not live':$('facing').value==='user'?'Front camera':'Back camera';suggestAvatarPosition();resize();
    $('cameraDot').className='statusdot on';$('stopCamera').hidden=false;$('trackingLabel').textContent='Loading pose tracking…';
    await ensureTracker();if(epoch!==sourceEpoch)return;
    $('calibrate').disabled=false;$('trackingLabel').textContent='Step into view';$('hint').textContent=mode==='demo'?'Demo test uses the recorded instructor. Scores are not a live student assessment.':'Stand upright to match your height, then start the lesson.';
    enterCalibration();showNotice(mode==='demo'?'Demonstration mode: the recorded instructor is standing in for your camera. Use Start camera after stopping this test.':'');
  }catch(error){
    if(epoch!==sourceEpoch)return;stopSource();
    const message=error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser, then try again.':error.name==='NotFoundError'?'No camera was found on this device. Connect a camera or try the demonstration video.':error.message;
    showNotice(message);setStatus('Camera setup needs attention');
  }
}
function handlePose(data){
  if(!sourceMode)return;
  const {landmarks,world}=data;lastPoseAt=performance.now();ctx.clearRect(0,0,studentPane.clientWidth,studentPane.clientHeight);
  if(!landmarks||!world){hideStudentHands();clearScore('Tracking unclear');$('trackingLabel').textContent='Step back into view';if(calibrating){calibration.samples=[];$('calibrationProgress').style.width='0%';$('calibrationMessage').textContent='Step into view with your whole body visible.';}return;}
  placeHandLabels(studentHandLabels,liveHandPositions(landmarks,video.videoWidth,video.videoHeight,studentPane.clientWidth,studentPane.clientHeight,sourceMode==='camera'&&$('facing').value==='user'),studentPane.clientWidth,studentPane.clientHeight);
  if(calibrating){const result=calibration.sample(landmarks,world,performance.now());$('calibrationProgress').style.width=`${result.progress*100}%`;$('calibrationMessage').textContent=result.message;if(result.done)finishCalibration(result.value);}
  let match=null;
  if(locked&&reference){
    const student=fromMediaPipe(world,landmarks);
    match=bestMatch(student,reference,started?time:reference.standingTime,$('mirrorReference').checked,playing);
    if(match){const now=performance.now(),dt=lastScoreAt?(now-lastScoreAt)/1000:.2;score=score===null?match.score:score+(match.score-score)*(1-Math.exp(-dt/.4));lastScoreAt=now;poseResult=match;$('score').textContent=Math.round(score);$('scoreStatus').textContent=sourceMode==='demo'?'Demo pose match':score>=80?'Moving together':score>=55?'Keep following':'Find the reference pose';$('scoreStatus').className=`scorestatus ${score>=80?'good':''}`;}
    else clearScore('Tracking unclear');
  }
  const visible=Object.values(MP).filter(i=>(landmarks[i].visibility??0)>.6).length;
  $('trackingLabel').textContent=visible>=13?'Body tracked · '+(locked?'height locked':'ready to match height'):'Some joints are hidden';
  if($('showSkeleton').checked)drawSkeleton(landmarks,match?.joints);
}
function drawSkeleton(points,joints){
  const fit=videoFit(video.videoWidth,video.videoHeight,studentPane.clientWidth,studentPane.clientHeight);
  const mirrored=sourceMode==='camera'&&$('facing').value==='user';
  const xy=k=>{const p=points[MP[k]];return [fit.x+(mirrored?1-p.x:p.x)*fit.width,fit.y+p.y*fit.height];};
  for(const [a,b] of LINKS){if((points[MP[a]].visibility??0)<.6||(points[MP[b]].visibility??0)<.6)continue;const x=xy(a),y=xy(b);ctx.strokeStyle=joints?.[b]!==undefined&&joints[b]<55?'#ffc58a':'#c9f388';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...x);ctx.lineTo(...y);ctx.stroke();}
  for(const k of Object.keys(MP)){if((points[MP[k]].visibility??0)<.6)continue;ctx.fillStyle=joints?.[k]!==undefined&&joints[k]<55?'#ffb579':'#d8f7ac';ctx.beginPath();ctx.arc(...xy(k),3,0,Math.PI*2);ctx.fill();}
}
async function sendFrame(now){
  if(!sourceMode||!trackerReady||inFlight||video.readyState<2||video.currentTime===lastVideoTime||now-lastSent<70)return;
  const dimensions=`${video.videoWidth}x${video.videoHeight}`;
  if(dimensions!==videoDimensions){videoDimensions=dimensions;invalidateHeight('Camera view changed. Recalibrate.');showNotice('The camera view changed. Match your height again before practising.');}
  inFlight=true;lastSent=now;lastVideoTime=video.currentTime;const epoch=sourceEpoch;
  try{const bitmap=await createImageBitmap(video);if(epoch!==sourceEpoch||!worker){bitmap.close();inFlight=false;return;}worker.postMessage({type:'frame',bitmap,timestamp:now,epoch},[bitmap]);}
  catch(error){inFlight=false;clearScore('Tracking unclear');}
}
let previous=performance.now();
function animate(now){
  requestAnimationFrame(animate);const dt=Math.min((now-previous)/1000,.1);previous=now;
  if(playing&&reference){const end=sectionMode()&&sections?.current?sections.current.end:reference.duration;time=Math.min(end,time+dt*speed);if(time>=end){setPlayback(false);setStatus(sectionMode()?'Your turn. Say “Next”, “Back” or “Again”.':'Lesson complete. Ready for another round?');updateSectionUI();}}
  if(mixer){animationAction.paused=false;animationAction.enabled=true;mixer.setTime(started?time:reference.standingTime);if(bodyRoot){anchor.position.x=avatarOffsetX-bodyRoot.position.x*anchor.scale.x;anchor.position.z=-bodyRoot.position.z*anchor.scale.z;}}
  if(renderer){renderer.render(scene,camera);if(avatar)drawReferenceHands();}
  $('timeline').value=time;if(reference)$('timeLabel').textContent=`${format(time)} / ${format(reference.duration)}`;
  if(lastPoseAt&&now-lastPoseAt>900){hideStudentHands();clearScore('Tracking unclear');$('trackingLabel').textContent='Waiting for a clear camera frame';ctx.clearRect(0,0,studentPane.clientWidth,studentPane.clientHeight);}
  void sendFrame(now);
}
$('startCamera').onclick=()=>startSource('camera');$('demoButton').onclick=()=>startSource('demo');$('stopCamera').onclick=stopSource;$('calibrate').onclick=enterCalibration;
$('play').onclick=()=>{if(!reference||calibrating)return;if(sectionMode()){if(!started||!sections.current){sectionCommand('next');return;}if(!playing&&time>=sections.current.end-.001){sectionCommand('again');return;}}if(!started){started=true;time=0;}if(time>=reference.duration)time=0;setPlayback(!playing);setStatus(playing?'Follow the reference at your pace':'Lesson paused');updateSectionUI();};
$('restart').onclick=()=>{time=0;started=true;if(sections)sections.seek(0);setPlayback(false);updateSectionUI();clearScore(locked?'Match the paused pose':'Match your height to begin');};
$('timeline').oninput=event=>{started=true;time=Number(event.target.value);sections?.seek(time);setPlayback(false);updateSectionUI();clearScore(locked?'Match the paused pose':'Match your height to begin');};
$('playbackMode').onchange=()=>{sections?.seek(time);setPlayback(false);updateSectionUI();};
for(const [id,command] of [['sectionNext','next'],['sectionBack','back'],['sectionAgain','again'],['sectionPause','pause']])$(id).onclick=()=>sectionCommand(command);
$('voiceToggle').onclick=()=>{if(voice.enabled)voice.stop();else voice.start();};
$('segmentEditor').ontoggle=()=>{if($('segmentEditor').open){setPlayback(false);updateSectionUI();}};
$('saveSections').onclick=()=>{try{commitEditor();}catch(error){$('editorStatus').textContent=error.message;}};
$('splitSection').onclick=()=>{try{commitEditor(false);sections.split(time);persistSections();renderSegmentEditor();setPlayback(false);updateSectionUI();}catch(error){$('editorStatus').textContent=error.message;}};
$('resetSections').onclick=()=>{sections=new SectionSequence(defaultSegments(reference.duration),reference.duration);sections.seek(time);persistSections();renderSegmentEditor();setPlayback(false);updateSectionUI();};
$('speed').onchange=event=>{speed=Number(event.target.value);};
$('facing').onchange=()=>{if(sourceMode==='camera')startSource('camera');else applyPlacement();};
$('mirrorReference').onchange=()=>{applyPlacement();clearScore(locked?'Follow the mirrored reference':'Match your height to begin');};
$('viewMode').onchange=setViewMode;
$('avatarSide').onchange=suggestAvatarPosition;
$('avatarPosition').oninput=applyPlacement;
$('avatarOpacity').oninput=()=>avatar?.traverse(node=>{if(node.isMesh)node.material.opacity=Number($('avatarOpacity').value)/100;});
$('showSkeleton').onchange=()=>ctx.clearRect(0,0,studentPane.clientWidth,studentPane.clientHeight);
$('fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{showNotice('Fullscreen is not available here. You can still mirror this screen to your TV.');}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){voice.stop();setPlayback(false);clearScore(locked?'Practice paused':'Match your height to begin');}});
window.addEventListener('pagehide',()=>{voice.stop();stream?.getTracks().forEach(t=>t.stop());worker?.terminate();});
resize();void loadReference();requestAnimationFrame(animate);
