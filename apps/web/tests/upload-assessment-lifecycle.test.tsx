import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React, {useRef} from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/upload.html',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window as unknown as Window & typeof globalThis,document:dom.window.document,
  File:dom.window.File,IS_REACT_ACT_ENVIRONMENT:true});
const {render, act, waitFor, cleanup}=await import('@testing-library/react');
const {useUploadAssessment}=await import('../src/music/useUploadAssessment.ts');
after(()=>{cleanup();dom.window.close();});

function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
type Api=ReturnType<typeof useUploadAssessment>;

function Harness({apiRef,decode,transcribe}:{apiRef:{current:Api|null};decode:any;transcribe:any}){
  const api=useUploadAssessment({expected:[{id:'n',onset:.5,pitch:60,optional:false}],target:{start:0,end:1},
    sections:[{id:'all',label:'All',start:0,end:1}],decode,transcribe});
  apiRef.current=api;
  return <p>{api.phase}</p>;
}

test('a stale upload decode cannot change a restarted upload run',async()=>{
  const apiRef:{current:Api|null}={current:null};
  const first=deferred<any>(),second=deferred<any>();
  const decodes=[first,second];let index=0;
  const decode=()=>decodes[index++].promise;
  const transcribe=async()=>({report:{score:null,reasons:[]},transcription:{attacks:[]}});
  const view=render(<Harness apiRef={apiRef} decode={decode} transcribe={transcribe}/>);
  const file=new dom.window.File(['x'],'a.wav',{type:'audio/wav'});
  await act(async()=>{void apiRef.current!.analyze(file);});
  assert.equal(apiRef.current!.phase,'decoding');
  await act(async()=>{apiRef.current!.cancel();});
  await act(async()=>{void apiRef.current!.analyze(file);});
  assert.equal(apiRef.current!.phase,'decoding');
  await act(async()=>{first.resolve({pcm:new Float32Array(10),sampleRate:22050,duration:1,channels:1,source:'audio-decode'});});
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(apiRef.current!.phase,'decoding');
  assert.equal(apiRef.current!.report,null);
  assert.equal(apiRef.current!.error,'');
  view.unmount();
});

test('a stale upload transcription rejection cannot fail a restarted upload run',async()=>{
  const apiRef:{current:Api|null}={current:null};
  const first=deferred<any>(),second=deferred<any>();
  const transcriptions=[first,second];let index=0;
  const decode=async()=>({pcm:new Float32Array(10),sampleRate:22050,duration:1,channels:1,source:'audio-decode'});
  const transcribe=()=>transcriptions[index++].promise;
  const view=render(<Harness apiRef={apiRef} decode={decode} transcribe={transcribe}/>);
  const file=new dom.window.File(['x'],'a.wav',{type:'audio/wav'});
  await act(async()=>{void apiRef.current!.analyze(file);});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'transcribing'),{timeout:1000});
  await act(async()=>{apiRef.current!.cancel();});
  await act(async()=>{void apiRef.current!.analyze(file);});
  await waitFor(()=>assert.equal(apiRef.current!.phase,'transcribing'),{timeout:1000});
  await act(async()=>{first.reject(new Error('old transcription failed'));});
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(apiRef.current!.phase,'transcribing');
  assert.equal(apiRef.current!.error,'');
  view.unmount();
});
