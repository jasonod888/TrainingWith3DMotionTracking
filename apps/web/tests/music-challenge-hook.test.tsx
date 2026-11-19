import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React, {useRef, useState} from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/challenge.html',pretendToBeVisual:true});
const {window}=dom;
Object.assign(globalThis,{window:window as unknown as Window & typeof globalThis,document:window.document,location:window.location,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
globalThis.requestAnimationFrame=((callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),4)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame=((id:number)=>clearTimeout(id)) as typeof cancelAnimationFrame;
Object.defineProperty(globalThis.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[]})}});
if(!window.matchMedia)window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});

const {render, act, waitFor, cleanup}=await import('@testing-library/react');
const {useMusicChallenge}=await import('../src/music/useMusicChallenge.ts');

after(()=>{cleanup();dom.window.close();});

type Snapshot={status:string;time:number;buffering:boolean;rate:number};
type HookApi=ReturnType<typeof useMusicChallenge>;

function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}

function Harness({apiRef,controls,guards={lateStartSeconds:0,tailSeconds:0},microphone}:{
  apiRef:{current:HookApi|null};
  controls:{current:{snapshot:(value:Snapshot)=>void;attempt:(value:{id:string;start:number;end:number;completed:boolean;reason:string})=>void}|null};
  guards?:{lateStartSeconds:number;tailSeconds:number};
  microphone?:{capture:(options:unknown)=>Promise<{pcm:Float32Array;sampleRate:number;duration:number}>;
    transcribe:(input:unknown)=>Promise<{report:Record<string,unknown>;transcription:{attacks:unknown[]}}>};
}){
  const [snapshot,setSnapshot]=useState<Snapshot>({status:'idle',time:0,buffering:false,rate:1});
  const [lastAttempt,setLastAttempt]=useState<{id:string;start:number;end:number;completed:boolean;reason:string}|null>(null);
  const snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
  controls.current={snapshot:setSnapshot,attempt:setLastAttempt};
  const runtime=useRef({pause(){},setMode(){},setRate(){},seek(){},start(){},observe:()=>({...snapshotRef.current})}).current;
  const hook=useMusicChallenge({runtime:runtime as never,snapshot:snapshot as never,lastAttempt,duration:1,
    expected:[{id:'n',onset:.5,pitch:60,optional:false}],sections:[{id:'all',label:'All',start:0,end:1}],
    midiConnected:!microphone,inputMode:microphone?'microphone':'midi',microphone:microphone as never,
    countdownSeconds:0,...guards});
  apiRef.current=hook;
  return <p>{hook.phase}</p>;
}

test('whole-piece challenge captures MIDI, fits one offset and withholds the score',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const controls:{current:{snapshot:(value:Snapshot)=>void;attempt:(value:{id:string;start:number;end:number;completed:boolean;reason:string})=>void}|null}={current:null};
  const view=render(<Harness apiRef={apiRef} controls={controls}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{controls.current!.snapshot({status:'playing',time:.5,buffering:false,rate:1});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'capturing'),{timeout:1000});
  await act(async()=>{apiRef.current!.recordAttack(60,performance.now()+500);});
  assert.equal(apiRef.current!.captured,1);
  await act(async()=>{controls.current!.attempt({id:'challenge-attempt',start:0,end:1,completed:true,reason:'completed'});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'feedback'),{timeout:1000});
  const report=apiRef.current!.report!;
  assert.equal(report.score,null);
  assert.equal(report.matchedRequired,1);
  assert.ok(report.reasons.includes('experimental-policy'));
  assert.equal(report.speed,1);
  view.unmount();
});

test('the live capture tail keeps accepting late attacks after the guide ends',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const controls:{current:{snapshot:(value:Snapshot)=>void;attempt:(value:{id:string;start:number;end:number;completed:boolean;reason:string})=>void}|null}={current:null};
  const view=render(<Harness apiRef={apiRef} controls={controls} guards={{lateStartSeconds:0,tailSeconds:.4}}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{controls.current!.snapshot({status:'playing',time:.9,buffering:false,rate:1});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'capturing'),{timeout:1000});
  await act(async()=>{controls.current!.attempt({id:'challenge-tail',start:0,end:1,completed:true,reason:'completed'});});
  assert.equal(apiRef.current!.phase,'capturing','the capture tail must remain open');
  await act(async()=>{apiRef.current!.recordAttack(60,performance.now()+100);});
  assert.ok(apiRef.current!.captured>=1);
  await waitFor(()=>assert.equal(apiRef.current!.phase,'feedback'),{timeout:2000});
  view.unmount();
});

test('a stale challenge transcription cannot change a restarted challenge',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const controls:{current:{snapshot:(value:Snapshot)=>void;attempt:(value:{id:string;start:number;end:number;completed:boolean;reason:string})=>void}|null}={current:null};
  const transcription=deferred<{report:Record<string,unknown>;transcription:{attacks:unknown[]}}>();
  const capture=async()=>({pcm:new Float32Array(100),sampleRate:22050,duration:1});
  const view=render(<Harness apiRef={apiRef} controls={controls} microphone={{capture,transcribe:()=>transcription.promise}}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{controls.current!.snapshot({status:'playing',time:0,buffering:false,rate:1});});
  await act(async()=>{controls.current!.attempt({id:'mic-old',start:0,end:1,completed:true,reason:'completed'});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'analyzing'),{timeout:3000});
  await act(async()=>{apiRef.current!.cancel('cancelled');});
  await act(async()=>{apiRef.current!.start();});
  assert.equal(apiRef.current!.phase,'countdown');
  await act(async()=>{transcription.resolve({report:{score:null,matchedRequired:0,reasons:[]} as never,transcription:{attacks:[]}});});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(apiRef.current!.phase,'countdown');
  assert.equal(apiRef.current!.report,null);
  assert.equal(apiRef.current!.error,'');
  view.unmount();
});

test('a rejected capture from a cancelled challenge cannot fail the new challenge',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const controls:{current:{snapshot:(value:Snapshot)=>void;attempt:(value:{id:string;start:number;end:number;completed:boolean;reason:string})=>void}|null}={current:null};
  const capture=deferred<{pcm:Float32Array;sampleRate:number;duration:number}>();
  const view=render(<Harness apiRef={apiRef} controls={controls} microphone={{capture:()=>capture.promise,
    transcribe:async()=>({report:{score:null,reasons:[]} as never,transcription:{attacks:[]}})}}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{controls.current!.snapshot({status:'playing',time:0,buffering:false,rate:1});});
  await act(async()=>{controls.current!.attempt({id:'mic-reject',start:0,end:1,completed:true,reason:'completed'});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'analyzing'),{timeout:3000});
  await act(async()=>{apiRef.current!.cancel('cancelled');});
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{capture.reject(new Error('old capture failed'));});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(apiRef.current!.phase,'countdown');
  assert.equal(apiRef.current!.error,'');
  view.unmount();
});

test('a stopped whole-piece challenge is discarded',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const controls:{current:{snapshot:(value:Snapshot)=>void;attempt:(value:{id:string;start:number;end:number;completed:boolean;reason:string})=>void}|null}={current:null};
  const view=render(<Harness apiRef={apiRef} controls={controls}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{controls.current!.snapshot({status:'playing',time:.2,buffering:false,rate:1});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'capturing'),{timeout:1000});
  await act(async()=>{apiRef.current!.cancel('Stopped.');});
  assert.equal(apiRef.current!.phase,'idle');
  assert.equal(apiRef.current!.report,null);
  assert.equal(apiRef.current!.active,false);
  view.unmount();
});
