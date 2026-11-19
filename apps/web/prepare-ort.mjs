import {copyFile, mkdir, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';

const root=new URL('./',import.meta.url);
const packageDir=new URL('./node_modules/onnxruntime-web/',root);
const dist=new URL('./dist/',packageDir);
const target=new URL('./public/onnxruntime/',root);
const modelTarget=new URL('./public/models/basic-pitch-0.4.0.onnx',root);
const modelSource=new URL('../../music-candidate-run/basic-pitch-0.4.0/model.onnx',root);
const modelSha='2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec';

if(!existsSync(packageDir))throw new Error('The pinned onnxruntime-web dependency is missing. Run npm install before preparing the browser runner.');
const version=JSON.parse(await readFile(new URL('./package.json',packageDir),'utf8')).version;
if(version!=='1.31.1')throw new Error(`Unexpected onnxruntime-web version ${version}; expected 1.31.1.`);
await mkdir(target,{recursive:true});
await mkdir(new URL('./public/models/',root),{recursive:true});
for(const file of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']){
  const source=new URL(file,dist);
  if(existsSync(source))await copyFile(source,new URL(file,target));
}
const model=await readFile(modelSource);
if(createHash('sha256').update(model).digest('hex')!==modelSha)throw new Error('Pinned music model checksum mismatch; preparation stopped.');
await copyFile(modelSource,modelTarget);
console.log('Prepared pinned onnxruntime-web WASM assets and checksum-verified music model.');
