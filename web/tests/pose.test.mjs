import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HeightCalibration,assessStanding,heightPlacement,fromReference,comparePoses,bestMatch,videoFit,MP,SAM} from '../dist/pose.js';
const reference=JSON.parse(readFileSync(new URL('../dist/assets/reference.json',import.meta.url)));
function standing(){
  const image=Array.from({length:33},()=>({x:.5,y:.18,z:0,visibility:.99,presence:.99}));
  for(const [i,x,y] of [[11,.4,.3],[12,.6,.3],[23,.45,.55],[24,.55,.55],[25,.45,.72],[26,.55,.72],[27,.45,.87],[28,.55,.87],[29,.45,.88],[30,.55,.88],[31,.44,.9],[32,.56,.9]])Object.assign(image[i],{x,y});
  return {image,world:image.map(p=>({...p}))};
}
test('calibration rejects occlusion, cropped feet, and bent knees',()=>{
  let {image,world}=standing();assert.equal(assessStanding(image,world).ok,true);
  image[31].visibility=.2;assert.equal(assessStanding(image,world).ok,false);
  ({image,world}=standing());image[27].y=.99;assert.equal(assessStanding(image,world).ok,false);
  ({image,world}=standing());world[25].x=.7;assert.equal(assessStanding(image,world).ok,false);
});
test('malformed landmarks are rejected instead of throwing or becoming eligible',()=>{
  const {image,world}=standing();
  assert.equal(assessStanding(image.slice(0,20),world.slice(0,20)).reason,'invalid');
  assert.equal(assessStanding([],[]).reason,'no_person');
  assert.equal(assessStanding(null,world).reason,'no_person');
  assert.equal(assessStanding(undefined,undefined).reason,'no_person');
  const missing=image.slice();missing[12]=null;
  assert.equal(assessStanding(missing,world).reason,'invalid');
  for(const [label,mutate] of [
    ['NaN coordinate',point=>{point[27].x=NaN;}],
    ['NaN vertical coordinate',point=>{point[28].y=NaN;}],
    ['NaN depth',point=>{point[0].z=NaN;}],
    ['Infinity coordinate',point=>{point[0].x=Infinity;}],
    ['missing visibility',point=>{point[23].visibility=undefined;}],
    ['NaN visibility',point=>{point[24].visibility=NaN;}],
    ['NaN presence',point=>{point[25].presence=NaN;}],
  ]){
    const points=image.map(point=>({...point}));
    mutate(points);
    const worldPoints=points.map(point=>({...point}));
    const result=assessStanding(points,worldPoints);
    assert.equal(result.ok,false,label+' must not be eligible');
    assert.ok(result.reason&&result.detail,label+' needs a structured reason');
    assert.equal(typeof result.message,'string');
  }
  const nanWorld=world.map(point=>({...point}));nanWorld[25].x=NaN;
  assert.equal(assessStanding(image,nanWorld).reason,'invalid');
});
test('structural reasons distinguish every standing failure and none of them are message-parsed',()=>{
  const reasons={};
  let {image,world}=standing();reasons.eligible=assessStanding(image,world);
  ({image,world}=standing());image[11].visibility=.2;image[12].visibility=.2;reasons.occluded=assessStanding(image,world);
  ({image,world}=standing());image[31].y=.99;reasons.edge=assessStanding(image,world);
  ({image,world}=standing());world[25].x=.7;reasons.posture=assessStanding(image,world);
  ({image,world}=standing());image.forEach(point=>{point.y=.5+(point.y-.5)*.3;});reasons.small=assessStanding(image,world);
  ({image,world}=standing());
  image.slice(0,9).forEach(point=>{point.y=.09;});
  image.slice(27).forEach(point=>{point.y=.97;});
  reasons.large=assessStanding(image,world);
  ({image,world}=standing());image.slice(0,9).forEach(point=>{point.y=.03;});
  reasons.crown=assessStanding(image,world);

  assert.equal(reasons.eligible.ok,true);
  assert.equal(reasons.eligible.reason,'eligible');
  assert.ok(reasons.eligible.height>0&&Number.isFinite(reasons.eligible.scale));
  assert.equal(reasons.eligible.edge,null);
  assert.equal(reasons.occluded.reason,'occluded');
  assert.equal(reasons.posture.reason,'not_standing');
  assert.equal(reasons.small.reason,'too_small');
  assert.equal(reasons.edge.reason,'out_of_frame');
  assert.equal(reasons.edge.edge.bottom,true);
  assert.equal(reasons.large.reason,'too_large');
  assert.equal(reasons.crown.reason,'out_of_frame');
  assert.equal(reasons.crown.detail,'crown_clipped');
  assert.equal(reasons.crown.edge.top,true);

  // Direction copy: only a genuinely small body may be told to move closer.
  assert.match(reasons.small.message,/closer/);
  for(const blocked of [reasons.large,reasons.crown,reasons.edge])assert.doesNotMatch(blocked.message,/closer/);
  assert.match(reasons.large.message,/back/);
  assert.match(reasons.crown.message,/back/);
});
test('the legacy estimator refuses malformed input without throwing or locking',()=>{
  const c=new HeightCalibration(),{image,world}=standing();
  const poisoned=image.slice();poisoned[27].x=NaN;
  let result;
  for(let i=0;i<40;i++)result=c.sample(poisoned,world,i*100);
  assert.equal(c.locked,null);
  assert.equal(result.done,undefined);
  assert.equal(result.progress,0);
  assert.equal(result.reason,'invalid');
  assert.doesNotThrow(()=>c.sample(image.slice(0,20),world.slice(0,20),4000));
  assert.equal(c.locked,null);
});
test('height locks only after stable upright sampling, then stays fixed during a crouch',()=>{
  const c=new HeightCalibration(),{image,world}=standing();let result;
  for(let i=0;i<29;i++)result=c.sample(image,world,i*100);
  assert.equal(c.locked,null);
  result=c.sample(image,world,2900);assert.equal(result.done,true);
  const locked={...result.value};world[25].x=.9;image[0].y=.4;
  assert.deepEqual(c.sample(image,world,4000).value,locked);
  c.reset();assert.equal(c.locked,null);
});
test('unstable camera/body size does not calibrate',()=>{
  const c=new HeightCalibration(),{image,world}=standing();
  const base=image.map(p=>p.y);
  for(let i=0;i<70;i++){image.forEach((p,j)=>p.y=base[j]+(i%2?.04:0));c.sample(image,world,i*100);}
  assert.equal(c.locked,null);
});
test('a gap in tracking restarts calibration instead of locking from stale samples',()=>{
  const c=new HeightCalibration(),{image,world}=standing();
  for(let i=0;i<28;i++)c.sample(image,world,i*90);
  const result=c.sample(image,world,4000);
  assert.equal(c.locked,null);assert.equal(result.progress,0);
});
test('height matching accounts for letterboxing and aligns both floor levels',()=>{
  const calibration={height:.7,floor:.9};const p=heightPlacement(calibration,1280,720,500,600,3,1.8);
  const fit=videoFit(1280,720,500,600);
  assert.ok(Math.abs(p.scale*1.8/3*600-.7*fit.height)<1e-8);
  assert.ok(Math.abs((.5-p.floorY/3)*600-(fit.y+.9*fit.height))<1e-8);
});
test('pose score is invariant to user height and body translation',()=>{
  const target=fromReference(reference.keypoints[200]);
  const student=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,{...v,p:v.p.map((x,i)=>x*1.7+[3,2,-1][i])}]));
  assert.ok(comparePoses(student,target).score>99.99);
});
test('missing joints return no score instead of a penalty',()=>{
  const p=fromReference(reference.keypoints[200]);for(const k of ['ls','rs','lh','rh'])p[k].confidence=.1;
  assert.equal(comparePoses(p,p),null);
});
test('left/right mirroring is reversible and timing tolerance uses one whole pose',()=>{
  const original=reference.keypoints[200],mirrored=fromReference(original,true);
  assert.deepEqual(mirrored.lw.p,[-original[41][0],original[41][1],original[41][2]]);
  const time=reference.times[200];const match=bestMatch(fromReference(original),reference,time+.4,false,true);
  assert.ok(match.score>97);assert.ok(match.time>=time-.61&&match.time<=time+.55);
});

