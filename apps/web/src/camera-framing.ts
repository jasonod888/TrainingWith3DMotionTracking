// Pure geometry and time-based controller for the local camera preview.
//
// The canonical coordinate space is the original, unmirrored video frame:
// normalised pose landmarks (0..1) and source pixels. Display crop, destination
// rectangle and mirroring are derived here only, then consumed by the video,
// the pose overlay and the hand labels through one read-only transform.

export type Landmark={x:number;y:number;visibility?:number;presence?:number};
export type Point2={x:number;y:number};
export type Bounds={left:number;top:number;right:number;bottom:number};
export type SourceCrop={x:number;y:number;width:number;height:number};
export type Rect={x:number;y:number;width:number;height:number};

export type DisplayTransform={
 readonly sourceWidth:number;
 readonly sourceHeight:number;
 readonly paneWidth:number;
 readonly paneHeight:number;
 readonly crop:SourceCrop;
 readonly destination:Rect;
 readonly scale:number;
 readonly mirrored:boolean;
 readonly version:number;
 readonly epoch:number;
 readonly fullFrame:boolean;
};

export type FramingParameters={
 visibilityThreshold:number;
 horizontalPadding:number;
 verticalPadding:number;
 minimumPadding:number;
 edgeMargin:number;
 acquisitionMs:number;
 tightenDelayMs:number;
 recenterMs:number;
 tightenMs:number;
 deadZoneFraction:number;
 holdMs:number;
 lossMs:number;
 envelopeMs:number;
 jumpCenterFraction:number;
 jumpScaleRatio:number;
 cropEpsilon:number;
};

/** All tunable values in one place. Times are elapsed milliseconds. */
export const FRAMING_DEFAULTS:FramingParameters={
 visibilityThreshold:.6,
 horizontalPadding:.15,
 verticalPadding:.10,
 minimumPadding:.03,
 edgeMargin:.03,
 acquisitionMs:500,
 tightenDelayMs:1000,
 recenterMs:300,
 tightenMs:600,
 deadZoneFraction:.05,
 holdMs:300,
 lossMs:900,
 envelopeMs:1000,
 jumpCenterFraction:.25,
 jumpScaleRatio:2.2,
 cropEpsilon:.0005,
};

// MediaPipe PoseLandmarker indices used for framing. Face, hands/fingers and
// feet are all included; this is deliberately not a torso-only crop.
export const HEAD_INDICES=[0,1,2,3,4,5,6,7,8,9,10];
export const HAND_INDICES=[15,16,17,18,19,20,21,22];
export const FOOT_INDICES=[27,28,29,30,31,32];
export const CORE_INDICES=[0,11,12,15,16,23,24,25,26,27,28,31,32];
const REQUIRED_INDICES=[...CORE_INDICES];
const VISIBLE_BODY_INDICES=Array.from({length:33},(_,i)=>i);

export type BodyObservation={
 finite:boolean;
 reliable:boolean;
 bounds:Bounds|null;
 padded:Bounds|null;
 center:Point2|null;
 bodyWidth:number;
 bodyHeight:number;
 feetVisible:boolean;
 handsVisible:boolean;
 headVisible:boolean;
 edgeRisk:boolean;
 outsideSource:boolean;
 reason:'ok'|'invalid'|'partial'|'edge'|'outside';
};

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const finitePoint=(point:Landmark|undefined):point is Landmark=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
const isVisible=(point:Landmark|undefined,threshold:number):point is Landmark=>finitePoint(point)&&(point.visibility??0)>=threshold&&(point.presence??1)>=threshold;

export function boundsFromPoints(points:Iterable<Point2>):Bounds|null{
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const point of points){left=Math.min(left,point.x);top=Math.min(top,point.y);right=Math.max(right,point.x);bottom=Math.max(bottom,point.y);}
 return Number.isFinite(left)?{left,top,right,bottom}:null;
}

