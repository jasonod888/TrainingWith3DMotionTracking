import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 CameraFramingController,FRAMING_DEFAULTS,observeBody,padBounds,fillCropFor,
 maximalCoverCrop,buildTransform,containedTransform,mapSourcePoint,cropContains,
 handPositionsForTransform,placementForTransform,
} from '../src/camera-framing.ts';
import {heightPlacement} from '../../../web/dist/pose.js';

const SOURCE_W=1280,SOURCE_H=720,PANE_W=480,PANE_H=800;

/** A complete MediaPipe-shaped pose; x positions are the anatomical extremes. */
function pose({left=.42,right=.58,wristLeft=.43,wristRight=.57,top=.15,bottom=.90}={}){
 const point=(x,y)=>({x,y,z:0,visibility:.99,presence:.99});
 const points=new Array(33).fill(null).map(()=>point(.5,.5));
 points[0]=point(.5,top);
 for(const i of [1,2,3,4,5,6])points[i]=point(.5-(i%2)*.01,top);
 for(const i of [7,8,9,10])points[i]=point(.5-(i%2)*.02,top+.01);
 points[11]=point(left+.03,.30);points[12]=point(right-.03,.30);
 points[13]=point(wristLeft+.01,.42);points[14]=point(wristRight-.01,.42);
 points[15]=point(wristLeft,.55);points[16]=point(wristRight,.55);
 for(const [i,dx] of [[17,-.005],[18,-.008],[19,-.011],[20,-.014]])points[i]=point(wristLeft+dx,.57);
 for(const [i,dx] of [[21,.005],[22,.014]])points[i]=point(wristRight+dx,.57);
 points[23]=point(left+.05,.55);points[24]=point(right-.05,.55);
 points[25]=point(left+.05,.72);points[26]=point(right-.05,.72);
 points[27]=point(left+.06,.89);points[28]=point(right-.06,.89);
 points[29]=point(left+.06,.91);points[30]=point(right-.06,.91);
 points[31]=point(left+.06,bottom);points[32]=point(right-.06,bottom);
 return points;
}

function controller(overrides={}){
 const value=new CameraFramingController();
 value.configure({sourceWidth:SOURCE_W,sourceHeight:SOURCE_H,paneWidth:PANE_W,paneHeight:PANE_H,mirrored:true,epoch:1,enabled:true,supported:true,paused:false,...overrides});
 return value;
}

function feed(value,from,to,makePose=pose,step=50){
 let update=null;
 for(let at=from;at<=to;at+=step)update=value.observe(makePose(at),at,1);
 return update;
}

function advance(value,from,to,step=16){
 let transform=null;
 for(let at=from;at<=to;at+=step)transform=value.sample(at);
 return transform;
}

test('padding uses 15%/10% of the body box with a 3% source minimum',()=>{
 const big=padBounds({left:.3,top:.2,right:.7,bottom:.8});
 const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
 close(big.left,.3-.4*.15);
 close(big.top,.2-.6*.10);
 close(big.right,.7+.4*.15);
 close(big.bottom,.8+.6*.10);
 const tiny=padBounds({left:.49,top:.49,right:.51,bottom:.51});
 close(tiny.left,.49-FRAMING_DEFAULTS.minimumPadding);
 close(tiny.bottom,.51+FRAMING_DEFAULTS.minimumPadding);
});

test('maximal cover crop matches the pane aspect and is the least magnification',()=>{
 const crop=maximalCoverCrop(SOURCE_W,SOURCE_H,.6);
 assert.equal(crop.height,SOURCE_H);
 assert.equal(Number(crop.width.toFixed(3)),Number((SOURCE_H*.6).toFixed(3)));
 assert.equal(Number((crop.width/crop.height).toFixed(6)),.6);
 const landscape=maximalCoverCrop(SOURCE_W,SOURCE_H,16/9);
 assert.equal(landscape.width,SOURCE_W);
 assert.equal(Number(landscape.height.toFixed(3)),Number((SOURCE_W/(16/9)).toFixed(3)));
});

