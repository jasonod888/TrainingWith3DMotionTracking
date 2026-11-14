/** Independent Phase 6 gate probes. Expected behaviour; failures are review findings. */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
const dom = new JSDOM('<html><body></body></html>', {url:'http://localhost/workspace-harness.html?demo=frames', pretendToBeVisual:true});
const {window} = dom;
Object.assign(globalThis,{window,document:window.document,location:window.location,HTMLElement:window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
Object.defineProperty(globalThis,'navigator',{value:window.navigator, configurable:true});
window.matchMedia = (()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})) as any;
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return 600;},configurable:true});
const {render,fireEvent,cleanup,waitFor} = await import('@testing-library/react');
const {PianoWorkspaceHarness} = await import('../src/music/workspace/PianoWorkspaceHarness.tsx');
const {TimeRoll} = await import('../src/music/workspace/TimeRoll.tsx');
const {ContinuousScore} = await import('../src/music/workspace/ContinuousScore.tsx');
const {layoutMeasures} = await import('../src/music/workspace/viewport.ts');
const {buildNotation} = await import('../../../packages/music-notation/index.ts');
afterEach(()=>{fireEvent.pointerCancel(window);cleanup();});
async function open(){const view=render(<PianoWorkspaceHarness/>);await waitFor(()=>assert.ok(view.container.querySelector('.ws-roll-note')));return view;}
function first(view:any){return view.container.querySelector('.ws-roll-note') as SVGRectElement;}
function begin(node:Element,dy=-22){fireEvent.pointerDown(node,{clientX:100,clientY:100,pointerId:1,button:0});fireEvent.pointerMove(node,{clientX:100,clientY:100+dy,pointerId:1});}
function doc(events=[{id:'one',onset:2,duration:0.5,pitch:60}]){return buildNotation(events.map(e=>({...e,velocity:0.6,confidence:null,optional:false,string:null,fret:null})),{bpm:120,duration:12});}

test('R1 roll window pointer cancellation never commits',async()=>{
  const v=await open();const before=first(v).getAttribute('data-pitch');begin(first(v));
  fireEvent.pointerCancel(window,{pointerId:1});
  assert.equal(first(v).getAttribute('data-pitch'),before);
  assert.ok(v.getByRole('button',{name:'Undo',exact:true}).hasAttribute('disabled'));
});
test('R1 sheet window pointer cancellation never commits',async()=>{
  const v=await open();const head=v.container.querySelector('.ws-score-notehead')!;const before=head.getAttribute('aria-label')?.split(',')[0];begin(head,-12);
  fireEvent.pointerCancel(window,{pointerId:1});
  assert.equal(v.container.querySelector('.ws-score-notehead')?.getAttribute('aria-label')?.split(',')[0],before);
});
test('R1 unmount cleans up pending drag instead of committing to the old host',()=>{
  const edits:any[]=[];const v=render(<TimeRoll document={doc()} window={{start:0,span:10}} onWindowChange={()=>{}}
    selectedOccurrenceId={null} reveal={null} playhead={0} onSelect={()=>{}} onSeek={()=>{}} onGestureCommit={e=>edits.push(e)}/>);
  begin(first(v));v.unmount();fireEvent.pointerUp(window,{pointerId:1});assert.deepEqual(edits,[]);
});
test('R1 losing pointer capture cancels instead of committing on a later pointerup',async()=>{
  const v=await open();const before=first(v).getAttribute('data-pitch');const node=first(v);begin(node);
  fireEvent(node,new window.Event('lostpointercapture',{bubbles:true}));
  fireEvent.pointerUp(window,{pointerId:1});assert.equal(first(v).getAttribute('data-pitch'),before);
});
test('R2 sheet drag follows actual staff line-space geometry',()=>{
  const document=doc();const edits:any[]=[];
  const v=render(<ContinuousScore document={document} boxes={layoutMeasures(document).boxes} selectedOccurrenceId={null}
    reveal={null} onSelect={()=>{}} onGestureCommit={e=>edits.push(e)}/>);
  const head=v.container.querySelector('.ws-score-notehead')!;
  begin(head,-10);fireEvent.pointerUp(head,{pointerId:1});
  assert.equal(edits[0]?.pitch,64,'staff lines are 10 px apart, so C up one line must be E (two diatonic steps)');
});
test('R3 add placement subtracts the displayed sync offset',async()=>{
  const v=await open();fireEvent.change(v.getByLabelText('Sync offset in seconds (not saved)'),{target:{value:'0.5'}});
  fireEvent.click(v.container.querySelector('[data-add="toggle"]')!);
  fireEvent.pointerDown(v.container.querySelector('.ws-roll-add-layer')!,{clientX:180,clientY:20});
  const ghost=v.container.querySelector('[data-ghost="true"]')!;
  assert.equal(Number(ghost.getAttribute('x')),180,'ghost should remain at the clicked source-time x');
});
test('R4 Replace mode blocks roll editing until cancelled or committed',async()=>{
  const v=await open();fireEvent.click(first(v));
  // Roll selection uses pointer events, not click.
  fireEvent.pointerDown(first(v),{clientX:100,clientY:100,pointerId:1,button:0});fireEvent.pointerUp(first(v),{pointerId:1});
  fireEvent.click(v.getByRole('button',{name:'Replace pitch'}));const before=first(v).getAttribute('data-pitch');
  begin(first(v));fireEvent.pointerUp(first(v),{pointerId:1});
  assert.equal(first(v).getAttribute('data-pitch'),before);
});
test('R5 returning a sheet drag to its origin preserves an authored accidental',()=>{
  const document=doc([{id:'sharp',onset:2,duration:0.5,pitch:61}]);const edits:any[]=[];
  const v=render(<ContinuousScore document={document} boxes={layoutMeasures(document).boxes} selectedOccurrenceId={null}
    reveal={null} onSelect={()=>{}} onGestureCommit={e=>edits.push(e)}/>);
  const head=v.container.querySelector('.ws-score-notehead')!;
  begin(head,-12);fireEvent.pointerMove(head,{clientX:100,clientY:100,pointerId:1});fireEvent.pointerUp(head,{pointerId:1});
  assert.deepEqual(edits,[],'return to origin must be a no-op, preserving C-sharp');
});