export function mergeBounds(a:Bounds|null,b:Bounds):Bounds{
 if(!a)return{...b};
 return{left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)};
}

/** Expand the measured body box. The minimum allowance is a fraction of source. */
export function padBounds(bounds:Bounds,params:FramingParameters=FRAMING_DEFAULTS):Bounds{
 const width=Math.max(bounds.right-bounds.left,0),height=Math.max(bounds.bottom-bounds.top,0);
 const horizontal=Math.max(width*params.horizontalPadding,params.minimumPadding);
 const vertical=Math.max(height*params.verticalPadding,params.minimumPadding);
 return{left:bounds.left-horizontal,top:bounds.top-vertical,right:bounds.right+horizontal,bottom:bounds.bottom+vertical};
}

export function paddedOutsideSource(padded:Bounds,epsilon=1e-6):boolean{
 return padded.left<-epsilon||padded.top<-epsilon||padded.right>1+epsilon||padded.bottom>1+epsilon;
}

export function observeBody(landmarks:readonly Landmark[]|null|undefined,params:FramingParameters=FRAMING_DEFAULTS):BodyObservation{
 const invalid:BodyObservation={finite:false,reliable:false,bounds:null,padded:null,center:null,bodyWidth:0,bodyHeight:0,feetVisible:false,handsVisible:false,headVisible:false,edgeRisk:false,outsideSource:false,reason:'invalid'};
 if(!landmarks||landmarks.length<33||!REQUIRED_INDICES.every(index=>finitePoint(landmarks[index])))return invalid;
 const visible=VISIBLE_BODY_INDICES.filter(index=>isVisible(landmarks[index],params.visibilityThreshold)).map(index=>landmarks[index] as Point2);
 const bounds=boundsFromPoints(visible);
 if(!bounds)return{...invalid,finite:true};
 const padded=padBounds(bounds,params);
 const feetVisible=[27,28,31,32].every(index=>isVisible(landmarks[index],params.visibilityThreshold));
 const handsVisible=[15,16].every(index=>isVisible(landmarks[index],params.visibilityThreshold));
 const headVisible=HEAD_INDICES.some(index=>isVisible(landmarks[index],params.visibilityThreshold));
 const coreVisible=CORE_INDICES.every(index=>isVisible(landmarks[index],params.visibilityThreshold));
 const edgeRisk=CORE_INDICES.some(index=>{const point=landmarks[index];return point.x<params.edgeMargin||point.x>1-params.edgeMargin||point.y<params.edgeMargin||point.y>1-params.edgeMargin;});
 const outsideSource=paddedOutsideSource(padded);
 // A complete pose remains evidence even when it is too wide or too close to
 // the source edge: that must widen/fall back immediately, not look like
 // tracking loss. Only missing core landmarks are unreliable.
 const reliable=coreVisible&&headVisible;
 const reason=!reliable?'partial':outsideSource?'outside':edgeRisk?'edge':'ok';
 return{finite:true,reliable,bounds,padded,center:{x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2},bodyWidth:bounds.right-bounds.left,bodyHeight:bounds.bottom-bounds.top,feetVisible,handsVisible,headVisible,edgeRisk,outsideSource,reason};
}

/** Largest pane-aspect crop that fits inside the source: the least zoom that covers the pane. */
export function maximalCoverCrop(sourceWidth:number,sourceHeight:number,paneAspect:number):SourceCrop{
 if(!(sourceWidth>0)||!(sourceHeight>0)||!(paneAspect>0))return{x:0,y:0,width:0,height:0};
 if(paneAspect<=sourceWidth/sourceHeight)return{x:0,y:0,width:sourceHeight*paneAspect,height:sourceHeight};
 return{x:0,y:0,width:sourceWidth,height:sourceWidth/paneAspect};
}

/**
 * A source crop matching the pane aspect that contains the padded body and
 * stays inside the camera image. The crop is the largest such rectangle (the
 * least display magnification), centred on the subject where the source
 * boundaries allow. Returns null when filling would cut the body.
 */
