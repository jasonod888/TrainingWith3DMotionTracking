import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPianoSourceController} from '../src/music/piano-source-controller';

let serial=0;const frames=new Map<number,FrameRequestCallback>();
globalThis.requestAnimationFrame=(callback:FrameRequestCallback)=>{frames.set(++serial,callback);return serial;};
globalThis.cancelAnimationFrame=(id:number)=>{frames.delete(id);};
class Media extends EventTarget{
 currentTime=1;duration=20;paused=false;ended=false;seeking=false;readyState=4;
 muted=false;volume=.4;playbackRate=1;preservesPitch=true;plays=0;reject=false;
 pause(){this.paused=true;}
 play(){this.plays++;if(this.reject)return Promise.reject(new Error('blocked'));this.paused=false;return Promise.resolve();}
 event(name:string){this.dispatchEvent(new Event(name));}
}
function setup(){const source=new Media(),piano=new Media();let state:any;let failures=0;
 const controller=createPianoSourceController(source as unknown as HTMLMediaElement,piano as unknown as HTMLMediaElement,value=>state=value,()=>failures++);
 return {source,piano,controller,state:()=>state,failures:()=>failures};}

test('explicit small offsets and seeks bypass steady-state drift hysteresis',()=>{
 const p=setup();p.controller.configure('piano',0);p.controller.configure('piano',.01);
 assert.equal(p.piano.currentTime,.99);p.source.currentTime=1.02;p.source.event('seeked');
 assert.equal(p.piano.currentTime,1.01);p.controller.destroy();
});
test('waiting and seeking hold piano through timeupdate until source resumes',()=>{
 const p=setup();p.controller.configure('piano',0);p.source.event('waiting');p.source.event('timeupdate');
 assert.equal(p.piano.paused,true);p.source.event('playing');assert.equal(p.piano.paused,false);
 p.source.event('seeking');p.source.event('timeupdate');assert.equal(p.piano.paused,true);
 p.source.currentTime=5;p.source.event('seeked');assert.equal(p.piano.currentTime,5);p.controller.destroy();
});
test('rejected piano playback restores original and surfaces an error',async()=>{
 const p=setup();p.piano.reject=true;p.controller.configure('piano',0);await Promise.resolve();
 assert.equal(p.source.muted,false);assert.equal(p.failures(),1);assert.match(p.state().error,/could not play/);p.controller.destroy();
});
test('late preview readiness forces correct mapping and does not start early',()=>{
 const p=setup();p.piano.readyState=0;p.piano.duration=Number.NaN;p.controller.configure('piano',-.2);
 assert.equal(p.piano.plays,0);p.piano.readyState=4;p.piano.duration=20;p.piano.event('canplay');
 assert.equal(p.piano.currentTime,1.2);assert.equal(p.piano.paused,false);p.controller.destroy();
});
test('canplay after a seek does not repeatedly seek a moving piano target',()=>{
 const p=setup();p.controller.configure('piano',0);p.source.currentTime+=.005;
 p.piano.event('canplay');assert.equal(p.piano.currentTime,1);
 p.source.currentTime+=.005;p.piano.event('canplay');assert.equal(p.piano.currentTime,1);
 p.controller.destroy();
});
test('network stalled with playable buffered data does not silence piano',()=>{
 const p=setup();p.controller.configure('piano',0);p.source.event('stalled');
 assert.equal(p.piano.paused,false);p.source.readyState=2;p.source.event('stalled');
 assert.equal(p.piano.paused,true);p.controller.destroy();
});
test('small steady drift is corrected without repeated audio seeks',()=>{
 const p=setup();p.controller.configure('piano',0);p.source.currentTime=1.08;p.source.event('timeupdate');
 assert.equal(p.piano.currentTime,1);assert.ok(p.piano.playbackRate>1);assert.equal(p.piano.paused,false);
 p.source.currentTime=3;p.source.event('timeupdate');assert.equal(p.piano.currentTime,3);p.controller.destroy();
});
test('mapped silence, rate, volume, ending and cleanup follow source',()=>{
 const p=setup();p.source.currentTime=0;p.controller.configure('piano',.12);assert.equal(p.piano.paused,true);
 p.source.currentTime=.2;p.source.event('timeupdate');assert.ok(Math.abs(p.piano.currentTime-.08)<1e-9);
 p.source.volume=.2;p.source.event('volumechange');assert.equal(p.piano.volume,.2);
 p.source.playbackRate=1.5;p.source.event('ratechange');assert.equal(p.piano.playbackRate,1.5);
 p.source.ended=true;p.source.event('ended');assert.equal(p.piano.paused,true);
 p.controller.destroy();assert.equal(p.source.muted,false);assert.equal(frames.size,0);
});
