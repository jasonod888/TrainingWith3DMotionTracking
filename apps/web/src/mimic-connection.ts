import {request} from './api';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import type {PracticeAction} from '../../../packages/learning-engine/practice-session';
import type {LensStatus, ProtocolFacing} from './camera-policy';
export type Pair={id:string;token:string;code?:string};
export type CameraStatus='off'|'starting'|'live'|'interrupted'|'failed';
export type SetupPhase='prepare'|'starting'|'positioning'|'measuring'|'ready'|'handoff'|'help'|'error'|'cancelled';
/** Normalised source-space box; the receiver maps it through its own fit. */
export type GuideBox={left:number;top:number;right:number;bottom:number};
export type RemoteState={epoch:1;sequence:number;time:number;speed:number;playing:boolean;phase:string;remaining:number;index:number;end:number;ack:number;angle:number;reference?:'3d'|'video'|'both';model_mirror:boolean;camera_mirror:boolean;server_time:number;
 /** Monotonic camera/setup identity, separate from the fixed protocol epoch. */
 source_generation?:number;
 camera_status?:CameraStatus;
 camera_facing?:ProtocolFacing;
 lens_status?:LensStatus;
 source_width?:number;
 source_height?:number;
 setup_phase?:SetupPhase|null;
 setup_hint_code?:string|null;
 setup_progress?:number;
 guide?:GuideBox|null};
export type PairStatus={approved:boolean;pending:boolean;receiver_online:boolean;snapshot:RemoteState|Record<string,never>;commands:{id:string;action:PracticeAction;sequence:number;at:number}[];manifest:LessonManifest|null;signal:string|null;server_time:number;signal_generation?:number;answer_generation?:number};
export const pairRequest=<T>(pair:Pair,suffix='',method='GET',body?:unknown,keepalive=false)=>request<T>(`/mimic-pairs/${pair.id}${suffix}`,method,body,keepalive,{'X-Mimic-Token':pair.token});

/**
 * A signal is only meaningful together with the negotiation generation it
 * belongs to. Comparing the description alone would let a late answer from an
 * earlier offer overwrite a newer connection.
 */
export const signalKey=(description:string|null|undefined,generation:number|undefined|null)=>`${Number(generation)||0}:${description??''}`;

export async function waitIce(pc:RTCPeerConnection){if(pc.iceGatheringState==='complete')return;await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',change);resolve();};const change=()=>{if(pc.iceGatheringState==='complete')done();};const timer=setTimeout(done,2500);pc.addEventListener('icegatheringstatechange',change);});}
