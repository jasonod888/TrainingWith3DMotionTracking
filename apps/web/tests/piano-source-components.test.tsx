import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
const {render,cleanup,renderHook,waitFor}=await import('@testing-library/react');
const {DraftNotePreview}=await import('../src/music/DraftNotePreview');
const {PianoNoteRoll}=await import('../src/music/PianoNoteRoll');
const {usePianoSourcePlayer}=await import('../src/music/usePianoSourcePlayer');
const {usePianoPreviewAsset}=await import('../src/music/usePianoPreviewAsset');
afterEach(cleanup);

test('review keyboard follows supplied source time without its own audition, with all 1200 notes',()=>{
 const events=Array.from({length:1200},(_,i)=>({id:String(i),pitch:60,onset:i*.01,duration:.1,velocity:.5,confidence:null,optional:false,string:null,fret:null}));
 const view=render(<DraftNotePreview events={events} duration={13} sourceTime={0}/>);
 assert.equal(view.container.querySelector('.draft-roll')?.getAttribute('data-note-count'),'1200');
 assert.equal(view.queryByRole('button',{name:'Play proposed notes'}),null);
 assert.ok(view.container.querySelector('.draft-key-white.is-active'));
 view.rerender(<DraftNotePreview events={events} duration={13} sourceTime={12.9}/>);
 assert.equal(view.container.querySelector('.draft-key-white.is-active'),null);
});
test('actual canvas applies one offset and crops a note spanning source zero',()=>{
 const rectangles:number[][]=[];
 dom.window.HTMLCanvasElement.prototype.getContext=function(){return {setTransform(){},clearRect(){},fillRect(...args:number[]){rectangles.push(args)},beginPath(){},moveTo(){},lineTo(){},stroke(){}} as any;};
 const view=render(<PianoNoteRoll events={[{pitch:60,onset:1,duration:1}]} duration={10} time={1.12} offsetSeconds={.12}/>);
 assert.ok(Math.abs(rectangles[1][0]/640*10-1.12)<1e-9);
 rectangles.length=0;
 view.rerender(<PianoNoteRoll events={[{pitch:60,onset:.05,duration:.3}]} duration={10} time={0} offsetSeconds={-.2}/>);
 assert.equal(rectangles.length,2);assert.equal(rectangles[1][0],0);
 assert.ok(Math.abs(rectangles[1][2]/640*10-.15)<1e-9);
});
test('hook binds stable refs after asynchronous media mount',()=>{
 class Media extends EventTarget{
  currentTime=1;duration=10;paused=false;ended=false;seeking=false;readyState=4;muted=false;volume=1;playbackRate=1;plays=0;
  pause(){this.paused=true;}play(){this.plays++;this.paused=false;return Promise.resolve();}
 }
 const source={current:null as any},piano={current:null as any};
 function Harness(){usePianoSourcePlayer(source,piano,'piano',0);return null;}
 const view=render(<Harness/>);source.current=new Media();piano.current=new Media();view.rerender(<Harness/>);
 assert.equal(piano.current.plays,1);
});

test('preview is only exposed after its size and SHA-256 are verified',async()=>{
 const original=globalThis.fetch;const bytes=new Uint8Array([1,2,3]);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 globalThis.fetch=async()=>new Response(bytes);
 try{
  const {result}=renderHook(()=>usePianoPreviewAsset({key:'lessons/a/preview.wav',mime:'audio/wav',bytes:3,sha256:hash}));
  await waitFor(()=>assert.match(result.current.url,/^blob:/));assert.equal(result.current.error,'');
 }finally{globalThis.fetch=original;}
});

test('a mismatched preview never becomes playable',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));
 try{
  const {result}=renderHook(()=>usePianoPreviewAsset({key:'lessons/a/preview.wav',mime:'audio/wav',bytes:3,sha256:'0'.repeat(64)}));
  await waitFor(()=>assert.match(result.current.error,/does not match/));assert.equal(result.current.url,'');
 }finally{globalThis.fetch=original;}
});
