import type {FeedbackSample} from './attempt-feedback';
import type {Attempt,PracticeSession} from './practice-session';
export type RunSection={index:number;label:string;score:number|null;coverage:number};
export type RunResult={completed:boolean;reason:string;score:number|null;coverage:number;sections:RunSection[];weakest:number|null};
/** Separate full-run policy; unobserved time counts against tracking coverage. */
export class CompetitionSession{
 enabled=false;running=false;result:RunResult|null=null;
 private samples=new Map<number,number>();
 private saved: {time:number;speed:number;mode:'sections'|'continuous';range:{start:number;end:number}|null;loop:boolean;countdown:number;repetitions:number;rest:number}|null=null;
 constructor(readonly session:PracticeSession){}
 enter(){if(this.enabled)return;const s=this.session,p=s.player;this.saved={time:p.state.time,speed:p.state.speed,mode:p.state.mode,range:s.range?{...s.range}:null,loop:s.loop,countdown:s.countdownSeconds,repetitions:s.repetitions,rest:s.restSeconds};s.pause('mode changed');this.enabled=true;this.configure();this.result=null;}
 leave(){this.running=false;this.session.pause('mode changed');this.enabled=false;this.result=null;const v=this.saved,s=this.session;if(v){s.range=v.range;s.loop=v.loop;s.countdownSeconds=v.countdown;s.repetitions=v.repetitions;s.restSeconds=v.rest;s.player.mode(v.mode);s.player.speed(v.speed);s.player.seek(v.time);}this.saved=null;}
 private configure(){const s=this.session;s.range=null;s.loop=false;s.repetitions=0;s.countdownSeconds=5;s.player.mode('continuous');s.player.speed(1);s.player.seek(0);}
 start(){if(!this.enabled||this.running||this.session.player.state.calibrating)return false;this.session.pause('new run');this.configure();this.samples.clear();this.result=null;this.running=true;this.session.start();return true;}
 tick(delta:number){const s=this.session;if(this.running&&(delta>1||s.player.state.speed!==1||s.player.state.mode!=='continuous'||s.range!==null||s.loop)){s.pause('run settings or playback interrupted');return;}s.tick(this.running?delta:Math.min(delta,.25));}
 sample(time:number,value:FeedbackSample){if(!this.running||this.session.phase!=='playing'||!Number.isFinite(time)||time<0||time>=this.session.player.duration)return;const bin=Math.floor(time*10);if(value.score!==null&&Number.isFinite(value.score)&&value.score>=0&&value.score<=100&&value.coverage>=.75)this.samples.set(bin,value.score);else this.samples.delete(bin);}
 private measure(start:number,end:number){let tracked=0,total=0;for(const [bin,score] of this.samples){const overlap=Math.max(0,Math.min(end,(bin+1)/10)-Math.max(start,bin/10));tracked+=overlap;total+=score*overlap;}const coverage=Math.min(1,tracked/(end-start));return {score:coverage+1e-9>=.6&&tracked>0?Math.round(total/tracked):null,coverage};}
 interrupt(reason:string){if(!this.running)return false;this.running=false;this.result={completed:false,reason,score:null,coverage:0,sections:[],weakest:null};return true;}
 finish(attempt:Attempt){if(!this.enabled||!this.running)return;if(!attempt.completed){this.interrupt(attempt.reason);return;}this.running=false;const p=this.session.player,overall=this.measure(0,p.duration),sections=p.sections.map((section,index)=>({index,label:section.label,...this.measure(section.start,section.end)}));const reliable=overall.score!==null&&sections.every(s=>s.score!==null);this.result={completed:true,reason:'completed',score:reliable?overall.score:null,coverage:overall.coverage,sections,weakest:reliable?sections.reduce((best,item)=>(item.score??Infinity)<(sections[best].score??Infinity)?item.index:best,0):null};}
}

