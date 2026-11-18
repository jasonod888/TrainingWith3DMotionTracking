import {validateSections, type Section} from '../lesson-schema/index';
export type Command = 'next' | 'back' | 'again' | 'pause' | 'play';
export type PlaybackState = {time:number; index:number; playing:boolean; speed:number; mode:'sections'|'continuous'; calibrating:boolean};

export class Playback {
  sections: Section[];
  state: PlaybackState={time:0,index:-1,playing:false,speed:1,mode:'sections',calibrating:false};
  private listeners=new Set<()=>void>();
  constructor(sections:Section[], readonly duration:number){this.sections=validateSections(sections,duration);}
  snapshot(){return {...this.state};}
  get current(){return this.sections[this.state.index]??null;}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private notify(){for(const listener of [...this.listeners])listener();}
  /** Explicit, idempotent play; `command('play')` retains its historical toggle. */
  play(){
    const s=this.state;
    if(s.playing||s.calibrating)return;
    if(s.mode==='continuous'){if(s.time>=this.duration)s.time=0;s.playing=true;this.notify();return;}
    if(s.index<0){s.index=0;s.time=0;}
    else if(this.current && s.time>=this.current.end-1e-6)s.time=this.current.start;
    s.playing=true;this.notify();
  }
  pause(){if(this.state.playing){this.state.playing=false;this.notify();}}
  command(command:Command){
    const s=this.state;
    if(command==='pause'){this.pause();return;}
    if(s.calibrating)return;
    if(command==='play'){
      if(s.playing){this.pause();return;}
      this.play();return;
    }
    s.mode='sections';
    if(command==='next'){
      if(s.index>=this.sections.length-1){s.time=this.duration;s.playing=false;this.notify();return;}
      s.index++;
    }else if(command==='back')s.index=Math.max(0,s.index-1);
    else s.index=Math.max(0,s.index);
    s.time=this.sections[s.index].start;s.playing=true;this.notify();
  }
  tick(delta:number){
    if(!this.state.playing || !Number.isFinite(delta) || delta<0)return;
    const end=this.state.mode==='sections' ? this.current?.end??this.duration : this.duration;
    const before=this.state.time;
    this.state.time=Math.min(end,this.state.time+delta*this.state.speed);
    if(this.state.time>=end)this.state.playing=false;
    if(this.state.mode==='continuous')this.updateIndex();
    if(this.state.time!==before)this.notify();
  }
  updateIndex(){this.state.index=this.sections.findIndex((s,i)=>this.state.time>=s.start && (this.state.time<s.end || i===this.sections.length-1));}
  seek(time:number){if(!Number.isFinite(time))return;this.state.time=Math.max(0,Math.min(this.duration,time));this.state.playing=false;this.updateIndex();this.notify();}
  speed(value:number){if([.25,.5,.75,1].includes(value)&&this.state.speed!==value){this.state.speed=value;this.notify();}}
  mode(value:'sections'|'continuous'){this.state.mode=value;this.state.playing=false;this.updateIndex();this.notify();}
  calibrating(value:boolean){this.state.calibrating=value;this.state.playing=false;this.notify();}
  replace(sections:Section[]){this.sections=validateSections(sections,this.duration);this.seek(this.state.time);}
}
