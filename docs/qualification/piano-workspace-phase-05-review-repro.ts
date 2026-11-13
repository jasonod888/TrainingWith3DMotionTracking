/** Phase 5 cross-language contract probes; no services or product writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildNotation, estimatedAlignment} from '../../packages/music-notation/index.ts';
import {buildSaveBody, restoreFromReference} from '../../apps/web/src/music/workspace/save-payload.ts';

async function main() {
  const fixture = JSON.parse(readFileSync('docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json','utf8'));
  const document = buildNotation(fixture.events, {bpm:120, duration:fixture.duration});
  const body = buildSaveBody({title:'Reviewer fixture', document, spans:fixture.spans,
    alignment:estimatedAlignment(document), anchors:[], offsetSeconds:0});
  const python = `import json,sys
from apps.api.music_review import ReviewMusic
from apps.api.music_alignment import validate_alignment
from apps.api.music_notation import validate_notation
from apps.api.contracts import MusicEvent
import copy
v=json.load(sys.stdin)
out={}
try:
 ReviewMusic.model_validate(v); out['review']='accepted'
except Exception as e:
 out['review']=str(e)
try:
 validate_alignment(v['alignment'],v['notation']['duration']); out['alignment']='accepted'
except Exception as e:
 out['alignment']=str(e)
bad={'alignment_version':1,'mode':'anchored','basis':'tempo','anchors':[{'seconds':1,'tick':1500},{'seconds':2,'tick':500}],'passages':[{'kind':'timed','source_seconds':[0,12],'ticks':[0,11520]}]}
try:
 validate_alignment(bad,12); out['reversed_anchors']='accepted'
except Exception as e:
 out['reversed_anchors']=str(e)
events=[MusicEvent.model_validate(e) for e in v['events']]
for label in ['wrong_written_pitch','unowned_occurrences']:
 n=copy.deepcopy(v['notation'])
 notes=[note for event in n['events'] for note in event['notes']]
 if label=='wrong_written_pitch':
  notes[0]['pitch']=127; notes[0]['spelling']='G9'
 else:
  for note in notes: note['performance_ids']=[]
 try:
  validate_notation(n,events,n['duration']); out[label]='accepted'
 except Exception as e:
  out[label]=str(e)
print(json.dumps(out))`;
  const result = spawnSync(resolve('.venv-saas/Scripts/python.exe'), ['-c',python],
    {input:JSON.stringify(body), encoding:'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || `Python exit ${result.status}`);
  const actual = JSON.parse(result.stdout);
  let failures=0;
  const check=(name:string,fn:()=>void)=>{try{fn();console.log(`PASS: ${name}`);}catch(e){failures++;console.log(`FAIL: ${name}: ${(e as Error).message}`);}};
  check('workspace first-save body passes the actual ReviewMusic contract',()=>assert.equal(actual.review,'accepted'));
  check('workspace serialized alignment passes the actual server validator',()=>assert.equal(actual.alignment,'accepted'));
  check('server rejects reversing authored anchor ticks',()=>assert.notEqual(actual.reversed_anchors,'accepted'));
  check('server rejects written pitch disagreement with its linked occurrence',()=>assert.notEqual(actual.wrong_written_pitch,'accepted'));
  check('server rejects a document with every occurrence unowned',()=>assert.notEqual(actual.unowned_occurrences,'accepted'));
  const conflicting = {...body, duration:document.duration, events:body.events.map((e,i)=>i?e:{...e,pitch:127})};
  check('reopen rejects conflicting reference events and notation performance',()=>assert.equal(restoreFromReference(conflicting).ok,false));

  const require=createRequire(resolve('apps/web/package.json'));
  const React=require('react'); const {JSDOM}=require('jsdom');
  const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/workspace-harness.html?demo=frames',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,
    HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true,
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},fetch:async()=>new Response('null')});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{get:()=>600,configurable:true});
  const {render,fireEvent,cleanup}=require('@testing-library/react');
  const {PianoWorkspaceHarness}=await import('../../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx');
  const view=render(React.createElement(PianoWorkspaceHarness));
  fireEvent.change(view.getByLabelText('Sync offset in seconds (not saved)'),{target:{value:'0.5'}});
  fireEvent.click(view.getByLabelText('Confirm reviewed'));
  check('offset-only edit is saveable after confirmation',()=>assert.equal(
    (view.getByRole('button',{name:'Save privately'}) as HTMLButtonElement).disabled,false));
  cleanup();
  console.log(`${failures} Phase 5 reviewer check(s) failed.`); process.exitCode=failures?1:0;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