// ---------------------------------------------------------------- mediapipe-33
function mediaPipeRow(){
  const row=Array.from({length:33},()=>[0,0,0]);
  row[15]=[1,2,3];row[16]=[4,5,6];
  return row;
}
function mediaPipeVisibility(){
  const values=new Array(33).fill(0);values[15]=.9;values[16]=.4;
  return values;
}

test('mediapipe-33 references use MP joints and the frame-matched confidence',()=>{
  const joints=fromReference(mediaPipeRow(),false,'mediapipe-33',mediaPipeVisibility());
  assert.deepEqual(joints.lw.p,[1,2,3]);
  assert.equal(joints.lw.confidence,.9);
  assert.deepEqual(joints.rw.p,[4,5,6]);
  assert.equal(joints.rw.confidence,.4);
  // A placeholder landmark keeps a finite zero position and zero confidence.
  assert.deepEqual(joints.nose.p,[0,0,0]);
  assert.equal(joints.nose.confidence,0);
  // Fewer than 33 landmarks is not a mediapipe-33 reference at all.
  assert.equal(fromReference(new Array(20).fill([0,0,0]),false,'mediapipe-33'),null);
});

test('mirroring moves the joint, the x coordinate and the confidence together',()=>{
  const mirrored=fromReference(mediaPipeRow(),true,'mediapipe-33',mediaPipeVisibility());
  assert.deepEqual(mirrored.lw.p,[-4,5,6]);
  assert.equal(mirrored.lw.confidence,.4);
  assert.deepEqual(mirrored.rw.p,[-1,2,3]);
  assert.equal(mirrored.rw.confidence,.9);
});