export function fillCropFor(padded:Bounds,sourceWidth:number,sourceHeight:number,paneAspect:number,epsilon=1e-6):SourceCrop|null{
 if(!(sourceWidth>0)||!(sourceHeight>0)||!(paneAspect>0))return null;
 if(paddedOutsideSource(padded,epsilon))return null;
 const crop=maximalCoverCrop(sourceWidth,sourceHeight,paneAspect);
 if(!(crop.width>0)||!(crop.height>0))return null;
 const left=padded.left*sourceWidth,right=padded.right*sourceWidth,top=padded.top*sourceHeight,bottom=padded.bottom*sourceHeight;
 if(right-left>crop.width+epsilon||bottom-top>crop.height+epsilon)return null;
 const centerX=clamp((left+right)/2,crop.width/2,sourceWidth-crop.width/2);
 const centerY=clamp((top+bottom)/2,crop.height/2,sourceHeight-crop.height/2);
 const result={x:centerX-crop.width/2,y:centerY-crop.height/2,width:crop.width,height:crop.height};
 if(left<result.x-epsilon||right>result.x+result.width+epsilon||top<result.y-epsilon||bottom>result.y+result.height+epsilon)return null;
 return result;
}

export function fullSourceCrop(sourceWidth:number,sourceHeight:number):SourceCrop{
 return{x:0,y:0,width:sourceWidth,height:sourceHeight};
}

export function cropContains(crop:SourceCrop,padded:Bounds,sourceWidth:number,sourceHeight:number,epsilon=1e-4):boolean{
 const left=padded.left*sourceWidth,right=padded.right*sourceWidth,top=padded.top*sourceHeight,bottom=padded.bottom*sourceHeight;
 return left>=crop.x-epsilon&&right<=crop.x+crop.width+epsilon&&top>=crop.y-epsilon&&bottom<=crop.y+crop.height+epsilon;
}

export function buildTransform(options:{sourceWidth:number;sourceHeight:number;paneWidth:number;paneHeight:number;crop:SourceCrop;mirrored:boolean;version:number;epoch:number}):DisplayTransform{
 const {sourceWidth,sourceHeight,paneWidth,paneHeight,crop,mirrored,version,epoch}=options;
 const safeCrop={x:crop.x,y:crop.y,width:Math.max(crop.width,1e-6),height:Math.max(crop.height,1e-6)};
 const scale=Math.min(paneWidth/safeCrop.width,paneHeight/safeCrop.height);
 const width=safeCrop.width*scale,height=safeCrop.height*scale;
 const destination={x:(paneWidth-width)/2,y:(paneHeight-height)/2,width,height};
 const fullFrame=safeCrop.x<=1e-3&&safeCrop.y<=1e-3&&safeCrop.x+safeCrop.width>=sourceWidth-1e-3&&safeCrop.y+safeCrop.height>=sourceHeight-1e-3;
 return{sourceWidth,sourceHeight,paneWidth,paneHeight,crop:safeCrop,destination,scale,mirrored,version,epoch,fullFrame};
}

export function containedTransform(sourceWidth:number,sourceHeight:number,paneWidth:number,paneHeight:number,mirrored:boolean,version=0,epoch=0):DisplayTransform{
 return buildTransform({sourceWidth,sourceHeight,paneWidth,paneHeight,crop:fullSourceCrop(sourceWidth,sourceHeight),mirrored,version,epoch});
}

/** Convert a normalised source point into pane CSS pixels through the shared transform. */
export function mapSourcePoint(transform:DisplayTransform,normalized:Point2):Point2{
 const localX=(normalized.x*transform.sourceWidth-transform.crop.x)*transform.scale;
 const localY=(normalized.y*transform.sourceHeight-transform.crop.y)*transform.scale;
 return{
  x:transform.destination.x+(transform.mirrored?transform.destination.width-localX:localX),
  y:transform.destination.y+localY,
 };
}

