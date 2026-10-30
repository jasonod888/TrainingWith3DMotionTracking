// Classic worker + dynamic ESM import: the pinned MediaPipe runtime loads its
// WASM glue with importScripts(), which is unavailable in a module worker.
const visionModule=import('./vendor/vision_bundle.mjs');
let tracker;
self.onmessage=async ({data})=>{
  if(data.type==='init'){
    try{
      const {FilesetResolver,PoseLandmarker}=await visionModule;
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location.href).href);
      const options={baseOptions:{modelAssetPath:new URL('./assets/pose_landmarker_lite.task',self.location.href).href,delegate:'GPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55,minTrackingConfidence:.55};
      try{tracker=await PoseLandmarker.createFromOptions(files,options);}catch{options.baseOptions.delegate='CPU';tracker=await PoseLandmarker.createFromOptions(files,options);}
      self.postMessage({type:'ready'});
    }catch(error){self.postMessage({type:'error',message:error.message});}
  }
  if(data.type==='frame'){
    try{
      if(!tracker)throw new Error('Pose tracker is not ready');
      const result=tracker.detectForVideo(data.bitmap,data.timestamp);
      self.postMessage({type:'pose',landmarks:result.landmarks[0]??null,world:result.worldLandmarks[0]??null,timestamp:data.timestamp,epoch:data.epoch});
    }catch(error){self.postMessage({type:'frame-error',message:error.message});}
    finally{data.bitmap.close();}
  }
};
