import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLessonSummaries,loadLessonSummaries,loadSharedSummaries} from '../src/api.ts';

const body={summary_version:1,lesson_id:'body',revision_id:'body-v1',title:'Movement',
 subject:'dance',subject_label:'Dance',experience_family:'body',instrument:null,duration:20,section_count:2,
 poster:null,capabilities:{preview:true,practice:true,live_input:'camera'}};
const music={...body,lesson_id:'music',subject:'piano',subject_label:'Piano',experience_family:'music',
 instrument:'piano',capabilities:{preview:true,practice:false,live_input:'none'}};

test('summary loading validates both families without requiring body media',()=>{
 const rows=readLessonSummaries([body,music]);
 assert.equal(rows[0].experience_family,'body');
 assert.equal(rows[1].instrument,'piano');
 assert.notEqual(rows[0],body);
 assert.throws(()=>readLessonSummaries({lessons:[]}),/could not be read/);
 assert.throws(()=>readLessonSummaries([{...music,experience_family:'body'}]));
 assert.throws(()=>readLessonSummaries([{...body,animation:{}}]));
});

test('owned and shared discovery negotiate summaries rather than full manifests',async()=>{
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>[music]};};
 try{
  await loadLessonSummaries('piano');await loadSharedSummaries();
  assert.deepEqual(calls.map(call=>call.url),['/api/lessons/summaries?subject=piano','/api/shared-lessons/summaries']);
  assert.ok(calls.every(call=>call.options.headers['X-Lesson-Formats']==='1,2'));
 }finally{delete globalThis.fetch;}
});
