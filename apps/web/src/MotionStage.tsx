import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {Playback} from '../../../packages/learning-engine/playback';
import {assetUrl} from './api';

export function MotionStage({lesson,player,source=false}:{lesson:LessonManifest;player:Playback;source?:boolean}){
  const mount=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{
    if(source)return;
    let disposed=false,frame=0;let renderer:THREE.WebGLRenderer|undefined,mixer:THREE.AnimationMixer|undefined,model:THREE.Group|undefined;
    const host=mount.current!;const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(34,1,.01,100);
    camera.position.set(2.7,1.7,5);let controls:OrbitControls|undefined;
    const anchor=new THREE.Group();scene.add(anchor);
    scene.add(new THREE.HemisphereLight(0xf6ffe9,0x23362d,3));
    const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(3,5,4);scene.add(light);
    const rim=new THREE.DirectionalLight(0xb8eeb6,2);rim.position.set(-3,2,-2);scene.add(rim);
    const grid=new THREE.GridHelper(12,24,0x44564c,0x283c32);scene.add(grid);
    const observer=new ResizeObserver(()=>{if(renderer){const {width,height}=host.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();}});
    let root:THREE.Object3D|undefined,action:THREE.AnimationAction|undefined;
    setLoading(true);setError('');
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label','Interactive 3D movement reference. Drag to rotate; scroll or pinch to zoom.');renderer.domElement.setAttribute('role','img');
      host.append(renderer.domElement);controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.9,0);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=2;controls.maxDistance=9;controls.maxPolarAngle=Math.PI*.53;controls.update();observer.observe(host);
      new GLTFLoader().load(assetUrl(lesson.animation.key),gltf=>{
        if(disposed){disposeModel(gltf.scene);return;}
        if(!gltf.animations[0]){setError('This reference has no animation.');setLoading(false);return;}
        model=gltf.scene;anchor.add(model);mixer=new THREE.AnimationMixer(model);action=mixer.clipAction(gltf.animations[0]);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(lesson.standing_time);model.updateMatrixWorld(true);
        model.traverse(node=>{if(node.name==='body_world')root=node;if(node instanceof THREE.Mesh){disposeMaterial(node.material);node.material=new THREE.MeshStandardMaterial({color:0xd7e3cc,roughness:.72,metalness:.04,side:THREE.DoubleSide});node.frustumCulled=false;}});
        const bounds=new THREE.Box3().setFromObject(model,true);const height=bounds.max.y-bounds.min.y;if(height>0){anchor.scale.setScalar(1.8/height);anchor.position.y=-bounds.min.y*anchor.scale.y;}
        setLoading(false);
      },undefined,()=>{if(!disposed){setLoading(false);setError('The 3D reference could not load. Try the original video.');}});
      const render=()=>{frame=requestAnimationFrame(render);if(mixer){if(action){action.paused=false;action.enabled=true;}mixer.setTime(player.state.time);if(root){anchor.position.x=-root.position.x*anchor.scale.x;anchor.position.z=-root.position.z*anchor.scale.z;}}controls?.update();renderer?.render(scene,camera);};render();
    }catch{setLoading(false);setError('3D is unavailable on this device. Try the original video.');}
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls?.dispose();mixer?.stopAllAction();if(model){mixer?.uncacheRoot(model);disposeModel(model);}grid.geometry.dispose();disposeMaterial(grid.material);renderer?.dispose();renderer?.domElement.remove();};
  },[lesson,player,source]);
  useEffect(()=>{
    if(!source)return;
    let frame=0;const sync=()=>{const v=video.current;if(v && v.readyState>=2){const target=lesson.source_start+player.state.time;if(Math.abs(v.currentTime-target)>.15)v.currentTime=target;v.playbackRate=player.state.speed;if(player.state.playing && v.paused)void v.play().catch(()=>{});if(!player.state.playing && !v.paused)v.pause();}frame=requestAnimationFrame(sync);};sync();return()=>{cancelAnimationFrame(frame);video.current?.pause();};
  },[source,player,lesson]);
  return <div className="motion-host" ref={mount}>{source&&lesson.source_video?<video ref={video} src={assetUrl(lesson.source_video.key)} muted playsInline preload="metadata" onLoadedMetadata={()=>{if(video.current)video.current.currentTime=lesson.source_start;}}/>:null}{!source&&loading&&<div className="stage-message" role="status"><span className="loader"/>Loading your reference…</div>}{!source&&error&&<div className="stage-message" role="alert">{error}</div>}</div>;
}
function disposeMaterial(material:THREE.Material|THREE.Material[]){for(const m of Array.isArray(material)?material:[material])m.dispose();}
function disposeModel(model:THREE.Object3D){model.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();disposeMaterial(node.material);}});}
