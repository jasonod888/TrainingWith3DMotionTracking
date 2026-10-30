import {Playback, type Command} from './playback';

export type PracticeAction = Command | 'resume' | 'slower' | 'faster' | 'loop';
export type Attempt = {id:string;start:number;end:number;completed:boolean;reason:string};
/** The sole owner of countdowns, repetitions and attempt boundaries. Uses monotonic deltas. */
export class PracticeSession {
  countdownSeconds=3;
  remaining=0;
  phase:'paused'|'countdown'|'playing'|'rest'='paused';
  loop=false;
  repetitions=0; // zero means until stopped
  completed=0;
  restSeconds=2;
  range:{start:number;end:number}|null=null;
  onAttempt?:(attempt:Attempt)=>void;
  onAttemptStart?:(time:number)=>void;
  private attempt:{id:string;start:number}|null=null;
  constructor(readonly player:Playback){}
  get bounds(){return this.range??(this.player.state.mode==='sections'?(this.player.current??this.player.sections[0]):{start:0,end:this.player.duration});}
  private finish(completed:boolean,reason:string){if(this.attempt){this.onAttempt?.({...this.attempt,end:this.player.state.time,completed,reason});this.attempt=null;}}
  pause(reason='paused'){this.remaining=0;this.phase='paused';this.player.command('pause');this.finish(false,reason);}
  setRange(start:number,end:number){
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>this.player.duration||end-start<.05)throw new Error('Choose a range inside this lesson, at least 0.05 seconds long.');
    this.pause('range changed');this.range={start,end};this.player.mode('continuous');this.player.seek(start);this.completed=0;
  }
  seek(time:number){this.pause('position changed');this.player.seek(this.range?Math.max(this.range.start,Math.min(this.range.end,time)):time);}
  select(index:number){if(!this.player.sections[index])return;this.pause('section changed');this.range=null;this.player.mode('sections');this.player.seek(this.player.sections[index].start);this.completed=0;}
  private begin(){
    const p=this.player,b=this.bounds;if(p.state.index<0)p.seek(b.start);if(p.state.time<b.start||p.state.time>=b.end-1e-6)p.seek(b.start);
    p.state.playing=true;this.phase='playing';this.attempt={id:crypto.randomUUID(),start:p.state.time};this.onAttemptStart?.(p.state.time);
  }
  start(){if(this.player.state.calibrating)return;this.remaining=this.countdownSeconds;this.phase=this.remaining>0?'countdown':'playing';if(!this.remaining)this.begin();}
  action(action:PracticeAction){
    if(action==='pause'){this.pause();return;}
    if(this.player.state.calibrating)return;
    if(action==='slower'||action==='faster'){const speeds=[.25,.5,.75,1];const i=speeds.indexOf(this.player.state.speed);this.player.speed(speeds[Math.max(0,Math.min(3,i+(action==='slower'?-1:1)))]);return;}
    if(action==='loop'){this.loop=!this.loop;return;}
    if(action==='play'&&(this.phase==='playing'||this.phase==='countdown'||this.phase==='rest')){this.pause();return;}
    if(action==='resume'&&this.phase!=='paused')return;
    if(this.phase==='paused')this.completed=0;
    if(action==='next'||action==='back'||action==='again'){
      this.pause('navigation');this.completed=0;
      if(action==='again')this.player.seek(this.bounds.start);
      else {this.range=null;this.player.command(action);this.player.command('pause');if(action==='next'&&this.player.state.time>=this.player.duration)return;}
    }
    this.start();
  }
  tick(delta:number){
    if(!Number.isFinite(delta)||delta<0)return;
    if(this.player.state.calibrating){if(this.phase!=='paused')this.pause('calibration');return;}
    if(this.phase==='countdown'||this.phase==='rest'){
      this.remaining=Math.max(0,this.remaining-delta);
      if(!this.remaining)this.begin();return;
    }
    if(this.phase!=='playing')return;
    if(!this.player.state.playing){this.pause('interrupted');return;}
    const end=this.bounds.end;
    this.player.tick(delta);
    if(this.player.state.time>=end-1e-6){
      this.player.state.time=end;this.player.command('pause');this.finish(true,'completed');this.completed++;
      if(this.loop&&(!this.repetitions||this.completed<this.repetitions)){
        this.remaining=this.restSeconds;this.phase='rest';this.player.seek(this.bounds.start);if(!this.remaining)this.begin();
      }else this.phase='paused';
    }
  }
}
