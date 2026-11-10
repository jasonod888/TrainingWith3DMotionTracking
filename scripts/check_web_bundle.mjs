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
const musicFiles=collect(musicKey).files;
const renderers={};
const rendererKeys={};
for(const name of ['PianoGuide','GuitarNeckGuide']){
 const key=Object.keys(manifest).find(key=>key.endsWith(`/renderers/${name}.tsx`));
 assert.ok(key,`${name} must remain an instrument-specific lazy module`);rendererKeys[name]=key;
 assert.ok(!seen.has(key)&&!collect(musicKey).seen.has(key),`${name} entered the library or music shell`);
 const closure=collect(key);
 const extra=measure(new Set([...closure.files].filter(file=>!files.has(file)&&!musicFiles.has(file))));
 assert.ok(extra.gzip<=baseline.instrumentRendererLimitGzip,`${name} extra gzip ${extra.gzip} exceeds ${baseline.instrumentRendererLimitGzip}`);
 const active=measure(new Set([...musicFiles,...closure.files].filter(file=>!files.has(file))));
 renderers[name]={additional:extra,totalActiveMusic:active};
}
assert.ok(!collect(rendererKeys.PianoGuide).seen.has(rendererKeys.GuitarNeckGuide),'Piano imports the guitar renderer');
assert.ok(!collect(rendererKeys.GuitarNeckGuide).seen.has(rendererKeys.PianoGuide),'Guitar imports the piano renderer');
console.log(JSON.stringify({initial,musicScreen:music,renderers,initialFiles:[...files].sort()},null,2));
