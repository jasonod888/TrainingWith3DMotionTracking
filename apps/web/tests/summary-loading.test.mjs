import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readLessonSummaries,loadLessonSummaries,loadLessonSummariesPage,loadSharedSummaries} from '../src/api.ts';
import {createLibraryPager} from '../src/app/library-pager.ts';

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
 assert.deepEqual(readLessonSummaries({lessons:[]}),[]);
 assert.throws(()=>readLessonSummaries([{...music,experience_family:'body'}]));
 assert.throws(()=>readLessonSummaries([{...body,animation:{}}]));
});

test('libraries over 100 lessons follow has_more instead of dropping the tail',async()=>{
 const first=Array.from({length:100},(_,index)=>({...body,lesson_id:`l${index}`,revision_id:`r${index}`}));
 const second=[{...body,lesson_id:'l100',revision_id:'r100'}];
 const calls=[];
 globalThis.fetch=async(url)=>{
  calls.push(String(url));
  const offset=Number(new URL(String(url),'http://x').searchParams.get('offset'));
  return {ok:true,json:async()=>offset===0?{lessons:first,total:101,has_more:true,limit:100,offset:0}
   :{lessons:second,total:101,has_more:false,limit:100,offset:100}};
 };
 try{
  const all=await loadLessonSummaries();
  assert.equal(all.length,101);
  assert.deepEqual(calls.map(value=>new URL(value,'http://x').searchParams.get('offset')),['0','100']);
  const page=await loadLessonSummariesPage({limit:100,offset:0});
  assert.equal(page.total,101);
  assert.equal(page.has_more,true);
  assert.equal(page.offset,0);
 }finally{delete globalThis.fetch;}
});

test('2,050 lessons load across all 21 pages with no silent cap',async()=>{
 const total=2050;const calls=[];
 globalThis.fetch=async(url)=>{
  const offset=Number(new URL(String(url),'http://x').searchParams.get('offset'));calls.push(offset);
  const count=Math.min(100,total-offset);
  const lessons=Array.from({length:count},(_,index)=>({...body,lesson_id:`l${offset+index}`,revision_id:`r${offset+index}`}));
  return {ok:true,json:async()=>({lessons,total,has_more:offset+count<total,limit:100,offset})};
 };
 try{
  const all=await loadLessonSummaries();
  assert.equal(all.length,2050);
  assert.equal(calls.length,21);
 }finally{delete globalThis.fetch;}
});

test('page continuation appends and stops at has_more false',async()=>{
 const calls=[];
 globalThis.fetch=async(url)=>{
  const offset=Number(new URL(String(url),'http://x').searchParams.get('offset'));calls.push(offset);
  return {ok:true,json:async()=>offset===0
   ?{lessons:Array.from({length:100},(_,index)=>({...body,lesson_id:`p${index}`,revision_id:`pr${index}`})),total:101,has_more:true,limit:100,offset:0}
   :{lessons:[{...body,lesson_id:'p100',revision_id:'pr100'}],total:101,has_more:false,limit:100,offset:100}};
 };
 try{
  const first=await loadLessonSummariesPage({limit:100,offset:0});
  const second=await loadLessonSummariesPage({limit:100,offset:first.lessons.length});
  const all=[...first.lessons,...second.lessons.filter(item=>!first.lessons.some(old=>old.lesson_id===item.lesson_id))];
  assert.equal(all.length,101);
  assert.deepEqual(calls,[0,100]);
  assert.equal(first.has_more,true);
  assert.equal(second.has_more,false);
 }finally{delete globalThis.fetch;}
});

test('summary pages forward search/subject and expose full-library subjects',async()=>{
 let seen='';
 globalThis.fetch=async(url)=>{seen=String(url);return {ok:true,json:async()=>({
  lessons:[body],total:1,has_more:false,limit:100,offset:0,
  available_subjects:['dance','piano','guitar']})};};
 try{
  const page=await loadLessonSummariesPage({limit:100,offset:0,q:'moonlight',subject:'piano'});
  const query=new URL(seen,'http://x').searchParams;
  assert.equal(query.get('q'),'moonlight');
  assert.equal(query.get('subject'),'piano');
  assert.equal(query.get('offset'),'0');
  assert.deepEqual(page.available_subjects,['dance','piano','guitar']);
  assert.equal(page.total,1);
 }finally{delete globalThis.fetch;}
});

test('a stale load-more response cannot overwrite a newer search', () => {
 const pager=createLibraryPager();
 const oldGeneration=pager.beginLoadMore();
 const oldState={lessons:[{lesson_id:'old'}],total:101,hasMore:true,
  availableSubjects:['dance'],loadingMore:true};
 const newGeneration=pager.beginReload();
 const reloaded=pager.reload(newGeneration,{lessons:[{lesson_id:'new'}],total:1,
  has_more:false,available_subjects:['piano']});
 assert.ok(reloaded);
 assert.deepEqual(reloaded.lessons,[{lesson_id:'new'}]);
 assert.equal(reloaded.total,1);
 assert.equal(reloaded.hasMore,false);
 assert.equal(reloaded.loadingMore,false);
 const stale=pager.append(oldGeneration,oldState,{lessons:[{lesson_id:'old-page-2'}],
  total:201,has_more:true,available_subjects:['dance']});
 assert.equal(stale,null);
 assert.deepEqual(reloaded.lessons,[{lesson_id:'new'}]);
 const source=readFileSync(new URL('../src/LibraryApp.tsx',import.meta.url),'utf8');
 assert.match(source,/pager\.beginLoadMore\(\)/);
 assert.match(source,/pager\.append\(generation,current,page\)/);
 assert.match(source,/const generation=pager\.beginReload\(\)/);
});

test('owned and shared discovery negotiate summaries rather than full manifests',async()=>{
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>[music]};};
 try{
  await loadLessonSummaries('piano');await loadSharedSummaries();
  assert.deepEqual(calls.map(call=>call.url),['/api/lessons/summaries?subject=piano&limit=100&offset=0','/api/shared-lessons/summaries?limit=100&offset=0']);
  assert.ok(calls.every(call=>call.options.headers['X-Lesson-Formats']==='1,2,3'));
 }finally{delete globalThis.fetch;}
});
