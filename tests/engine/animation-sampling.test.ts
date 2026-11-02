import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClip,VectorKeyframeTrack,QuaternionKeyframeTrack,InterpolateDiscrete,InterpolateLinear} from '../../apps/web/node_modules/three/build/three.module.js';
import {continuousPlayback} from '../../apps/web/src/animation-sampling';

test('native step tracks and converted tracks use identical interpolation without changing samples',()=>{
  const tracks=[new VectorKeyframeTrack('root.position',[0,1],[0,0,0,2,1,0],InterpolateDiscrete),
    new QuaternionKeyframeTrack('arm.quaternion',[0,1],[0,0,0,1,0,0,1,0],InterpolateDiscrete)];
  const source=new AnimationClip('source',1,tracks),converted=source.clone();
  converted.tracks.forEach(track=>track.setInterpolation(InterpolateLinear));
  const a=continuousPlayback(source),b=continuousPlayback(converted);
  for(let i=0;i<a.tracks.length;i++){
    const sample=(track:any)=>Array.from(track.createInterpolant().evaluate(.5));
    assert.deepEqual(sample(a.tracks[i]),sample(b.tracks[i]));
    assert.deepEqual(Array.from(a.tracks[i].times),Array.from(source.tracks[i].times));
    assert.deepEqual(Array.from(a.tracks[i].values),Array.from(source.tracks[i].values));
  }
  assert.equal(source.tracks[0].getInterpolation(),InterpolateDiscrete);
});