export function pointInsidePane(transform:DisplayTransform,point:Point2,epsilon=0):boolean{
 const {destination}=transform;
 return point.x>=destination.x-epsilon&&point.y>=destination.y-epsilon&&point.x<=destination.x+destination.width+epsilon&&point.y<=destination.y+destination.height+epsilon;
}

/** Anatomical labels keep their identity; only screen position is mirrored. */
export function handPositionsForTransform(landmarks:readonly Landmark[]|null|undefined,transform:DisplayTransform,threshold=FRAMING_DEFAULTS.visibilityThreshold):Record<'left'|'right',Point2|null>{
 const result:{left:Point2|null;right:Point2|null}={left:null,right:null};
 for(const [side,index] of [['left',15],['right',16]] as const){
  const point=landmarks?.[index];
  if(!isVisible(point,threshold)||point.x<0||point.x>1||point.y<0||point.y>1)continue;
  const mapped=mapSourcePoint(transform,point);
  if(pointInsidePane(transform,mapped))result[side]=mapped;
 }
 return result;
}

/**
 * Instructor placement derived from the same display transform. For the
 * contained case this is numerically identical to web/dist/pose.js
 * heightPlacement, so combined-mode alignment is not changed.
 */
export function placementForTransform(calibration:{height:number;floor:number},transform:DisplayTransform,paneHeight:number,frustumHeight:number,avatarHeight:number):{scale:number;floorY:number;screenHeight:number}{
 const screenHeight=calibration.height*transform.sourceHeight*transform.scale;
 const floorPane=transform.destination.y+(calibration.floor*transform.sourceHeight-transform.crop.y)*transform.scale;
 return{scale:screenHeight/paneHeight*frustumHeight/avatarHeight,floorY:(.5-floorPane/paneHeight)*frustumHeight,screenHeight};
}

export type FramingState='disabled'|'idle'|'acquiring'|'framing'|'holding'|'lost'|'fallback';

export type FramingUpdate={
 state:FramingState;
 reliable:boolean;
 hint:string;
 ignored:boolean;
 discontinuity:boolean;
 crop:SourceCrop|null;
};

const emptyUpdate=(state:FramingState,values:Partial<FramingUpdate>={}):FramingUpdate=>({state,reliable:false,hint:'',ignored:false,discontinuity:false,crop:null,...values});

/**
 * Time-based framing controller. Pose observations are fed in source space;
 * `sample(now)` returns the interpolated display transform used by every
 * visual layer on that animation frame.
 */
export class CameraFramingController{
 readonly params:FramingParameters;
 private sourceWidth=0;
 private sourceHeight=0;
 private paneWidth=0;
 private paneHeight=0;
 private mirrored=false;
 private epoch=-1;
 private enabled=true;
 private supported=true;
 private paused=false;
 private lastTimestamp=-Infinity;
 private lastReliableAt=-Infinity;
 private goodSince=-Infinity;
 private lastWidenAt=-Infinity;
 private envelope:{at:number;bounds:Bounds}[]=[];
 private displayCrop:SourceCrop|null=null;
 private targetCrop:SourceCrop|null=null;
 private targetKind:'fill'|'full'='full';
 private state:FramingState='idle';
 private version=0;
 private lastSampleAt=0;
 private lastReliable:{at:number;center:Point2;height:number}|null=null;
 private lastPadded:Bounds|null=null;
 private snapPending=false;

 constructor(params:FramingParameters=FRAMING_DEFAULTS){this.params=params;}

 get available():boolean{return this.enabled&&this.supported&&!this.paused&&this.sourceWidth>0&&this.sourceHeight>0&&this.paneWidth>0&&this.paneHeight>0;}
 get currentState():FramingState{return this.state;}
 get display():DisplayTransform|null{return this.sourceWidth>0?this.transformFor(this.resolvedCrop()):null;}

