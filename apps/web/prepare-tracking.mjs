import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const out=new URL('./public/tracking/',import.meta.url);
const sdk=new URL('./node_modules/@mediapipe/tasks-vision/',import.meta.url);
const modelHash='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const modelUrl='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
await mkdir(new URL('wasm/',out),{recursive:true});
const files=['vision_bundle.mjs','wasm/vision_wasm_internal.js','wasm/vision_wasm_internal.wasm','wasm/vision_wasm_nosimd_internal.js','wasm/vision_wasm_nosimd_internal.wasm'];
for(const file of files)await copyFile(new URL(file,sdk),new URL(file,out));
const target=new URL('pose_landmarker_lite.task',out);
let model;
try{model=await readFile(target);}catch{
 try{model=await readFile(new URL('../../web/dist/assets/pose_landmarker_lite.task',import.meta.url));}catch{
  const response=await fetch(modelUrl,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(`Could not download the pinned pose model (${response.status}).`);
  model=Buffer.from(await response.arrayBuffer());
 }
}
if(createHash('sha256').update(model).digest('hex')!==modelHash)throw new Error('Pose model checksum mismatch; preparation stopped.');
await writeFile(target,model);
console.log('Pinned browser tracking runtime and hash-verified pose model prepared.');
