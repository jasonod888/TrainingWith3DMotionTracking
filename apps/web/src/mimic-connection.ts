import {request} from './api';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PracticeAction} from '../../../packages/learning-engine/practice-session';
export type Pair={id:string;token:string;code?:string};
export type RemoteState={epoch:1;sequence:number;time:number;speed:number;playing:boolean;phase:string;remaining:number;index:number;end:number;ack:number;angle:number;model_mirror:boolean;camera_mirror:boolean;server_time:number};
export type PairStatus={approved:boolean;pending:boolean;receiver_online:boolean;snapshot:RemoteState|Record<string,never>;commands:{id:string;action:PracticeAction;sequence:number;at:number}[];manifest:LessonManifest|null;signal:string|null;server_time:number};
export const pairRequest=<T>(pair:Pair,suffix='',method='GET',body?:unknown,keepalive=false)=>request<T>(`/mimic-pairs/${pair.id}${suffix}`,method,body,keepalive,{'X-Mimic-Token':pair.token});

export async function waitIce(pc:RTCPeerConnection){if(pc.iceGatheringState==='complete')return;await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',change);resolve();};const change=()=>{if(pc.iceGatheringState==='complete')done();};const timer=setTimeout(done,2500);pc.addEventListener('icegatheringstatechange',change);});}
