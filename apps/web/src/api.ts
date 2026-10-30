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
export async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-Form-Request':'1','X-CSRF-Token':csrf},body:method==='GET'?undefined:JSON.stringify(body??{})});
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
