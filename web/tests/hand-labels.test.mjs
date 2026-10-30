import test from 'node:test';
import assert from 'node:assert/strict';
import {liveHandPositions,placeHandLabels} from '../dist/hand-labels.js';

test('front-camera mirroring reflects hand positions without exchanging anatomical labels',()=>{
  const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:1,presence:1}));
  points[15].x=.2;points[16].x=.8;
  const normal=liveHandPositions(points,100,100,400,400,false);
  const mirrored=liveHandPositions(points,100,100,400,400,true);
  assert.equal(normal.left.x,80);assert.equal(normal.right.x,320);
  assert.equal(mirrored.left.x,320);assert.ok(Math.abs(mirrored.right.x-80)<1e-9);
});
test('uncertain live wrists hide their labels rather than displaying a stale position',()=>{
  const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:1,presence:1}));
  points[15].visibility=.2;
  assert.equal(liveHandPositions(points,100,100,400,400).left,null);
  assert.equal(liveHandPositions(null,100,100,400,400).right,null);
});
test('crossed or touching hands keep both letters readable',()=>{
  const labels={left:{style:{}},right:{style:{}}};
  placeHandLabels(labels,{left:{x:100,y:100},right:{x:100,y:100}},400,400);
  assert.equal(labels.left.hidden,false);assert.equal(labels.right.hidden,false);
  assert.notEqual(labels.left.style.left,labels.right.style.left);
});
