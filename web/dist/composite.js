import {clamp,videoFit} from './pose.js';

export function suggestedAvatarPosition(calibration,side,videoWidth,videoHeight,mirrored=false){
  const center=calibration?.center??.5;
  const screenCenter=mirrored?1-center:center;
  const separation=.55*(calibration?.height??.7)*videoHeight/videoWidth;
  return clamp(screenCenter+(side==='left'?-separation:separation),.12,.88);
}

// Position within the visible camera image, not within its letterbox margins.
export function compositeOffset(fraction,videoWidth,videoHeight,width,height,frustumHeight){
  const fit=videoFit(videoWidth,videoHeight,width,height);
  const pixelX=fit.x+clamp(fraction,.05,.95)*fit.width;
  return {pixelX,worldX:(pixelX-width/2)*frustumHeight/height};
}