 configure(options:{sourceWidth:number;sourceHeight:number;paneWidth:number;paneHeight:number;mirrored:boolean;epoch:number;enabled?:boolean;supported?:boolean;paused?:boolean}):void{
  const sourceChanged=options.sourceWidth!==this.sourceWidth||options.sourceHeight!==this.sourceHeight||options.epoch!==this.epoch;
  const paneChanged=options.paneWidth!==this.paneWidth||options.paneHeight!==this.paneHeight;
  const stateChanged=(options.enabled??this.enabled)!==this.enabled||(options.supported??this.supported)!==this.supported||(options.paused??this.paused)!==this.paused;
  this.sourceWidth=Math.max(0,options.sourceWidth);
  this.sourceHeight=Math.max(0,options.sourceHeight);
  this.paneWidth=Math.max(0,options.paneWidth);
  this.paneHeight=Math.max(0,options.paneHeight);
  this.mirrored=options.mirrored;
  this.epoch=options.epoch;
  if(options.enabled!==undefined)this.enabled=options.enabled;
  if(options.supported!==undefined)this.supported=options.supported;
  if(options.paused!==undefined)this.paused=options.paused;
  if(sourceChanged||stateChanged){this.resetTracking();this.displayCrop=null;this.targetCrop=null;this.targetKind='full';this.state=this.available?'idle':'disabled';this.version++;}
  else if(paneChanged&&this.displayCrop&&this.available){
   // Geometry is stored in source space. Rebuild immediately for the new
   // aspect instead of reusing pixel offsets from the old pane size.
   const desired=this.lastPadded?fillCropFor(this.lastPadded,this.sourceWidth,this.sourceHeight,this.paneAspect()):null;
   this.targetCrop=desired??fullSourceCrop(this.sourceWidth,this.sourceHeight);
   this.targetKind=desired?'fill':'full';
   this.displayCrop={...this.targetCrop};
  }
 }

 setEnabled(value:boolean):void{if(this.enabled===value)return;this.enabled=value;this.resetTracking();this.targetCrop=null;this.targetKind='full';this.state=this.available?'idle':'disabled';if(!value)this.snapToFull();}
 setSupported(value:boolean):void{if(this.supported===value)return;this.supported=value;this.resetTracking();this.targetCrop=null;this.targetKind='full';this.state=this.available?'idle':'disabled';if(!value)this.snapToFull();}
 setPaused(value:boolean):void{if(this.paused===value)return;this.paused=value;this.resetTracking();this.targetCrop=null;this.targetKind='full';this.state=this.available?'idle':'disabled';if(value)this.snapToFull();}
 setMirrored(value:boolean):void{this.mirrored=value;}

 /** Called by the render loop when pose messages themselves have gone stale. */
 markStale():void{
  if(!this.available||this.state==='lost')return;
  this.resetTracking();
  this.state='lost';
  this.targetCrop=fullSourceCrop(this.sourceWidth,this.sourceHeight);
  this.targetKind='full';
  this.snapPending=true;
 }

 /** Clear acquired evidence, recent-envelope history and any discontinuity. */
 resetTracking():void{
  this.lastTimestamp=-Infinity;
  this.lastReliableAt=-Infinity;
  this.goodSince=-Infinity;
  this.lastWidenAt=-Infinity;
  this.envelope=[];
  this.lastReliable=null;
  this.lastPadded=null;
  this.snapPending=false;
 }

 /** Full reset used on camera stop/epoch changes and unmount. */
 reset():void{
  this.resetTracking();
  this.displayCrop=null;
  this.targetCrop=null;
  this.targetKind='full';
  this.state=this.available?'idle':'disabled';
  this.version++;
  this.lastSampleAt=0;
 }

