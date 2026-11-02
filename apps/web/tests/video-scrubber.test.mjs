import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createVideoScrubber} from '../src/video-scrubber.ts';

function fixture(){
 const callbacks=new Map();let id=0,position=0;const seeks=[];
 class Video extends EventTarget {
  seeking=false;paused=true;pause(){this.paused=true;}
  get currentTime(){return position;}
  set currentTime(time){assert.equal(this.seeking,false,'a new seek must not interrupt decoding');this.seeking=true;position=time;seeks.push({time,precise:true});}
  finish(){this.seeking=false;this.dispatchEvent(new Event('seeked'));}
 }
 const video=new Video();
 const controller=createVideoScrubber(video,{request:fn=>{callbacks.set(++id,fn);return id;},cancel:id=>callbacks.delete(id)});
 const frame=()=>{const work=[...callbacks.values()];callbacks.clear();work.forEach(fn=>fn());};
 return {video,seeks,controller,frame,callbacks};
}

test('rapid movements never restart an unfinished decode and keep only the latest target',()=>{
 const {video,seeks,controller,frame}=fixture();
 controller.seek(1);frame();
 for(let i=2;i<=100;i++){controller.seek(i/10);frame();}
 assert.deepEqual(seeks,[{time:1,precise:true}]);
 video.finish();frame();assert.deepEqual(seeks.at(-1),{time:10,precise:true});
 controller.seek(11.25);video.finish();frame();
 assert.deepEqual(seeks.at(-1),{time:11.25,precise:true});video.finish();assert.equal(controller.busy(),false);
 controller.dispose();
});

test('releasing at the latest target commits an exact frame and preserves zero as a seek target',()=>{
 const {video,seeks,controller,frame}=fixture();
 controller.seek(3.78);frame();controller.seek(3.78);video.finish();frame();
 assert.equal(seeks.length,1);assert.equal(controller.busy(),false);
 controller.seek(0);frame();assert.deepEqual(seeks.at(-1),{time:0,precise:true});
 video.finish();assert.equal(controller.busy(),false);controller.dispose();
});

test('input bursts coalesce per animation frame; cancel and dispose discard outstanding requests',()=>{
 const {video,seeks,controller,frame,callbacks}=fixture();
 for(let i=1;i<=20;i++)controller.seek(i);
 assert.equal(callbacks.size,1);frame();assert.deepEqual(seeks,[{time:20,precise:true}]);
 controller.seek(30);controller.cancel();video.finish();frame();assert.equal(seeks.length,1);
 controller.seek(40);controller.dispose();frame();assert.equal(seeks.length,1);
});

test('a native video seek is allowed to finish before the pending trim request',()=>{
 const {video,seeks,controller,frame}=fixture();
 video.seeking=true;controller.seek(5);frame();assert.equal(seeks.length,0);
 video.finish();frame();assert.equal(seeks[0].time,5);controller.dispose();
});
