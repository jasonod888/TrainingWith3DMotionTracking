import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {Playback} from '../../../packages/learning-engine/playback';
import {assetUrl} from './api';
import {heightPlacement} from '../../../web/dist/pose.js';
import {placementForTransform} from './camera-framing';
import {compositeOffset} from '../../../web/dist/composite.js';
import {placeHandLabels} from '../../../web/dist/hand-labels.js';
import type {PracticeFraming} from './practice-types';
import {measureStandingRig} from './rig';
import {styleInstructor} from './instructor';
import {avatarRequested,disposeAvatarStage,loadAvatarStage,pilotClipFor} from './avatar-stage';
import {followHorizontal} from './camera-follow';
import {frameMotion} from './fixed-camera';
import {continuousPlayback} from './animation-sampling';
import {InstructorVideo} from './InstructorVideo';

export function MotionStage({lesson,player,source=false,companion=false,onVideoUnavailable,framing,immersive=false,locked=false,fit='none',interactive=true}:{lesson:LessonManifest;player:Playback;source?:boolean;companion?:boolean;onVideoUnavailable?:()=>void;framing?:PracticeFraming;immersive?:boolean;locked?:boolean;fit?:'none'|'envelope';interactive?:boolean}){
  const mount=useRef<HTMLDivElement>(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true);
  const framingRef=useRef(framing);framingRef.current=framing;
  const leftHand=useRef<HTMLSpanElement>(null),rightHand=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    if(source)return;
    const fitEnvelope=fit==='envelope';
    let disposed=false,frame=0;let renderer:THREE.WebGLRenderer|undefined,mixer:THREE.AnimationMixer|undefined,model:THREE.Group|undefined;
    const host=mount.current!;const scene=new THREE.Scene();const aligned=!!framing?.active;
    const camera=aligned?new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.01,100):new THREE.PerspectiveCamera(34,1,.01,100);
    camera.position.set(aligned?0:2.7,aligned?0:1.7,aligned?8:5);camera.lookAt(0,0,0);let controls:OrbitControls|undefined;
    const anchor=new THREE.Group();scene.add(anchor);
    scene.add(new THREE.HemisphereLight(0xf3f6ff,0x444039,1.5));
    const light=new THREE.DirectionalLight(0xfff4e5,2.6);light.position.set(3,5,4);scene.add(light);
    const rim=new THREE.DirectionalLight(0xc4d9ff,1.5);rim.position.set(-3,2,-2);scene.add(rim);
    // The floor has to carry orientation now: the instructor keeps its real travel and the
    // camera follows, so the ground is what shows which way it moved. A large grid, one
    // coloured axis per horizontal direction, and metre rings from the start point.
    const ground=new THREE.Group();ground.visible=!aligned;scene.add(ground);
    const grid=new THREE.GridHelper(40,40,0x5f8676,0x2b3d34);const gridMaterial=grid.material as THREE.Material;gridMaterial.transparent=true;gridMaterial.opacity=.5;ground.add(grid);
    const flat=(geometry:THREE.BufferGeometry,color:number,opacity:number)=>{const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.y=.002;ground.add(mesh);return mesh;};
    flat(new THREE.PlaneGeometry(40,.04),0x8a5a3c,.8);            // left/right axis
    flat(new THREE.PlaneGeometry(.04,40),0x3c6f8a,.8);            // forward/back axis
    flat(new THREE.RingGeometry(.30,.38,40),0xa8d8bf,.65);        // where the instructor started
    for(const radius of [1,2,3])flat(new THREE.RingGeometry(radius-.012,radius,64),0x6f9585,.22);
    let fitDistance=4;
    // This box includes real travel as well as poses. It is independent of playback time.
    let envelope:THREE.Box3|null=null;
    const applyFixedView=()=>{
      if(aligned||!fitEnvelope||!envelope||!controls||!(camera instanceof THREE.PerspectiveCamera))return;
      fitDistance=frameMotion(camera,controls.target,envelope)??fitDistance;
      controls.maxDistance=Math.max(9,fitDistance*3);controls.update();
    };
    const measureEnvelope=()=>{
      if(!fitEnvelope||!mixer||!model)return;
      const nodes:THREE.Object3D[]=[];
      model.traverse(node=>{if(node instanceof THREE.Bone||/head|neck|foot|toe|knee|hand|wrist|elbow|shoulder|hip|body_world/i.test(node.name))nodes.push(node);});
      if(!nodes.length)return;
      const box=new THREE.Box3(),point=new THREE.Vector3(),restore=mixer.time;
      // Check every exported frame, including the end, so a brief kick isn't missed.
      const samples=Math.ceil(lesson.duration*(lesson.frame_rate??15));
      for(let sample=0;sample<=samples;sample++){
        mixer.setTime((lesson.animation_start??0)+Math.min(lesson.duration,sample/(lesson.frame_rate??15)));
        anchor.position.x=0;anchor.position.z=0;
        model.updateWorldMatrix(true,true);
        for(const node of nodes){node.getWorldPosition(point);box.expandByPoint(point);}
      }
      mixer.setTime(restore);anchor.position.x=0;anchor.position.z=0;model.updateWorldMatrix(true,true);
      if(box.isEmpty()||!Number.isFinite(box.min.y))return;
      envelope=box.expandByScalar(.12);
      applyFixedView();
    };
    const observer=new ResizeObserver(()=>{if(renderer){const {width,height}=host.getBoundingClientRect();renderer.setSize(width,height,false);if(camera instanceof THREE.PerspectiveCamera){
      if(immersive){
        // Render the scene edge to edge, framing the body inside the clear area between overlays.
        const style=getComputedStyle(host),top=parseFloat(style.getPropertyValue('--mimic-stage-top'))||0,bottom=parseFloat(style.getPropertyValue('--mimic-stage-bottom'))||0,right=parseFloat(style.getPropertyValue('--mimic-stage-right'))||0;
        const usableWidth=Math.max(width-right,100),usableHeight=Math.max(height-top-bottom,100),aspect=usableWidth/usableHeight;
        fitDistance=Math.max(3.4,.95/(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*aspect));
        const direction=camera.position.clone().sub(controls?.target??new THREE.Vector3(0,.9,0)).normalize();camera.position.copy(direction.multiplyScalar(fitDistance).add(controls?.target??new THREE.Vector3(0,.9,0)));
        camera.setViewOffset(usableWidth,usableHeight,0,-top,width,height);
      }else camera.aspect=width/Math.max(height,1);
    }else{camera.left=-1.5*width/Math.max(height,1);camera.right=-camera.left;}camera.updateProjectionMatrix();applyFixedView();}});
    let root:THREE.Object3D|undefined,action:THREE.AnimationAction|undefined;
    let avatarHeight=1.8,baseFoot=0;const hands:Record<string,THREE.Object3D>={};const handPoint=new THREE.Vector3();const materials:THREE.MeshStandardMaterial[]=[];
    const rootPoint=new THREE.Vector3(),rootInverse=new THREE.Matrix4();
    // Camera follow: the instructor travels for real, the view keeps it framed.
    const followPoint=new THREE.Vector3(),lastFollow=new THREE.Vector3();let followReady=false;
    setLoading(true);setError('');
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
      renderer.domElement.setAttribute('aria-label','Interactive 3D movement reference. Drag to rotate; scroll or pinch to zoom.');renderer.domElement.setAttribute('role','img');
      host.append(renderer.domElement);controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,aligned?0:.9,0);controls.enableDamping=!fitEnvelope;controls.enablePan=false;controls.enabled=!aligned&&!locked&&interactive;controls.minDistance=2;controls.maxDistance=9;controls.maxPolarAngle=Math.PI*.53;controls.update();observer.observe(host);
      // A prepared avatar plus its converted clip replaces the canonical MHR reference when
      // the lesson has a recorded conversion of its own animation. Anything going wrong falls
      // back to the reference rather than leaving the stage empty, because the reference is
      // what scoring is built on.
      const loader=new GLTFLoader();
      const avatarId=avatarRequested();
      const clipUrl=pilotClipFor(lesson,avatarId);
      const attach=async()=>{
        if(clipUrl){
          try{
            const stage=await loadAvatarStage(loader,avatarId,clipUrl,lesson.animation_duration??lesson.duration);
            if(disposed){disposeAvatarStage(stage);return;}
            const scene=stage.scene;
            model=scene;anchor.add(scene);
            mixer=stage.mixer;action=stage.action;
            root=stage.root??undefined;
            if(stage.hands.left)hands.left=stage.hands.left;
            if(stage.hands.right)hands.right=stage.hands.right;
            avatarHeight=stage.height;baseFoot=stage.baseFoot;
            anchor.scale.setScalar(1.8/avatarHeight);
            anchor.position.y=-baseFoot*anchor.scale.y;
            mixer.setTime((lesson.animation_start??0)+lesson.standing_time);scene.updateMatrixWorld(true);
            for(const node of meshesOf(scene)){const material=node.material as THREE.MeshStandardMaterial;if(material&&aligned){material.transparent=true;material.needsUpdate=true;}if(material)materials.push(material);node.frustumCulled=false;}
            measureEnvelope();
            setLoading(false);return;
          }catch(error){console.warn('Prepared avatar unavailable; showing the canonical reference.',error);}
        }
        loader.load(assetUrl(lesson.animation.key),gltf=>{
          if(disposed){disposeModel(gltf.scene);return;}
          if(!gltf.animations[0]){setError('This reference has no animation.');setLoading(false);return;}
          model=gltf.scene;anchor.add(model);mixer=new THREE.AnimationMixer(model);action=mixer.clipAction(continuousPlayback(gltf.animations[0]));action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime((lesson.animation_start??0)+lesson.standing_time);model.updateMatrixWorld(true);
          materials.push(...styleInstructor(model,aligned));
          model.traverse(node=>{if(node.name==='body_world')root=node;if(node.name==='l_wrist')hands.left=node;if(node.name==='r_wrist')hands.right=node;if(node instanceof THREE.Mesh)node.frustumCulled=false;});
          try{const bounds=measureStandingRig(anchor,model);avatarHeight=bounds.height;baseFoot=bounds.baseFoot;anchor.scale.setScalar(1.8/avatarHeight);anchor.position.y=-baseFoot*anchor.scale.y;}catch{setError('The reference has invalid dimensions. Try the real instructor video.');setLoading(false);return;}
          measureEnvelope();
          setLoading(false);
        },undefined,()=>{if(!disposed){setLoading(false);setError('The 3D reference could not load. Try the real instructor video.');}});
      };
      void attach();
      let lastAngle:number|undefined,lastReset:number|undefined;
      const render=()=>{frame=requestAnimationFrame(render);const f=framingRef.current;let offset=0;
        if(aligned&&f){const w=host.clientWidth,h=host.clientHeight;let scale=3*.68/avatarHeight,floorY=-3*.36;if(f.calibration){const display=f.display?.current;const samePane=!!display&&Math.abs(display.paneWidth-w)<2&&Math.abs(display.paneHeight-h)<2;const placement=display&&samePane&&display.sourceWidth===f.videoWidth&&display.sourceHeight===f.videoHeight?placementForTransform(f.calibration,display,h,3,avatarHeight):heightPlacement(f.calibration,f.videoWidth,f.videoHeight,w,h,3,avatarHeight);scale=placement.scale;floorY=placement.floorY;}anchor.scale.set(f.mirrored!==f.mirrorReference?-scale:scale,scale,scale);anchor.position.y=floorY-baseFoot*scale;if(f.composite)offset=compositeOffset(f.position,f.videoWidth,f.videoHeight,w,h,3).worldX;for(const material of materials)material.opacity=f.opacity;}
        if(!aligned&&f){const scale=anchor.scale.y;anchor.scale.x=f.mirrorReference?-scale:scale;}
        if(f?.angle!==undefined&&(f.angle!==lastAngle||f.resetVersion!==lastReset)){
          lastAngle=f.angle;lastReset=f.resetVersion;
          const centre=fitEnvelope?controls?.target??new THREE.Vector3(0,.9,0):new THREE.Vector3(aligned?0:followPoint.x,aligned?0:.9,aligned?0:followPoint.z);
          const distance=aligned?8:fitEnvelope||immersive?fitDistance:4;
          camera.position.set(centre.x+Math.sin(f.angle)*distance,aligned?0:centre.y,centre.z+Math.cos(f.angle)*distance);
          camera.lookAt(centre);controls?.target.copy(centre);
          applyFixedView();
        }
        if(controls)controls.enabled=!aligned&&!locked&&interactive;
        if(mixer){if(action){action.paused=false;action.enabled=true;}mixer.setTime((lesson.animation_start??0)+(f?.active&&(f.calibrating||player.state.index<0)?lesson.standing_time:player.state.time));if(root&&model){
          // Update the whole subtree so the bone matrix and any inverse come from one frame.
          model.updateWorldMatrix(true,true);
          if(aligned){
            // Composited into the user's camera: the instructor must stay anchored to the
            // calibration, so horizontal root motion is cancelled here and only here.
            rootInverse.copy(model.matrixWorld).invert();
            rootPoint.setFromMatrixPosition(root.matrixWorld).applyMatrix4(rootInverse);
            anchor.position.x=offset-rootPoint.x*anchor.scale.x;
            anchor.position.z=-rootPoint.z*anchor.scale.z;
          }else{
            // Free viewing keeps the real travel; the camera follows it instead.
            anchor.position.x=offset;anchor.position.z=0;
            rootPoint.setFromMatrixPosition(root.matrixWorld);
          }
          followPoint.copy(rootPoint);
        }}
        if(!aligned&&!fitEnvelope&&root&&model&&controls){
          followHorizontal(camera,controls.target,followPoint,lastFollow,followReady);
          followReady=true;
        }else followReady=false;
        controls?.update();renderer?.render(scene,camera);
        if(aligned&&leftHand.current&&rightHand.current){const positions:Record<string,{x:number;y:number}|null>={left:null,right:null};for(const side of ['left','right']){if(hands[side]){hands[side].getWorldPosition(handPoint);handPoint.project(camera);if(Math.abs(handPoint.x)<=1&&Math.abs(handPoint.y)<=1&&Math.abs(handPoint.z)<=1)positions[side]={x:(handPoint.x+1)/2*host.clientWidth,y:(1-handPoint.y)/2*host.clientHeight};}}placeHandLabels({left:leftHand.current,right:rightHand.current},positions,host.clientWidth,host.clientHeight);}
      };render();
    }catch{setLoading(false);setError('3D is unavailable on this device. Try the real instructor video.');}
    return()=>{disposed=true;cancelAnimationFrame(frame);if(leftHand.current)leftHand.current.hidden=true;if(rightHand.current)rightHand.current.hidden=true;observer.disconnect();controls?.dispose();mixer?.stopAllAction();if(model){mixer?.uncacheRoot(model);disposeModel(model);}for(const child of ground.children){if(child instanceof THREE.Mesh||child instanceof THREE.LineSegments){child.geometry.dispose();disposeMaterial(child.material as THREE.Material);}}renderer?.dispose();renderer?.domElement.remove();};
  },[lesson,player,source,framing?.active,immersive,locked,fit,interactive]);
  return <div className={`motion-host ${companion&&!source?'has-companion':''}`}><div className="motion-render-area" hidden={source}><div className="motion-render" ref={mount}/></div>{source?<InstructorVideo lesson={lesson} player={player} mirrored={framing?.mirrorReference} onUnavailable={onVideoUnavailable}/>:companion&&lesson.source_video?<div className="instructor-video-inset" aria-label="Real instructor alongside 3D"><InstructorVideo lesson={lesson} player={player} mirrored={framing?.mirrorReference}/><span>Real instructor</span></div>:null}<span ref={leftHand} className="hand-label reference-hand" hidden>L</span><span ref={rightHand} className="hand-label reference-hand" hidden>R</span>{!source&&loading&&<div className="stage-message" role="status"><span className="loader"/>Loading your reference...</div>}{!source&&error&&<div className="stage-message" role="alert">{error}</div>}</div>;
}
function meshesOf(model:THREE.Object3D){const meshes:THREE.Mesh[]=[];model.traverse(node=>{if(node instanceof THREE.Mesh)meshes.push(node);});return meshes;}
function disposeMaterial(material:THREE.Material|THREE.Material[]){for(const m of Array.isArray(material)?material:[material])m.dispose();}
function disposeModel(model:THREE.Object3D){model.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();disposeMaterial(node.material);}});}