 private snapToFull():void{
  if(!(this.sourceWidth>0)||!(this.sourceHeight>0))return;
  const crop=fullSourceCrop(this.sourceWidth,this.sourceHeight);
  const alreadyFull=this.displayCrop&&Math.abs(this.displayCrop.x)<1e-6&&Math.abs(this.displayCrop.y)<1e-6&&Math.abs(this.displayCrop.width-crop.width)<1e-6&&Math.abs(this.displayCrop.height-crop.height)<1e-6;
  this.displayCrop={...crop};
  this.targetCrop={...crop};
  this.targetKind='full';
  if(!alreadyFull)this.version++;
 }

 private paneAspect():number{return this.paneHeight>0?this.paneWidth/this.paneHeight:0;}

 private isFullCrop(crop:SourceCrop):boolean{
  return crop.x<=1e-3&&crop.y<=1e-3&&crop.width>=this.sourceWidth-1e-3&&crop.height>=this.sourceHeight-1e-3;
 }

 private resolvedCrop():SourceCrop{
  if(this.sourceWidth>0&&this.sourceHeight>0)return this.displayCrop??fullSourceCrop(this.sourceWidth,this.sourceHeight);
  return{x:0,y:0,width:1,height:1};
 }

 private transformFor(crop:SourceCrop):DisplayTransform{
  return buildTransform({sourceWidth:this.sourceWidth,sourceHeight:this.sourceHeight,paneWidth:this.paneWidth,paneHeight:this.paneHeight,crop,mirrored:this.mirrored,version:this.version,epoch:this.epoch});
 }

 private envelopeBounds():Bounds|null{
  let result:Bounds|null=null;
  for(const entry of this.envelope)result=mergeBounds(result,entry.bounds);
  return result;
 }

 private setTarget(crop:SourceCrop,kind:'fill'|'full'):void{
  if(this.targetCrop&&Math.abs(crop.x-this.targetCrop.x)<this.params.cropEpsilon*this.sourceWidth&&Math.abs(crop.y-this.targetCrop.y)<this.params.cropEpsilon*this.sourceHeight&&Math.abs(crop.width-this.targetCrop.width)<this.params.cropEpsilon*this.sourceWidth&&Math.abs(crop.height-this.targetCrop.height)<this.params.cropEpsilon*this.sourceHeight&&kind===this.targetKind)return;
  // Visibility outranks smoothness: if the frame on screen no longer contains
  // the reliable padded body, jump straight to the safe target.
  if(this.lastPadded&&this.displayCrop&&!cropContains(this.displayCrop,this.lastPadded,this.sourceWidth,this.sourceHeight)&&cropContains(crop,this.lastPadded,this.sourceWidth,this.sourceHeight))this.snapPending=true;
  this.targetCrop={...crop};
  this.targetKind=kind;
 }

