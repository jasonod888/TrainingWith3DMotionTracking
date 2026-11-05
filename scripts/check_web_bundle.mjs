// Measure the production library's static import closure; dynamic destinations stay separate.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'apps/web/dist');
const manifest=JSON.parse(readFileSync(resolve(dist,'.vite/manifest.json'),'utf8'));
const baselinePath=resolve(root,'docs/multi-discipline-bundle-baseline.json');
function collect(entry){
 const seen=new Set(),files=new Set();
 function visit(key){
  if(seen.has(key))return;seen.add(key);
  const chunk=manifest[key];assert.ok(chunk,`Missing chunk ${key}`);
  files.add(chunk.file);for(const css of chunk.css??[])files.add(css);
  for(const dependency of chunk.imports??[])visit(dependency);
 }
 visit(entry);return {seen,files};
}
const {seen,files}=collect('index.html');
const measure=paths=>[...paths].reduce((total,path)=>{
 const bytes=readFileSync(resolve(dist,path));return {bytes:total.bytes+bytes.length,gzip:total.gzip+gzipSync(bytes).length};
},{bytes:0,gzip:0});
const initial=measure(files);
const musicKey=Object.keys(manifest).find(key=>key.endsWith('/MusicLessonHome.tsx'));
assert.ok(musicKey,'Music screen must remain a separate lazy destination');
assert.ok(!seen.has(musicKey),'Music screen entered the initial library download');
const music=measure(new Set([...collect(musicKey).files].filter(file=>!files.has(file))));
const baseline=JSON.parse(readFileSync(baselinePath,'utf8'));
assert.ok(initial.gzip<=baseline.initial.gzip+baseline.headroomGzip,`Initial gzip ${initial.gzip} exceeds ${baseline.initial.gzip+baseline.headroomGzip}`);
assert.ok(music.gzip<=baseline.musicScreenLimitGzip,`Music screen gzip ${music.gzip} exceeds ${baseline.musicScreenLimitGzip}`);
console.log(JSON.stringify({initial,musicScreen:music,initialFiles:[...files].sort()},null,2));
