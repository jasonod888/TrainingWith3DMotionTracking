import type {LessonManifest} from '../../../packages/lesson-schema/index';
export async function loadDemo(signal?:AbortSignal):Promise<LessonManifest|null>{
  const response=await fetch('/api/demo',{signal});
  if(response.status===404)return null;
  if(!response.ok)throw new Error('Your lesson could not be loaded. Try again.');
  const value=await response.json() as LessonManifest;
  if(value.schema_version!==1)throw new Error('This lesson format is not supported.');
  return value;
}
export const assetUrl=(key:string)=>key.startsWith('lessons/')?`/api/lessons/${encodeURIComponent(key.split('/')[1])}/assets/${encodeURIComponent(key.split('/').pop()!)}`:`/api/demo/assets/${encodeURIComponent(key.split('/').pop()!)}`;

export type Account={id:string;email:string};
export type SessionInfo={account:Account;csrf:string};
let csrf='';
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
export async function request<T>(path:string,method='GET',body?:unknown,keepalive=false):Promise<T>{
 const response=await fetch(`/api${path}`,{method,keepalive,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-Form-Request':'1','X-CSRF-Token':csrf},body:method==='GET'?undefined:JSON.stringify(body??{})});
 if(!response.ok){const data=await response.json().catch(()=>null);throw new ApiError(typeof data?.detail==='string'?data.detail:'Something went wrong. Please try again.',response.status);}
 return response.json();
}
export async function getSession():Promise<SessionInfo|null>{
 try{const value=await request<SessionInfo>('/auth/session');csrf=value.csrf;return value;}catch(e){if(e instanceof ApiError&&e.status===401){csrf='';return null;}throw e;}
}
export async function signIn(email:string,password:string){const value=await request<SessionInfo>('/auth/login','POST',{email,password});csrf=value.csrf;return value.account;}
export async function signOut(){await request('/auth/logout','POST');csrf='';}
export const loadLibrary=()=>request<LessonManifest[]>('/lessons');
export const loadLesson=(id:string)=>request<LessonManifest>(`/lessons/${encodeURIComponent(id)}`);
export const copyDemo=()=>request<LessonManifest>('/lessons/from-demo','POST');
export const saveSections=(lesson:LessonManifest,sections:LessonManifest['section_set']['sections'],title:string)=>request<LessonManifest>(`/lessons/${encodeURIComponent(lesson.lesson_id)}/sections`,'PUT',{base_revision_id:lesson.revision_id,sections,title});
export type Progress={revision_id:string;time:number;speed:.5|.75|1;mode:'sections'|'continuous'};
export const loadProgress=(lesson:LessonManifest)=>request<Progress|null>(`/lessons/${lesson.lesson_id}/progress`);
export const saveProgress=(lesson:LessonManifest,value:Omit<Progress,'revision_id'>)=>request(`/lessons/${lesson.lesson_id}/progress`,'PUT',{revision_id:lesson.revision_id,...value},true);
export function uploadChunk(jobId:string,part:number,body:Blob,signal:AbortSignal,progress:(bytes:number)=>void):Promise<void>{
 return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/conversions/${jobId}/parts/${part}`);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Form-Request','1');xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.timeout=120000;
 const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});const clean=()=>signal.removeEventListener('abort',abort);
 xhr.upload.onprogress=e=>progress(e.loaded);xhr.onload=()=>{clean();if(xhr.status>=200&&xhr.status<300)resolve();else{let message='Upload stopped. You can resume it from your library.';try{message=JSON.parse(xhr.responseText).detail??message;}catch{}reject(new ApiError(message,xhr.status));}};xhr.onerror=xhr.ontimeout=()=>{clean();reject(new Error('Connection interrupted. Resume the upload from your library.'));};xhr.onabort=()=>{clean();reject(new DOMException('Upload paused.','AbortError'));};if(signal.aborted){clean();reject(new DOMException('Upload paused.','AbortError'));return;}xhr.send(body);
 });
}