test('padded body bounds determine a pane-aspect fill crop',()=>{
 const observation=observeBody(pose());
 assert.equal(observation.reliable,true);
 const crop=fillCropFor(observation.padded,SOURCE_W,SOURCE_H,PANE_W/PANE_H);
 assert.ok(crop);
 assert.equal(Number((crop.width/crop.height).toFixed(6)),PANE_W/PANE_H);
 assert.ok(observeBody(pose()).padded.left*SOURCE_W>=crop.x-1e-6);
 assert.ok(observation.padded.right*SOURCE_W<=crop.x+crop.width+1e-6);
 assert.ok(observation.padded.top*SOURCE_H>=crop.y-1e-6);
 assert.ok(observation.padded.bottom*SOURCE_H<=crop.y+crop.height+1e-6);
});

test('wide arms or feet at the source edge force the full-frame fallback',()=>{
 const wide=observeBody(pose({left:.08,right:.92,wristLeft:.02,wristRight:.98}));
 assert.equal(fillCropFor(wide.padded,SOURCE_W,SOURCE_H,.6),null);
 const low=observeBody(pose({bottom:.99}));
 assert.equal(low.outsideSource,true);
 assert.equal(low.reliable,true,'a complete pose at the edge is evidence for fallback, not tracking loss');
 assert.equal(fillCropFor(low.padded,SOURCE_W,SOURCE_H,.6),null);
});

test('a partial or low-visibility pose never reports reliable full-body framing',()=>{
 const partial=pose();for(const index of [27,28,31,32])partial[index].visibility=.2;
 const observation=observeBody(partial);
 assert.equal(observation.reliable,false);
 assert.equal(observation.reason,'partial');
 assert.equal(observation.feetVisible,false);
});

test('one transform maps points, mirrors once and clips to the destination',()=>{
 const crop={x:424,y:0,width:432,height:720};
 const normal=buildTransform({sourceWidth:SOURCE_W,sourceHeight:SOURCE_H,paneWidth:PANE_W,paneHeight:PANE_H,crop,mirrored:false,version:3,epoch:7});
 const mirrored=buildTransform({sourceWidth:SOURCE_W,sourceHeight:SOURCE_H,paneWidth:PANE_W,paneHeight:PANE_H,crop,mirrored:true,version:3,epoch:7});
 assert.equal(normal.scale,480/432);
 assert.deepEqual(normal.destination,{x:0,y:0,width:PANE_W,height:PANE_H});
 const point={x:.42,y:.5};
 const a=mapSourcePoint(normal,point),b=mapSourcePoint(mirrored,point);
 assert.equal(Number((a.x+b.x).toFixed(6)),PANE_W);
 assert.equal(a.y,b.y);
 assert.equal(mapSourcePoint(normal,{x:.5,y:.5}).x,PANE_W/2);
 const hands=handPositionsForTransform(pose(),normal);
 assert.ok(hands.left&&hands.right);
 assert.ok(hands.left.x<hands.right.x);
 const mirroredHands=handPositionsForTransform(pose(),mirrored);
 assert.ok(mirroredHands.left.x>mirroredHands.right.x,'anatomical labels swap screen sides only');
});

test('instructor placement follows the same transform for contained and cropped views',()=>{
 const contained=containedTransform(SOURCE_W,SOURCE_H,PANE_W,PANE_H,false,0,0);
 const cropped=buildTransform({sourceWidth:SOURCE_W,sourceHeight:SOURCE_H,paneWidth:PANE_W,paneHeight:PANE_H,crop:{x:424,y:0,width:432,height:720},mirrored:false,version:1,epoch:1});
 const calibration={height:.8,floor:.9};
 const a=placementForTransform(calibration,contained,PANE_H,3,1.8);
 const b=placementForTransform(calibration,cropped,PANE_H,3,1.8);
 assert.ok(b.scale>a.scale,'a display crop enlarges the instructor to keep apparent scale');
 assert.ok(Math.abs(b.screenHeight/PANE_H-calibration.height)<1e-9,'body height is preserved in screen space');
 assert.ok(b.floorY<a.floorY,'the instructor floor follows the displayed floor');
});

