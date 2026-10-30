import {videoFit} from './pose.js';

// Labels retain anatomical identity. Mirroring changes only screen position.
export function liveHandPositions(points,videoWidth,videoHeight,width,height,mirrored=false){
  const fit=videoFit(videoWidth,videoHeight,width,height);
  return Object.fromEntries([['left',15],['right',16]].map(([side,i])=>{
    const point=points?.[i];
    if(!point || (point.visibility??0)<.6 || (point.presence??1)<.6 || point.x<0 || point.x>1 || point.y<0 || point.y>1)return [side,null];
    return [side,{x:fit.x+(mirrored?1-point.x:point.x)*fit.width,y:fit.y+point.y*fit.height}];
  }));
}

export function placeHandLabels(elements,positions,width,height){
  const both=positions.left&&positions.right;
  const crowded=both&&Math.hypot(positions.left.x-positions.right.x,positions.left.y-positions.right.y)<45;
  for(const side of ['left','right']){
    const element=elements[side],point=positions[side];
    element.hidden=!point;
    if(!point)continue;
    const offset=crowded?(side==='left'?-21:21):0;
    element.style.left=`${Math.max(16,Math.min(width-16,point.x+offset))}px`;
    element.style.top=`${Math.max(20,Math.min(height-16,point.y-22))}px`;
  }
}
