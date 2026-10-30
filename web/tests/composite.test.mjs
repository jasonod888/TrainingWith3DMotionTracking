import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedAvatarPosition,compositeOffset} from '../dist/composite.js';

test('avatar side is screen-relative with either camera reflection',()=>{
  const calibration={center:.3,height:.7};
  for(const mirrored of [false,true]){
    const center=mirrored?.7:.3;
    assert.ok(suggestedAvatarPosition(calibration,'left',1280,720,mirrored)<center);
    assert.ok(suggestedAvatarPosition(calibration,'right',1280,720,mirrored)>center);
  }
});
test('portrait camera placement stays inside the visible image',()=>{
  assert.equal(suggestedAvatarPosition({center:.8,height:.9},'right',720,1280),.88);
  assert.equal(suggestedAvatarPosition({center:.2,height:.9},'left',720,1280),.12);
});
test('composite projection accounts for camera letterboxing and stage aspect',()=>{
  // Square image in a wide stage has 300px margins on each side.
  const position=compositeOffset(.75,1000,1000,1200,600,3);
  assert.equal(position.pixelX,750);
  assert.equal(position.worldX,.75);
  // Project the world coordinate back through the orthographic camera.
  assert.equal(1200/2+position.worldX*600/3,position.pixelX);
  assert.equal(compositeOffset(.5,1920,1080,400,800,3).worldX,0);
});