test('contained transform reproduces existing videoFit geometry',()=>{
 const transform=containedTransform(SOURCE_W,SOURCE_H,PANE_W,PANE_H,false,0,0);
 const fit=heightPlacement({height:.8,floor:.93},SOURCE_W,SOURCE_H,PANE_W,PANE_H,3,1.8);
 const placement=placementForTransform({height:.8,floor:.93},transform,PANE_H,3,1.8);
 assert.equal(Number(placement.scale.toFixed(9)),Number(fit.scale.toFixed(9)));
 assert.equal(Number(placement.floorY.toFixed(9)),Number(fit.floorY.toFixed(9)));
 assert.equal(transform.fullFrame,true);
 assert.ok(transform.destination.height<=PANE_H+1e-9);
});

test('controller waits for stable evidence, then eases into the fill crop',()=>{
 const value=controller();
 const initial=advance(value,0,0);assert.equal(initial.fullFrame,true);
 feed(value,0,450);
 const early=advance(value,16,450);
 assert.equal(early.fullFrame,true,'no crop before the acquisition gate');
 feed(value,500,700);
 const acquired=advance(value,466,700);
 assert.equal(acquired.fullFrame,true,'500 ms acquisition enters framing without tightening');
 feed(value,750,2200);
 const settled=advance(value,716,2200);
 assert.ok(settled.crop.width<SOURCE_W,'crop begins after one second of stable evidence');
 assert.ok(Math.abs(settled.crop.width/settled.crop.height-PANE_W/PANE_H)<.01,'settles on the pane aspect');
 const observation=observeBody(pose());
 assert.ok(settled.crop.x<=observation.padded.left*SOURCE_W+1e-6);
 assert.ok(settled.crop.x+settled.crop.width>=observation.padded.right*SOURCE_W-1e-6);
});

test('small movement stays inside the dead zone; larger movement recentres',()=>{
 const value=controller();
 feed(value,0,1500);advance(value,0,1500);
 const before=advance(value,1516,1516).crop.x;
 feed(value,1550,2200,at=>pose({wristLeft:.435,wristRight:.575,left:.425,right:.585,top:.15,bottom:.90}));
 advance(value,1532,2200);
 const afterSmall=advance(value,2216,2216).crop.x;
 assert.ok(Math.abs(afterSmall-before)<1,'movement within 5% of the pane is ignored');
 feed(value,2250,3200,at=>pose({wristLeft:.48,wristRight:.62,left:.47,right:.63,top:.15,bottom:.90}));
 advance(value,2232,3200);
 const afterLarge=advance(value,3216,3216).crop.x;
 assert.ok(afterLarge>before+1,'a clear recentre request moves the crop');
});

test('wide movement expands immediately and re-tightens only after stable evidence',()=>{
 const value=controller();
 feed(value,0,1500);const filled=advance(value,0,1500).crop;
 assert.ok(filled.width<SOURCE_W);
 feed(value,1550,1600,at=>pose({left:.1,right:.9,wristLeft:.04,wristRight:.96}));
 const wide=advance(value,1532,1600);
 assert.equal(wide.fullFrame,true,'expansion is immediate rather than smoothed through clipping');
 feed(value,1650,2100,at=>pose({left:.1,right:.9,wristLeft:.04,wristRight:.96}));
 advance(value,1616,2100);
 assert.equal(advance(value,2116,2116).fullFrame,true);
 feed(value,2150,3300);
 advance(value,2132,3300);
 const tighter=advance(value,3316,3316);
 assert.ok(tighter.crop.width<SOURCE_W,'crop returns after one second of stable full-body evidence');
});

test('a brief bad pose holds the last view; sustained loss falls back by 900 ms',()=>{
 const value=controller();
 feed(value,0,1500);advance(value,0,1500);
 const held=advance(value,1516,1516).crop;
 value.observe(null,1600,1);
 const holding=advance(value,1532,1800);
 assert.ok(Math.abs(holding.crop.width-held.width)<1e-6,'brief loss does not change the view');
 value.observe(null,2400,1);
 const lost=advance(value,1816,2500);
 assert.equal(lost.fullFrame,true,'sustained loss returns to the complete image');
});

