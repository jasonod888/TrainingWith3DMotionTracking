const modulePromise=import('./vendor/vision_bundle.mjs');
let tracker;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   const {FilesetResolver,PoseLandmarker}=await modulePromise;
   const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location.href).href);
   const options={baseOptions:{modelAssetPath:new URL('./assets/pose_landmarker_heavy.task',self.location.href).href,delegate:'GPU'},runningMode:'VIDEO',numPoses:1};
   let delegate='GPU';try{tracker=await PoseLandmarker.createFromOptions(files,options);}catch{delegate='CPU';options.baseOptions.delegate=delegate;tracker=await PoseLandmarker.createFromOptions(files,options);}
   self.postMessage({type:'ready',delegate});
  }else{
   try{const r=tracker.detectForVideo(data.bitmap,data.timestamp);self.postMessage({type:'pose',world:r.worldLandmarks[0]??null,image:r.landmarks[0]??null});}finally{data.bitmap.close();}
  }
 }catch(e){self.postMessage({type:'error',message:e.message});}
};
