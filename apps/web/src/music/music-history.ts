/** Validate saved summary responses before showing private history. */
export type MusicHistoryItem={id:string;lesson_id:string;title:string|null;date:string;section_id:string;run:number;start:number;end:number;speed:number;
  note_window:{total:number;eligible:number;matched:number;missing:number;extra:number}};
export type MusicHistoryPage={items:MusicHistoryItem[];next_cursor:string|null};
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid music history response.');return value as Record<string,unknown>;
};
const text=(value:unknown,max:number)=>{if(typeof value!=='string'||!value||value.length>max)throw Error('Invalid music history text.');return value;};
const number=(value:unknown,min:number,max:number,integer=false)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw Error('Invalid music history counts.');return value;
};
export function parseMusicHistoryPage(value:unknown):MusicHistoryPage{
 const page=object(value);
 if(!Array.isArray(page.items)||page.items.length>100||!(page.next_cursor===null||typeof page.next_cursor==='string'&&page.next_cursor.length>0&&page.next_cursor.length<=400))throw Error('Invalid music history page.');
 const items=page.items.map(raw=>{
  const row=object(raw),notes=object(row.note_window),id=text(row.id,36);
  if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)||row.summary_version!==1||row.status!=='complete'||row.assessment!=='unscored'||row.evidence!=='client-reported')throw Error('Unsupported music summary.');
  const date=text(row.date,80);if(!Number.isFinite(Date.parse(date)))throw Error('Invalid summary date.');
  const counts={total:number(notes.total,0,20000,true),eligible:number(notes.eligible,0,20000,true),matched:number(notes.matched,0,20000,true),missing:number(notes.missing,0,20000,true),extra:number(notes.extra,0,20000,true)};
  if(counts.eligible>counts.total||counts.matched+counts.missing>counts.eligible||counts.matched+counts.extra>20000)throw Error('Inconsistent music summary.');
  const start=number(row.start,0,86400),end=number(row.end,0,86400),speed=number(row.speed,.5,1.25);
  if(end<=start||![.5,.75,1,1.25].includes(speed)||!(row.title===null||typeof row.title==='string'&&row.title.length>0&&row.title.length<=200))throw Error('Invalid music summary range.');
  return {id,lesson_id:text(row.lesson_id,80),title:row.title as string|null,date,section_id:text(row.section_id,80),run:number(row.run,0,4,true),start,end,speed,note_window:counts};
 });
 if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('Duplicate music summary.');
 return {items,next_cursor:page.next_cursor as string|null};
}
