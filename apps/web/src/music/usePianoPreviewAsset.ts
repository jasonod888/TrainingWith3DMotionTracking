import {useEffect,useState} from 'react';
import type {Asset} from '../../../../packages/lesson-schema/index';
import {assetUrl} from '../api';

/** A complete, verified local preview avoids range-seek starvation while the
 * source clock continues moving. Never enable Piano against partial data. */
export function usePianoPreviewAsset(asset:Asset|null|undefined){
 const identity=asset?`${asset.key}:${asset.sha256}:${asset.bytes}`:'';
 const [attempt,retry]=useState(0);
 const [value,setValue]=useState({identity:'',url:'',error:''});
 useEffect(()=>{
  if(!asset)return;
  const controller=new AbortController();let disposed=false,objectUrl='';
  setValue({identity,url:'',error:''});
  void (async()=>{
   try{
    if(asset.bytes>160*1024*1024)throw new Error('Piano preview exceeds the supported playback size.');
    const response=await fetch(assetUrl(asset.key),{credentials:'same-origin',signal:controller.signal});
    if(!response.ok)throw new Error('Piano audio could not be loaded. Original audio remains available.');
    const bytes=await response.arrayBuffer();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==asset.bytes||digest!==asset.sha256)throw new Error('Piano audio does not match this lesson. Reload or retry.');
    if(disposed)return;
    objectUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    setValue({identity,url:objectUrl,error:''});
   }catch(error){if(!disposed)setValue({identity,url:'',error:error instanceof Error?error.message:'Piano audio is unavailable.'});}
  })();
  return()=>{disposed=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[identity,attempt]);
 return {url:value.identity===identity?value.url:'',error:value.identity===identity?value.error:'',retry:()=>retry(value=>value+1)};
}
