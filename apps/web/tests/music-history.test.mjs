import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMusicHistoryPage} from '../src/music/music-history.ts';
const row={summary_version:1,status:'complete',assessment:'unscored',evidence:'client-reported',id:'97196a00-a988-4ded-b55b-a5f1bb0976ec',
 lesson_id:'piano',title:'Earlier piano lesson',date:'2026-11-10T12:00:00Z',section_id:'all',run:0,start:0,end:2,speed:1,
 note_window:{total:3,eligible:2,matched:1,missing:1,extra:0}};
test('history validates copies and permits unavailable titles and bounded cursors',()=>{
 const parsed=parseMusicHistoryPage({items:[{...row,title:null}],next_cursor:'next'});
 assert.equal(parsed.items[0].title,null);assert.equal(parsed.next_cursor,'next');
 parsed.items[0].note_window.total=99;assert.equal(row.note_window.total,3);
});
test('experimental challenge reports remain bounded and visibly scoreless',()=>{
 const challenge={...row,summary_version:2,report_version:2,status:'insufficient-evidence',section_id:'all',run:0,speed:1};
 const parsed=parseMusicHistoryPage({items:[challenge],next_cursor:null});
 assert.equal(parsed.items[0].report_version,2);
 assert.equal(parsed.items[0].speed,1);
 for(const change of [{summary_version:1},{report_version:1},{status:'complete'},{assessment:'scored'},{section_id:'part'},{speed:.5}])
  assert.throws(()=>parseMusicHistoryPage({items:[{...challenge,...change}],next_cursor:null}));
});
test('malformed history cannot render fabricated scores, counts, dates or duplicates',()=>{
 for(const change of [{assessment:'scored'},{date:'unknown'},{speed:2},{end:0},{note_window:{...row.note_window,eligible:4}}])
  assert.throws(()=>parseMusicHistoryPage({items:[{...row,...change}],next_cursor:null}));
 assert.throws(()=>parseMusicHistoryPage({items:[row,row],next_cursor:null}));
 assert.throws(()=>parseMusicHistoryPage({items:[row],next_cursor:'x'.repeat(401)}));
});
