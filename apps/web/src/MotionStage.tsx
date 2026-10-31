import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {Playback} from '../../../packages/learning-engine/playback';
import {assetUrl} from './api';
import {heightPlacement} from '../../../web/dist/pose.js';
import {compositeOffset} from '../../../web/dist/composite.js';
import {placeHandLabels} from '../../../web/dist/hand-labels.js';
import type {PracticeFraming} from './practice-types';
import {measureStandingRig} from './rig';
import {styleInstructor} from './instructor';

export function MotionStage({lesson,player,source=false,framing,immersive=false,locked=false}:{lesson:LessonManifest;player:Playback;source?:boolean;framing?:PracticeFraming;immersive?:boolean;locked?:boolean}){
  const mount=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true);
  const framingRef=useRef(framing);framingRef.current=framing;
  const leftHand=useRef<HTMLSpanElement>(null),rightHand=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    if(source)return;
    let disposed=false,frame=0;let renderer:THREE.WebGLRenderer|undefined,mixer:THREE.AnimationMixer|undefined,model:THREE.Group|undefined;
    const host=mount.current!;const scene=new THREE.Scene();const aligned=!!framing?.active;
    const camera=aligned?new THREE.OrthographicCamera(-1.5,1.5,1.5,-1.5,.01,100):new THREE.PerspectiveCamera(34,1,.01,100);
    camera.position.set(aligned?0:2.7,aligned?0:1.7,aligned?8:5);camera.lookAt(0,0,0);let controls:OrbitControls|undefined;
    const anchor=new THREE.Group();scene.add(anchor);
    scene.add(new THREE.HemisphereLight(0xf3f6ff,0x444039,1.5));
    const light=new THREE.DirectionalLight(0xfff4e5,2.6);light.position.set(3,5,4);scene.add(light);
    const rim=new THREE.DirectionalLight(0xc4d9ff,1.5);rim.position.set(-3,2,-2);scene.add(rim);
    const grid=new THREE.GridHelper(12,24,0x44564c,0x283c32);grid.visible=!aligned;scene.add(grid);
    let fitDistance=4;
    const observer=new ResizeObserver(()=>{if(renderer){const {width,height}=host.getBoundingClientRect();renderer.setSize(width,height,false);if(camera instanceof THREE.PerspectiveCamera){
      if(immersive){
        // Render the scene edge to edge, framing the body inside the clear area between overlays.
        const style=getComputedStyle(host),top=parseFloat(style.getPropertyValue('--mimic-stage-top'))||0,bottom=parseFloat(style.getPropertyValue('--mimic-stage-bottom'))||0,right=parseFloat(style.getPropertyValue('--mimic-stage-right'))||0;
        const usableWidth=Math.max(width-right,100),usableHeight=Math.max(height-top-bottom,100),aspect=usableWidth/usableHeight;
        fitDistance=Math.max(3.4,.95/(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*aspect));
        const direction=camera.position.clone().sub(controls?.target??new THREE.Vector3(0,.9,0)).normalize();camera.position.copy(direction.multiplyScalar(fitDistance).add(controls?.target??new THREE.Vector3(0,.9,0)));
        camera.setViewOffset(usableWidth,usableHeight,0,-top,width,height);
      }else camera.aspect=width/Math.max(height,1);
    }else{camera.left=-1.5*width/Math.max(height,1);camera.right=-camera.left;}camera.updateProjectionMatrix();}});
    let root:THREE.Object3D|undefined,action:THREE.AnimationAction|undefined;
    let avatarHeight=1.8,baseFoot=0;const hands:Record<string,THREE.Object3D>={};const handPoint=new THREE.Vector3();const materials:THREE.MeshStandardMaterial[]=[];
    setLoading(true);setError('');
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
      renderer.domElement.setAttribute('aria-label','Interactive 3D movement reference. Drag to rotate; scroll or pinch to zoom.');renderer.domElement.setAttribute('role','img');
      host.append(renderer.domElement);controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,aligned?0:.9,0);controls.enableDamping=true;controls.enablePan=false;controls.enabled=!aligned&&!locked;controls.minDistance=2;controls.maxDistance=9;controls.maxPolarAngle=Math.PI*.53;controls.update();observer.observe(host);
      new GLTFLoader().load(assetUrl(lesson.animation.key),gltf=>{
        if(disposed){disposeModel(gltf.scene);return;}
        if(!gltf.animations[0]){setError('This reference has no animation.');setLoading(false);return;}
        model=gltf.scene;anchor.add(model);mixer=new THREE.AnimationMixer(model);action=mixer.clipAction(gltf.animations[0]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(lesson.standing_time);model.updateMatrixWorld(true);
        materials.push(...styleInstructor(model,aligned));
        model.traverse(node=>{if(node.name==='body_world')root=node;if(node.name==='l_wrist')hands.left=node;if(node.name==='r_wrist')hands.right=node;if(node instanceof THREE.Mesh)node.frustumCulled=false;});
        try{const bounds=measureStandingRig(anchor,model);avatarHeight=bounds.height;baseFoot=bounds.baseFoot;anchor.scale.setScalar(1.8/avatarHeight);anchor.position.y=-baseFoot*anchor.scale.y;}catch{setError('The reference has invalid dimensions. Try the original video.');setLoading(false);return;}
        setLoading(false);
      },undefined,()=>{if(!disposed){setLoading(false);setError('The 3D reference could not load. Try the original video.');}});
      let lastAngle:number|undefined,lastReset:number|undefined;
      const render=()=>{frame=requestAnimationFrame(render);const f=framingRef.current;let offset=0;
        if(aligned&&f){const w=host.clientWidth,h=host.clientHeight;let scale=3*.68/avatarHeight,floorY=-3*.36;if(f.calibration){const placement=heightPlacement(f.calibration,f.videoWidth,f.videoHeight,w,h,3,avatarHeight);scale=placement.scale;floorY=placement.floorY;}anchor.scale.set(f.mirrored!==f.mirrorReference?-scale:scale,scale,scale);anchor.position.y=floorY-baseFoot*scale;if(f.composite)offset=compositeOffset(f.position,f.videoWidth,f.videoHeight,w,h,3).worldX;for(const material of materials)material.opacity=f.opacity;}
        if(!aligned&&f){const scale=anchor.scale.y;anchor.scale.x=f.mirrorReference?-scale:scale;}
        if(f?.angle!==undefined&&(f.angle!==lastAngle||f.resetVersion!==lastReset)){lastAngle=f.angle;lastReset=f.resetVersion;const yaw=f.angle,distance=aligned?8:immersive?fitDistance:4;camera.position.set(Math.sin(yaw)*distance,aligned?0:1,Math.cos(yaw)*distance);camera.lookAt(0,aligned?0:.9,0);}if(controls)controls.enabled=!aligned&&!locked;
        if(mixer){if(action){action.paused=false;action.enabled=true;}mixer.setTime(f?.active&&(f.calibrating||player.state.index<0)?lesson.standing_time:player.state.time);if(root){anchor.position.x=offset-root.position.x*anchor.scale.x;anchor.position.z=-root.position.z*anchor.scale.z;}}controls?.update();renderer?.render(scene,camera);
        if(aligned&&leftHand.current&&rightHand.current){const positions:Record<string,{x:number;y:number}|null>={left:null,right:null};for(const side of ['left','right']){if(hands[side]){hands[side].getWorldPosition(handPoint);handPoint.project(camera);if(Math.abs(handPoint.x)<=1&&Math.abs(handPoint.y)<=1&&Math.abs(handPoint.z)<=1)positions[side]={x:(handPoint.x+1)/2*host.clientWidth,y:(1-handPoint.y)/2*host.clientHeight};}}placeHandLabels({left:leftHand.current,right:rightHand.current},positions,host.clientWidth,host.clientHeight);}
      };render();
    }catch{setLoading(false);setError('3D is unavailable on this device. Try the original video.');}
    return()=>{disposed=true;cancelAnimationFrame(frame);if(leftHand.current)leftHand.current.hidden=true;if(rightHand.current)rightHand.current.hidden=true;observer.disconnect();controls?.dispose();mixer?.stopAllAction();if(model){mixer?.uncacheRoot(model);disposeModel(model);}grid.geometry.dispose();disposeMaterial(grid.material);renderer?.dispose();renderer?.domElement.remove();};
  },[lesson,player,source,framing?.active,immersive,locked]);
  useEffect(()=>{
    if(!source)return;
    let frame=0;const sync=()=>{const v=video.current;if(v && v.readyState>=2){const target=lesson.source_start+player.state.time;if(Math.abs(v.currentTime-target)>.15)v.currentTime=target;v.playbackRate=player.state.speed;if(player.state.playing && v.paused)void v.play().catch(()=>{});if(!player.state.playing && !v.paused)v.pause();}frame=requestAnimationFrame(sync);};sync();return()=>{cancelAnimationFrame(frame);video.current?.pause();};
  },[source,player,lesson]);
  return <div className="motion-host" ref={mount}>{source&&lesson.source_video?<video ref={video} src={assetUrl(lesson.source_video.key)} muted playsInline preload="metadata" onLoadedMetadata={()=>{if(video.current)video.current.currentTime=lesson.source_start;}}/>:null}<span ref={leftHand} className="hand-label reference-hand" hidden>L</span><span ref={rightHand} className="hand-label reference-hand" hidden>R</span>{!source&&loading&&<div className="stage-message" role="status"><span className="loader"/>Loading your reference...</div>}{!source&&error&&<div className="stage-message" role="alert">{error}</div>}</div>;
}
function disposeMaterial(material:THREE.Material|THREE.Material[]){for(const m of Array.isArray(material)?material:[material])m.dispose();}
function disposeModel(model:THREE.Object3D){model.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();disposeMaterial(node.material);}});}