test('an unscorable pose is null instead of a zero score',()=>{
  const sparse=Array.from({length:33},()=>[0,0,0]);
  sparse[15]=[.1,.2,0];
  const visibility=new Array(33).fill(0);visibility[15]=.9;
  const pose=fromReference(sparse,false,'mediapipe-33',visibility);
  assert.equal(comparePoses(pose,pose),null);
});

test('both target confidence and finite coordinates gate scoring',()=>{
  const target=fromReference(reference.keypoints[200]);
  const weakTarget=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,{...v,confidence:.2}]));
  assert.equal(comparePoses(target,weakTarget),null);
  const broken=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,{...v,p:[NaN,v.p[1],v.p[2]]}]));
  assert.equal(comparePoses(target,broken),null);
});

test('bestMatch reads the landmark format and visibility from the reference',()=>{
  const source=reference.keypoints[200];
  const row=Array.from({length:33},()=>[0,0,0]);
  for(const [name,index] of Object.entries(MP))row[index]=[...source[SAM[name]]];
  const visibility=new Array(33).fill(.95);
  const mediaPipeReference={duration:1,times:[0],keypoints:[row],landmarkFormat:'mediapipe-33',visibility:[visibility]};
  const student=fromReference(row,false,'mediapipe-33',visibility);
  const match=bestMatch(student,mediaPipeReference,0,false,false);
  assert.ok(match&&match.score>99);
  // Hidden confidence rows make the same reference unscorable rather than a zero.
  const hidden={...mediaPipeReference,visibility:[new Array(33).fill(0)]};
  assert.equal(bestMatch(student,hidden,0,false,false),null);
});
