import {BASIC_PITCH_PROFILE, resampleLinear, validatePcmDuration} from '../../../../packages/music-engine/basic-pitch';

export type CapturedPcm = {
  pcm:Float32Array;
  sampleRate:number;
  duration:number;
  settings:MediaTrackSettings;
  channels:number;
};
export type AudioCaptureOptions = {
  duration:number;
  signal?:AbortSignal;
  deviceId?:string;
  onProgress?:(progress:number)=>void;
  /** Monotonic time at which the first PCM sample can arrive. */
  onStarted?:(timestampMs:number)=>void;
};

/**
 * Microphone capture at the actual AudioContext rate. Processing is deliberately
 * explicit (no echo cancellation, noise suppression or AGC) and recorded in the
 * returned settings so transcription can report what the browser actually did.
 */
export async function captureMicrophonePcm(options:AudioCaptureOptions):Promise<CapturedPcm> {
  if (!Number.isFinite(options.duration)||options.duration<=0||options.duration>600) throw new Error('Choose a capture length within ten minutes.');
  if (typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser.');
  if (typeof AudioContext==='undefined') throw new Error('Web Audio is unavailable in this browser.');
  options.signal?.throwIfAborted();
  const stream=await navigator.mediaDevices.getUserMedia({audio:{
    channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false,
    ...(options.deviceId?{deviceId:{exact:options.deviceId}}:{}),
  },video:false});
  const context=new AudioContext();
  const frames:Float32Array[]=[];
  let stopped=false;
  try {
    await context.audioWorklet.addModule('/pcm-capture-worklet.js');
    const source=context.createMediaStreamSource(stream);
    const worklet=new AudioWorkletNode(context,'pcm-capture');
    const sink=context.createGain();
    sink.gain.value=0;
    worklet.port.onmessage=(event:MessageEvent<Float32Array>)=>{
      if(stopped)return;
      if(event.data instanceof Float32Array)frames.push(event.data);
    };
    source.connect(worklet);
    worklet.connect(sink);
    sink.connect(context.destination);
    await context.resume();
    const started=performance.now();
    options.onStarted?.(started);
    await new Promise<void>((resolve,reject)=>{
      let settled=false;
      const progress=window.setInterval(()=>options.onProgress?.(Math.min(1,(performance.now()-started)/1000/options.duration)),100);
      const finish=()=>{
        if(settled)return;
        settled=true;
        window.clearTimeout(timer);
        window.clearInterval(progress);
        options.signal?.removeEventListener('abort',cancel);
        resolve();
      };
      const cancel=()=>{
        if(settled)return;
        settled=true;
        window.clearTimeout(timer);
        window.clearInterval(progress);
        options.signal?.removeEventListener('abort',cancel);
        reject(new DOMException('Capture cancelled.','AbortError'));
      };
      const timer=window.setTimeout(finish,options.duration*1000);
      options.signal?.addEventListener('abort',cancel,{once:true});
    });
    stopped=true;
    const total=frames.reduce((sum,frame)=>sum+frame.length,0);
    const pcm=new Float32Array(total);
    let offset=0;
    for(const frame of frames){pcm.set(frame,offset);offset+=frame.length;}
    validatePcmDuration(pcm.length,context.sampleRate);
    const track=stream.getAudioTracks()[0];
    return {pcm,sampleRate:context.sampleRate,duration:total/context.sampleRate,
      settings:track?.getSettings?.()??{},channels:1};
  } finally {
    stopped=true;
    for(const track of stream.getTracks())track.stop();
    await context.close().catch(()=>{});
  }
}

/** Browser resampling to the model rate; OfflineAudioContext is the anti-aliasing path. */
export async function resampleToProfile(pcm:Float32Array,sampleRate:number,target=BASIC_PITCH_PROFILE.sampleRate):Promise<Float32Array> {
  if (!(pcm instanceof Float32Array)||!pcm.length)throw new Error('Audio has no samples.');
  if (!Number.isFinite(sampleRate)||sampleRate<=0||!Number.isFinite(target)||target<=0)throw new Error('Invalid audio sample rate.');
  if (sampleRate===target)return new Float32Array(pcm);
  if (typeof OfflineAudioContext==='undefined')return resampleLinear(pcm,sampleRate,target);
  const length=Math.max(1,Math.ceil(pcm.length*target/sampleRate));
  const context=new OfflineAudioContext(1,length,target);
  const buffer=context.createBuffer(1,pcm.length,sampleRate);
  const channel=new Float32Array(pcm.length);
  channel.set(pcm);
  buffer.copyToChannel(channel,0);
  const source=context.createBufferSource();
  source.buffer=buffer;
  source.connect(context.destination);
  source.start();
  const rendered=await context.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}