 /**
  * Feed one pose result. Non-finite, stale and out-of-order samples are ignored
  * for framing; they never tighten the displayed crop.
  */
 observe(landmarks:readonly Landmark[]|null|undefined,timestamp:number,epoch=this.epoch):FramingUpdate{
  if(epoch!==this.epoch)return emptyUpdate(this.state,{ignored:true});
  if(!Number.isFinite(timestamp)||timestamp<=this.lastTimestamp+1e-3)return emptyUpdate(this.state,{ignored:true});
  this.lastTimestamp=timestamp;
  if(!this.available){this.snapToFull();this.state='disabled';return emptyUpdate('disabled');}
  const observation=observeBody(landmarks,this.params);
  if(!observation.reliable){
   this.goodSince=-Infinity;
   this.lastReliable=null;
   // Freeze exactly what is on screen. A tightening tween must not continue
   // from missing or partial landmarks, and a partial body must not replace
   // the last reliable padded bounds. If the displayed frame already clips
   // the last reliable body, keep the safe widening target instead.
   if(this.displayCrop){
    const clipsBody=!!this.lastPadded&&!cropContains(this.displayCrop,this.lastPadded,this.sourceWidth,this.sourceHeight);
    if(!clipsBody){
     this.targetCrop={...this.displayCrop};
     this.targetKind=this.isFullCrop(this.displayCrop)?'full':'fill';
     this.snapPending=false;
    }
   }
   const recent=Number.isFinite(this.lastReliableAt)?timestamp-this.lastReliableAt:Infinity;
   if(recent<=this.params.holdMs){this.state='holding';return emptyUpdate('holding',{reliable:false,crop:this.targetCrop});}
   // After the short hold, start easing back out; the hard 900 ms threshold
   // completes the fallback even if smoothing is still in progress.
   this.lastWidenAt=timestamp;
   this.state='lost';
   this.targetCrop=fullSourceCrop(this.sourceWidth,this.sourceHeight);
   this.targetKind='full';
   if(recent>=this.params.lossMs)this.snapPending=true;
   return emptyUpdate('lost',{reliable:false,hint:observation.reason==='partial'?'Step back so your whole body is visible.':'',crop:this.targetCrop});
  }

  // Reject an implausible centre/scale jump as framing evidence. Identity
  // tracking is out of scope; a switch to a nearby person must not crop hard.
  if(this.lastReliable&&timestamp-this.lastReliable.at<=600){
   const jump=Math.hypot(observation.center!.x-this.lastReliable.center.x,observation.center!.y-this.lastReliable.center.y);
   const ratio=this.lastReliable.height>0?observation.bodyHeight/this.lastReliable.height:1;
   if(jump>this.params.jumpCenterFraction||ratio>this.params.jumpScaleRatio||ratio<1/this.params.jumpScaleRatio){
    this.resetTracking();
    this.lastTimestamp=timestamp;
    this.state='lost';
    this.targetCrop=fullSourceCrop(this.sourceWidth,this.sourceHeight);
    this.targetKind='full';
    this.snapPending=true;
    return emptyUpdate('lost',{reliable:false,discontinuity:true,crop:this.targetCrop});
   }
  }

  this.lastReliableAt=timestamp;
  this.lastReliable={at:timestamp,center:{...observation.center!},height:observation.bodyHeight};
  if(!Number.isFinite(this.goodSince))this.goodSince=timestamp;
  this.envelope.push({at:timestamp,bounds:{...observation.bounds!}});
  this.envelope=this.envelope.filter(entry=>timestamp-entry.at<=this.params.envelopeMs);
  const envelope=this.envelopeBounds()!;
  const padded=padBounds(envelope,this.params);
  this.lastPadded=padded;

  const fill=fillCropFor(padded,this.sourceWidth,this.sourceHeight,this.paneAspect());
  if(!fill){
   // Only a body that itself needs more room resets the re-tighten delay.
   // Recent-envelope evidence can keep us wide without postponing recovery.
   const currentFits=fillCropFor(padBounds(observation.bounds!,this.params),this.sourceWidth,this.sourceHeight,this.paneAspect())!==null;
   if(!currentFits)this.lastWidenAt=timestamp;
   this.state='fallback';
   this.targetCrop=fullSourceCrop(this.sourceWidth,this.sourceHeight);
   this.targetKind='full';
   this.snapPending=true;
   return emptyUpdate('fallback',{reliable:true,hint:'Step back so your whole body is visible.',crop:this.targetCrop});
  }

  const acquired=timestamp-this.goodSince>=this.params.acquisitionMs;
  if(!acquired){this.state='acquiring';return emptyUpdate('acquiring',{reliable:true,crop:this.targetCrop});}
  // Enter auto-framing after the acquisition gate, but only tighten after a
  // full second of stable evidence (and after any recent wider view).
  const readyAt=Math.max(this.goodSince+this.params.tightenDelayMs,this.lastWidenAt+this.params.tightenDelayMs);
  if(timestamp<readyAt){this.state='framing';return emptyUpdate('framing',{reliable:true,crop:this.targetCrop});}

  let desired={...fill};
  if(this.displayCrop&&this.targetKind==='fill'&&Math.abs(this.displayCrop.width-fill.width)<1&&Math.abs(this.displayCrop.height-fill.height)<1){
   const previous=this.targetCrop??this.displayCrop;
   const scale=Math.min(this.paneWidth/this.displayCrop.width,this.paneHeight/this.displayCrop.height);
   const currentCenter={x:previous.x+previous.width/2,y:previous.y+previous.height/2};
   const desiredCenter={x:fill.x+fill.width/2,y:fill.y+fill.height/2};
   const withinDeadZone=Math.abs(desiredCenter.x-currentCenter.x)*scale<this.paneWidth*this.params.deadZoneFraction&&Math.abs(desiredCenter.y-currentCenter.y)*scale<this.paneHeight*this.params.deadZoneFraction;
   // The dead zone only stabilises a view that still contains the padded
   // body. If clearance is lost, recentring wins.
   const keepsClearance=!!this.lastPadded&&cropContains(previous,this.lastPadded,this.sourceWidth,this.sourceHeight);
   if(withinDeadZone&&keepsClearance)desired={...previous};
  }
  this.setTarget(desired,'fill');
  this.state='framing';
  return emptyUpdate('framing',{reliable:true,crop:this.targetCrop});
 }

