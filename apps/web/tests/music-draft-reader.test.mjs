import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMusicDraftView} from '../../../packages/lesson-schema/parse.ts';

const asset={key:'lessons/piano/reference.json',mime:'application/json',bytes:5,sha256:'a'.repeat(64)};
const draft=()=>({draft_version:1,draft_id:'draft',lesson_id:'piano',title:'Piano',revision_id:null,status:'draft',
 subject:'piano',instrument:{instrument:'piano'},duration:2,reference:asset,source_video:null,
 events:[{id:'note',onset:.5,duration:.5,pitch:60}],spans:[],warnings:[],
 provenance:{adapter:'fixture',engine:'fixture',code_version:'v1',model:null,model_version:null,audio_sha256:'b'.repeat(64)}});

test('draft review reader normalizes copies without pretending a draft is a manifest',()=>{
 const input=draft(),parsed=parseMusicDraftView(input);
 assert.equal(parsed.ok,true);
 assert.notEqual(parsed.value.events[0],input.events[0]);
 assert.equal(parsed.value.events[0].optional,false);
 assert.equal('reference_reviewed' in parsed.value,false);
 assert.equal('schema_version' in parsed.value,false);
});

test('draft reader rejects invalid timing, duplicate identities, unsafe assets and unbounded lists',()=>{
 for(const change of [
  {events:[{id:'note',onset:1.9,duration:.2,pitch:60}]},
  {events:[{id:'same',onset:0,pitch:60},{id:'same',onset:1,pitch:62}]},
  {events:Array.from({length:20001},(_,id)=>({id:String(id),onset:0,pitch:60}))},
  {instrument:{instrument:'guitar'}},{reference:{...asset,key:'../reference.json'}},
  {provenance:{...draft().provenance,audio_sha256:'invalid'}},
  {reference_reviewed:true},
 ])assert.equal(parseMusicDraftView({...draft(),...change}).ok,false);
});

