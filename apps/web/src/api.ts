import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {clearClips} from './clipCache';
export async function loadDemo(signal?:AbortSignal):Promise<LessonManifest|null>{
  const response=await fetch('/api/demo',{signal});
  if(response.status===404)return null;
  if(!response.ok)throw new Error('Your lesson could not be loaded. Try again.');
  const value=await response.json() as LessonManifest;
  if(value.schema_version!==1)throw new Error('This lesson format is not supported.');
  return value;
}
export const assetUrl=(key:string)=>key.startsWith('public/')?`/api/public/moves/${encodeURIComponent(key.split('/')[1])}/assets/${encodeURIComponent(key.split('/').pop()!)}`:key.startsWith('lessons/')?`/api/lessons/${encodeURIComponent(key.split('/')[1])}/assets/${encodeURIComponent(key.split('/').pop()!)}`:`/api/demo/assets/${encodeURIComponent(key.split('/').pop()!)}`;

export type Account={id:string;email:string;platform_role:'member'|'admin'|'super_admin';status:string;mfa_enrolled:boolean};
export type SessionInfo={account:Account;csrf:string};
let csrf='';
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
export async function request<T>(path:string,method='GET',body?:unknown,keepalive=false,extraHeaders:Record<string,string>={}):Promise<T>{
 const response=await fetch(`/api${path}`,{method,keepalive,credentials:'same-origin',headers:{...(method==='GET'?{}:{'Content-Type':'application/json','X-Form-Request':'1','X-CSRF-Token':csrf}),...extraHeaders},body:method==='GET'?undefined:JSON.stringify(body??{})});
 if(!response.ok){const data=await response.json().catch(()=>null);throw new ApiError(typeof data?.detail==='string'?data.detail:'Something went wrong. Please try again.',response.status);}
 return response.json();
}
export async function getSession():Promise<SessionInfo|null>{
 try{const value=await request<SessionInfo>('/auth/session');csrf=value.csrf;return value;}catch(e){if(e instanceof ApiError&&e.status===401){csrf='';return null;}throw e;}
}
export async function signIn(email:string,password:string){const value=await request<SessionInfo>('/auth/login','POST',{email,password});csrf=value.csrf;return value.account;}
export async function signOut(){await request('/auth/logout','POST');csrf='';await clearClips().catch(()=>{});}
export const loadLibrary=()=>request<LessonManifest[]>('/lessons');
export const loadLesson=(id:string)=>request<LessonManifest>(`/lessons/${encodeURIComponent(id)}`);
export const copyDemo=()=>request<LessonManifest>('/lessons/from-demo','POST');
export const saveSections=(lesson:LessonManifest,sections:LessonManifest['section_set']['sections'],title:string)=>request<LessonManifest>(`/lessons/${encodeURIComponent(lesson.lesson_id)}/sections`,'PUT',{base_revision_id:lesson.revision_id,sections,title});
export const renameMove=(id:string,title:string)=>request<LessonManifest>(`/lessons/${encodeURIComponent(id)}`,'PATCH',{title});

export type MoveAudiences={direct:number;groups:number;public:boolean};
export type PublicListing={title:string;creator_name:string;tags:string[];listed_at:string|null};
export type MoveState={lesson_id:string;latest_revision_id:string|null;accepted_revision_id:string|null;accepted_at:string|null;
 published_revision_id:string|null;distribution:string;audiences:MoveAudiences;public_listing:PublicListing|null;warnings?:string[]};
export const loadMoveStates=()=>request<{lessons:MoveState[]}>('/workflow/lessons');
export const acceptMove=(lessonId:string,revisionId:string,warnings:string[]=[])=>
 request<MoveState&{warnings:string[]}>(`/workflow/lessons/${encodeURIComponent(lessonId)}/accept`,'POST',{revision_id:revisionId,warnings});
export const needsCheck=(lesson:LessonManifest,state:MoveState|undefined)=>!!state&&state.accepted_revision_id!==lesson.revision_id;
export const audienceLabel=(audiences:MoveAudiences)=>{
 if(audiences.public)return 'Public';
 const parts=[];
 if(audiences.direct)parts.push(`${audiences.direct} ${audiences.direct===1?'person':'people'}`);
 if(audiences.groups)parts.push(`${audiences.groups} ${audiences.groups===1?'group':'groups'}`);
 return parts.length?parts.join(' · '):'Only you';
};

