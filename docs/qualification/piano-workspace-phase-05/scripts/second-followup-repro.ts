/** Pure recovery/map contract checks for df09a8f. No services or file writes. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {addAnchor, buildNotation, estimatedAlignment} from '../../packages/music-notation/index.ts';
import {serializeAlignment} from '../../apps/web/src/music/workspace/save-payload.ts';
import {readRecovery, writeRecovery} from '../../apps/web/src/music/workspace/recovery.ts';

const memory=new Map<string,string>();
Object.assign(globalThis,{localStorage:{getItem:(k:string)=>memory.get(k)??null,
  setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
let failed=0;
const check=(name:string,fn:()=>void)=>{try{fn();console.log(`PASS: ${name}`);}catch(e){failed++;console.log(`FAIL: ${name}: ${(e as Error).message}`);}};
const identity={accountId:'owner',lessonId:'lesson',draftId:'',sourceSha256:'a'.repeat(64),baseRevisionId:'old-base'};
writeRecovery({identity,title:'local edits',notation:{},alignment:null,offsetSeconds:0,spans:[],baseRevisionId:'old-base'});
check('recovery distinguishes a checkpoint on an older revision of the same clip',()=>assert.equal(
  readRecovery({...identity,baseRevisionId:'new-base'} as typeof identity).status,'rejected'));

const document=buildNotation([{id:'n',onset:1,duration:0.5,pitch:60,velocity:0.5,confidence:null,optional:false,string:null,fret:null}],{bpm:120,duration:12});
const base=estimatedAlignment(document);
const later=addAnchor(base,document,6,6000);
assert.ok(later.ok);
const earlier=addAnchor(later.alignment,document,2,2000);
assert.ok(earlier.ok,'adding an earlier, monotonic point is a valid map operation');
// The harness appends in authoring order; serializeAlignment preserves that order.
const saved=serializeAlignment(earlier.alignment,[{seconds:6,tick:6000},{seconds:2,tick:2000}],0);
const result=spawnSync(resolve('.venv-saas/Scripts/python.exe'),['-c',
  "import sys,json\nfrom apps.api.music_alignment import validate_alignment\nv=json.load(sys.stdin)\ntry:\n validate_alignment(v,12); print('accepted')\nexcept ValueError as e:\n print(str(e))"],{input:JSON.stringify(saved),encoding:'utf8'});
assert.equal(result.status,0,result.stderr);
check('valid anchors authored later-then-earlier remain saveable by the server',()=>assert.equal(result.stdout.trim(),'accepted'));
console.log(`${failed} recovery/map contract check(s) failed.`);
process.exitCode=failed?1:0;
