import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React, {useRef, useState} from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/listen-play.html',pretendToBeVisual:true});
const {window}=dom;
Object.assign(globalThis,{
  window:window as unknown as Window & typeof globalThis,
  document:window.document,
  location:window.location,
  HTMLElement:window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT:true,
});
globalThis.requestAnimationFrame=((callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),4)) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame=((id:number)=>clearTimeout(id)) as typeof cancelAnimationFrame;
Object.defineProperty(globalThis.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[]})}});
if(!window.matchMedia)window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});

const {render, act, waitFor, cleanup}=await import('@testing-library/react');
const {useListenPlay}=await import('../src/music/useListenPlay.ts');

after(()=>{cleanup();dom.window.close();});

type HookApi=ReturnType<typeof useListenPlay>;

function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}

function Harness({apiRef,baseline,microphone}:{
  apiRef:{current:HookApi|null};
  baseline:{current:((value:{id:string;start:number;end:number;completed:boolean;reason:string}|null)=>void)|null};
  microphone?:{capture:(options:unknown)=>Promise<{pcm:Float32Array;sampleRate:number;duration:number}>;
    transcribe:(input:unknown)=>Promise<{report:Record<string,unknown>;transcription:{attacks:unknown[]}}>};
}){
  const [lastAttempt,setLastAttempt]=useState<{id:string;start:number;end:number;completed:boolean;reason:string}|null>(null);
  baseline.current=setLastAttempt;
  const runtime=useRef({seek(){},start(){}}).current;
  const hook=useListenPlay({runtime:runtime as never,snapshot:null,lastAttempt,unit:{id:'s',label:'Section',start:0,end:.1},speed:1,
    expected:[{id:'n',onset:0,pitch:60,optional:false}],sections:[{id:'s',label:'Section',start:0,end:.1}],
    inputMode:microphone?'microphone':'midi',microphone:microphone as never,
    timing:{guardSeconds:0,countInSeconds:0,earlyStartSeconds:.2,lateStartSeconds:.2,tailSeconds:0}});
  apiRef.current=hook;
  return <p>{hook.phase}</p>;
}

test('listen-then-play captures a MIDI attack with a fitted whole-section offset and withholds the score',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const baseline:{current:((value:{id:string;start:number;end:number;completed:boolean;reason:string}|null)=>void)|null}={current:null};
  const view=render(<Harness apiRef={apiRef} baseline={baseline}/>);
  await act(async()=>{apiRef.current!.start();});
  assert.equal(apiRef.current!.phase,'listening');
  await act(async()=>{
    baseline.current!({id:'attempt-1',start:0,end:.1,completed:true,reason:'completed'});
  });
  await waitFor(()=>assert.equal(apiRef.current!.phase,'capturing'),{timeout:2000});
  await act(async()=>{apiRef.current!.recordAttack(60,performance.now()+200);});
  assert.equal(apiRef.current!.captured,1);
  await waitFor(()=>assert.equal(apiRef.current!.phase,'feedback'),{timeout:2000});
  const report=apiRef.current!.report!;
  assert.equal(report.matchedRequired,1);
  assert.equal(report.notes.find(note=>note.id==='n')?.status,'matched');
  assert.equal(report.score,null);
  assert.ok(report.reasons.includes('experimental-policy'));
  assert.ok(Math.abs(report.offsetSeconds)<=0.05,`offset ${report.offsetSeconds}`);
  view.unmount();
});

test('a stale microphone transcription cannot change a restarted listen-then-play run',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const baseline:{current:((value:{id:string;start:number;end:number;completed:boolean;reason:string}|null)=>void)|null}={current:null};
  const transcription=deferred<{report:Record<string,unknown>;transcription:{attacks:unknown[]}}>();
  const capture=async()=>({pcm:new Float32Array(100),sampleRate:22050,duration:.5});
  const view=render(<Harness apiRef={apiRef} baseline={baseline} microphone={{capture,transcribe:()=>transcription.promise}}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{baseline.current!({id:'attempt-mic',start:0,end:.1,completed:true,reason:'completed'});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'analyzing'),{timeout:2000});
  await act(async()=>{apiRef.current!.cancel('cancelled');});
  await act(async()=>{apiRef.current!.start();});
  assert.equal(apiRef.current!.phase,'listening');
  await act(async()=>{transcription.resolve({report:{score:null,matchedRequired:0,reasons:[]} as never,transcription:{attacks:[]}});});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(apiRef.current!.phase,'listening');
  assert.equal(apiRef.current!.report,null);
  assert.equal(apiRef.current!.error,'');
  view.unmount();
});

test('a rejected capture from a cancelled run cannot fail a new listen-then-play run',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const baseline:{current:((value:{id:string;start:number;end:number;completed:boolean;reason:string}|null)=>void)|null}={current:null};
  const capture=deferred<{pcm:Float32Array;sampleRate:number;duration:number}>();
  const view=render(<Harness apiRef={apiRef} baseline={baseline} microphone={{capture:()=>capture.promise,
    transcribe:async()=>({report:{score:null,reasons:[]} as never,transcription:{attacks:[]}})}}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{baseline.current!({id:'attempt-reject',start:0,end:.1,completed:true,reason:'completed'});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'analyzing'),{timeout:2000});
  await act(async()=>{apiRef.current!.cancel('cancelled');});
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{capture.reject(new Error('old capture failed'));});
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(apiRef.current!.phase,'listening');
  assert.equal(apiRef.current!.error,'');
  view.unmount();
});

test('cancelling an active listen-then-play run discards the capture',async()=>{
  const apiRef:{current:HookApi|null}={current:null};
  const baseline:{current:((value:{id:string;start:number;end:number;completed:boolean;reason:string}|null)=>void)|null}={current:null};
  const view=render(<Harness apiRef={apiRef} baseline={baseline}/>);
  await act(async()=>{apiRef.current!.start();});
  await act(async()=>{baseline.current!({id:'attempt-2',start:0,end:.1,completed:true,reason:'completed'});});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'capturing'),{timeout:2000});
  await act(async()=>{apiRef.current!.cancel('Stopped by the learner.');});
  assert.equal(apiRef.current!.phase,'idle');
  assert.equal(apiRef.current!.report,null);
  assert.match(apiRef.current!.error,/Stopped/);
  view.unmount();
});
