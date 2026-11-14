/** Saved-reference lifecycle probes for 4e30e8b; no services or product writes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildNotation, estimatedAlignment} from '../../packages/music-notation/index.ts';
import {serializeAlignment} from '../../apps/web/src/music/workspace/save-payload.ts';

async function main() {
  const fixture=JSON.parse(readFileSync('docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json','utf8'));
  const notation=buildNotation(fixture.events,{duration:fixture.duration});
  const reference={duration:fixture.duration,title:'Authored saved reference',events:notation.performance,
    notation,spans:fixture.spans,alignment:serializeAlignment(estimatedAlignment(notation),[],0.25)};
  const videoAsset={key:'lessons/fixture/source.mp4',mime:'video/mp4',bytes:3,sha256:'c'.repeat(64)};
  const manifest={revision_id:'saved-revision',reference:{key:'lessons/fixture/ref.json',sha256:'b'.repeat(64)},
    source_video:videoAsset,piano_preview:null,preview_identity:null};
  const draft={...fixture,draft_id:'draft-1',lesson_id:'fixture',title:'Old generated draft',status:'reviewed',
    source_video:videoAsset};
  const require=createRequire(resolve('apps/web/package.json'));
  const React=require('react');const {JSDOM}=require('jsdom');
  const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/workspace-harness.html?id=fixture',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,
    HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true,localStorage:dom.window.localStorage,
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{get:()=>600,configurable:true});
  const {render,fireEvent,cleanup,waitFor,act}=require('@testing-library/react');
  const {PianoWorkspaceHarness}=await import('../../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx');
  let releaseDraft:(value:Response)=>void=()=>{};
  const gate=new Promise<Response>(resolve=>{releaseDraft=resolve;});
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  globalThis.fetch=async(input:any)=>{
    const path=String(input);
    if(path.endsWith('/auth/session'))return json({account:{id:'account-1'},csrf:'fixture'});
    if(path.endsWith('/music-draft'))return gate;
    if(path.endsWith('/assets/ref.json'))return json(reference);
    if(path.endsWith('/lessons/fixture'))return json(manifest);
    return new Response('{}',{status:404});
  };
  let failures=0;
  const check=(name:string,fn:()=>void)=>{try{fn();console.log(`PASS: ${name}`);}catch(e){failures++;console.log(`FAIL: ${name}: ${(e as Error).message}`);}};
  const view=render(React.createElement(PianoWorkspaceHarness));
  await waitFor(()=>assert.ok(view.queryByText(/Opened saved revision/)));
  check('saved-reference load includes the manifest source video before a draft responds',()=>assert.ok(view.container.querySelector('video')));
  // A reopened map must remain editable, rather than shadowing the authored result.
  fireEvent.change(view.getByLabelText('Fixture clock'),{target:{value:'1.25'}});
  const authoredTick=Math.round(notation.tempo.bpm*notation.ppq/60)+100;
  fireEvent.change(view.getByLabelText('Anchor tick'),{target:{value:String(authoredTick)}});
  fireEvent.click(view.getByRole('button',{name:'Apply anchor'}));
  check('an anchor applied after reopen changes the mapped cursor',()=>assert.equal(
    Number(view.container.querySelector('[data-playhead-tick]')?.getAttribute('data-playhead-tick')),authoredTick));
  fireEvent.change(view.getByLabelText('Sync offset in seconds (not saved)'),{target:{value:'0.5'}});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,700));});
  check('saved-reference-only edits get an identity-scoped checkpoint',()=>assert.ok(localStorage.getItem('piano-workspace-recovery-v1')));
  await act(async()=>{releaseDraft(json(draft));await new Promise(resolve=>setTimeout(resolve,30));});
  check('late draft response cannot overwrite a saved reference or newer edit',()=>assert.equal(
    (view.getByLabelText('Sync offset in seconds (not saved)') as HTMLInputElement).value,'0.5'));
  cleanup();
  console.log(`${failures} saved-reference lifecycle check(s) failed.`);process.exitCode=failures?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