test('unreliable tracking freezes the current zoom before widening',()=>{
 const value=controller();
 feed(value,0,1100);
 advance(value,0,1120);
 const frozen=advance(value,1120,1120).crop;
 assert.ok(frozen.width<SOURCE_W&&frozen.width>432,'a tightening tween is in progress');
 value.observe(null,1130,1);
 const held=advance(value,1130,1400);
 assert.ok(Math.abs(held.crop.width-frozen.width)<1e-6,'the in-flight zoom does not continue while tracking is missing');
 assert.ok(Math.abs(held.crop.x-frozen.x)<1e-6);
 feed(value,1150,1500,()=>null);
 advance(value,1410,1700);
 assert.ok(advance(value,1700,1700).crop.width>frozen.width+1,'the view widens after the hold');
 feed(value,1550,2100,()=>null);
 assert.equal(advance(value,2100,2100).fullFrame,true,'the 900 ms fallback still completes');
});

test('an unreliable pose does not cancel a needed body-clearance expansion',()=>{
 const value=controller();
 feed(value,0,1500);advance(value,0,1500);
 assert.ok(advance(value,1516,1516).crop.width<SOURCE_W);
 value.observe(pose({left:.1,right:.9,wristLeft:.04,wristRight:.96}),1550,1);
 value.observe(null,1560,1);
 const transform=advance(value,1560,1580);
 assert.equal(transform.fullFrame,true,'the pending safe expansion survives a bad pose');
});

test('padded-body clearance overrides the movement dead zone',()=>{
 const value=controller({sourceWidth:640,sourceHeight:480});
 const stance=()=>pose({left:.33,right:.67,wristLeft:.35,wristRight:.65});
 feed(value,0,2200,stance);
 const before=advance(value,0,2200).crop;
 assert.ok(cropContains(before,observeBody(stance()).padded,640,480));
 const moved=()=>pose({left:.348,right:.688,wristLeft:.368,wristRight:.668});
 feed(value,2250,3000,moved);
 const after=advance(value,2230,3000).crop;
 assert.ok(after.x>before.x+1,'body clearance wins over the 5% dead zone');
 assert.ok(cropContains(after,observeBody(moved()).padded,640,480),'the new crop contains the padded body');
});

test('an implausible one-frame jump is rejected as framing evidence',()=>{
 const value=controller();
 feed(value,0,1500);advance(value,0,1500);
 const shifted=pose().map(point=>({...point,x:point.x+.4}));
 const update=value.observe(shifted,1550,1);
 assert.equal(update.discontinuity,true);
 const transform=advance(value,1532,1600);
 assert.equal(transform.fullFrame,true);
});

test('a stalled pose stream also falls back to the complete image',()=>{
 const value=controller();
 feed(value,0,1500);advance(value,0,1500);
 assert.ok(advance(value,1516,1516).crop.width<SOURCE_W);
 value.markStale();
 const transform=advance(value,1532,1532);
 assert.equal(transform.fullFrame,true);
});

test('stale and out-of-order pose results are ignored',()=>{
 const value=controller();
 const accepted=value.observe(pose(),1000,1);
 assert.equal(accepted.ignored,false);
 const stale=value.observe(pose(),900,1);
 assert.equal(stale.ignored,true);
 const oldEpoch=value.observe(pose(),1100,2);
 assert.equal(oldEpoch.ignored,true);
});

test('reset, calibration pause and auto-frame off start from the complete image',()=>{
 const value=controller();
 feed(value,0,1500);advance(value,0,1500);
 assert.ok(advance(value,1516,1516).crop.width<SOURCE_W);
 value.setPaused(true);
 assert.equal(advance(value,1532,1532).fullFrame,true);
 value.setPaused(false);
 feed(value,1600,3200);advance(value,1532,3200);
 assert.ok(advance(value,3216,3216).crop.width<SOURCE_W);
 value.setEnabled(false);
 assert.equal(advance(value,3232,3232).fullFrame,true);
 feed(value,3300,3800);
 advance(value,3248,3800);
 assert.equal(advance(value,3816,3816).fullFrame,true,'auto-frame off keeps the full source contained');
 assert.ok(advance(value,3816,3816).destination.height<PANE_H);
 value.reset();
 assert.equal(value.currentState,'disabled');
 value.setEnabled(true);
 value.configure({sourceWidth:SOURCE_W,sourceHeight:SOURCE_H,paneWidth:PANE_W,paneHeight:PANE_H,mirrored:true,epoch:1});
 assert.equal(value.currentState,'idle');
});