 /** Advance smoothing and return the single display transform for this frame. */
 sample(now:number):DisplayTransform{
  if(!(this.sourceWidth>0)||!(this.sourceHeight>0)||!(this.paneWidth>0)||!(this.paneHeight>0))return containedTransform(1,1,1,1,this.mirrored,this.version,this.epoch);
  const elapsed=this.lastSampleAt?Math.max(0,Math.min(100,now-this.lastSampleAt)):0;
  this.lastSampleAt=now;
  const before=this.displayCrop;
  const target=this.targetCrop??fullSourceCrop(this.sourceWidth,this.sourceHeight);
  if(!this.displayCrop){this.displayCrop=this.available?fullSourceCrop(this.sourceWidth,this.sourceHeight):{...target};this.snapPending=false;}
  else if(!this.available){this.displayCrop={...target};this.snapPending=false;}
  else{
   const dt=elapsed/1000;
   const currentArea=this.displayCrop.width*this.displayCrop.height;
   const targetArea=target.width*target.height;
   const tightening=targetArea<currentArea*.98;
   const widening=targetArea>currentArea*1.02;
   let snap=this.snapPending;
   if(widening&&this.lastPadded&&!cropContains(this.displayCrop,this.lastPadded,this.sourceWidth,this.sourceHeight))snap=true;
   if(snap){this.displayCrop={...target};this.snapPending=false;}
   else{
    const ms=tightening?this.params.tightenMs:this.params.recenterMs;
    const alpha=elapsed<=0?0:1-Math.exp(-(dt*1000)/(ms/3));
    this.displayCrop={x:this.displayCrop.x+(target.x-this.displayCrop.x)*alpha,y:this.displayCrop.y+(target.y-this.displayCrop.y)*alpha,width:this.displayCrop.width+(target.width-this.displayCrop.width)*alpha,height:this.displayCrop.height+(target.height-this.displayCrop.height)*alpha};
    const epsilon=this.params.cropEpsilon*Math.max(this.sourceWidth,this.sourceHeight);
    if(Math.abs(this.displayCrop.x-target.x)<epsilon&&Math.abs(this.displayCrop.y-target.y)<epsilon&&Math.abs(this.displayCrop.width-target.width)<epsilon&&Math.abs(this.displayCrop.height-target.height)<epsilon)this.displayCrop={...target};
   }
  }
  if(!before||Math.abs(before.x-this.displayCrop.x)>1e-6||Math.abs(before.y-this.displayCrop.y)>1e-6||Math.abs(before.width-this.displayCrop.width)>1e-6||Math.abs(before.height-this.displayCrop.height)>1e-6)this.version++;
  return this.transformFor(this.displayCrop);
 }
}