export type GroupSummary={id:string;name:string;description:string;role:'owner'|'admin'|'member';members:number;moves:number};
export type GroupMemberView={account_id:string;email:string;role:string;joined_at:string};
export type GroupMoveView={lesson_id:string;title:string;revision_id:string;duration:number;sections:number;access_kind:'grant'|'collection';can_remove:boolean};
export type GroupDetail={id:string;name:string;description:string;role:string;can_manage:boolean;contribution_policy:'members'|'managers';invitations:{id:string;email:string;role:string;expires_at:string}[];members:GroupMemberView[];moves:GroupMoveView[]};
export const loadGroups=()=>request<{groups:GroupSummary[]}>('/groups');
export const createGroup=(name:string,description='')=>request<GroupSummary>('/groups','POST',{name,description});
export const loadGroup=(id:string)=>request<GroupDetail>(`/groups/${encodeURIComponent(id)}`);
export const inviteToGroup=(id:string,email:string)=>request(`/groups/${encodeURIComponent(id)}/invitations`,'POST',{email});
export const inspectGroupInvite=(invite:string)=>request<{name:string;description:string;members:number}>('/groups/inspect','POST',{invite});
export const joinGroup=(invite:string)=>request<GroupSummary>('/groups/join','POST',{invite});
export const addMoveToGroup=(id:string,lessonId:string,accessKind:'grant'|'collection'='grant')=>request(`/groups/${encodeURIComponent(id)}/lessons`,'POST',{lesson_id:lessonId,access_kind:accessKind});
export const removeGroupMove=(id:string,lessonId:string,accessKind:'grant'|'collection'='grant')=>request(`/groups/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lessonId)}?access_kind=${accessKind}`,'DELETE');
export const removeGroupMember=(id:string,accountId:string)=>request(`/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(accountId)}`,'DELETE');
export const transferGroup=(id:string,accountId:string)=>request(`/groups/${encodeURIComponent(id)}/transfer`,'POST',{account_id:accountId});

export type PublicMove={lesson_id:string;title:string;creator_name:string;description:string;tags:string[];duration:number;thumbnail_url:string|null};
export type PublicDetail=LessonManifest&{creator_name:string;description:string;tags:string[]};
export const loadPublicMoves=(query='',tag='',offset=0)=>request<{moves:PublicMove[]}>(`/public/moves?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&offset=${offset}`);
export const loadPublicTags=()=>request<{tags:{tag:string;count:number}[]}>('/public/tags');
export const loadPublicMove=(id:string)=>request<PublicDetail>(`/public/moves/${encodeURIComponent(id)}`);
export const updatePublic=(lessonId:string,body:{listed:boolean;title?:string;description?:string;creator_name?:string;tags?:string[];rights_acknowledged?:boolean;release_revision_id?:string})=>
 request(`/public/lessons/${encodeURIComponent(lessonId)}`,'PATCH',body);

export type Progress={revision_id:string;time:number;speed:.25|.5|.75|1;mode:'sections'|'continuous'};
export const loadProgress=(lesson:LessonManifest)=>request<Progress|null>(`/lessons/${lesson.lesson_id}/progress?revision_id=${encodeURIComponent(lesson.revision_id)}`);
export const saveProgress=(lesson:LessonManifest,value:Omit<Progress,'revision_id'>)=>request(`/lessons/${lesson.lesson_id}/progress`,'PUT',{revision_id:lesson.revision_id,...value},true);
export function uploadChunk(jobId:string,part:number,body:Blob,signal:AbortSignal,progress:(bytes:number)=>void):Promise<void>{
 return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/conversions/${jobId}/parts/${part}`);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-Form-Request','1');xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.timeout=120000;
 const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});const clean=()=>signal.removeEventListener('abort',abort);
 xhr.upload.onprogress=e=>progress(e.loaded);xhr.onload=()=>{clean();if(xhr.status>=200&&xhr.status<300)resolve();else{let message='Upload stopped. You can resume it from your library.';try{message=JSON.parse(xhr.responseText).detail??message;}catch{}reject(new ApiError(message,xhr.status));}};xhr.onerror=xhr.ontimeout=()=>{clean();reject(new Error('Connection interrupted. Resume the upload from your library.'));};xhr.onabort=()=>{clean();reject(new DOMException('Upload paused.','AbortError'));};if(signal.aborted){clean();reject(new DOMException('Upload paused.','AbortError'));return;}xhr.send(body);
 });
}
