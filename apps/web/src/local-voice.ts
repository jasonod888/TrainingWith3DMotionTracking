type Transcript={text:string;confidence:number};

/** Same callbacks as browser recognition; microphone audio stays within this app's server. */
export function localRecognition(transcribe:(pcm:string)=>Promise<Transcript>){
 return class LocalRecognition{
  onstart?:()=>void;onend?:()=>void;onerror?:(error:{error:string;message?:string})=>void;onresult?:(event:unknown)=>void;
  private stopped=true;private context:AudioContext|null=null;private stream:MediaStream|null=null;
  private node:AudioWorkletNode|null=null;private busy=false;private samples:number[]=[];private silence=0;private voiced=false;
  private pending:number[][]=[];
  start(){this.stopped=false;void this.open();}
  private async open(){try{
   this.context=new AudioContext({sampleRate:16000});await this.context.resume();
   if(this.stopped)return;
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
   if(this.stopped){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
   await this.context.audioWorklet.addModule('/voice-capture.js');if(this.stopped)return;
   const node=new AudioWorkletNode(this.context,'voice-capture');this.node=node;
   node.port.onmessage=({data}:{data:Float32Array})=>this.capture(data);
   this.context.createMediaStreamSource(stream).connect(node);node.connect(this.context.destination);this.onstart?.();
  }catch(error){if(!this.stopped)this.onerror?.({error:error instanceof DOMException&&error.name==='NotAllowedError'?'not-allowed':'audio-capture',message:error instanceof Error?error.message:undefined});this.abort();}}
  private capture(data:Float32Array){if(this.stopped)return;
   const rms=Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length),speech=rms>.008;
   if(speech){this.voiced=true;this.silence=0;}else this.silence+=data.length;
   this.samples.push(...data);
   if(!this.voiced){if(this.samples.length>3200)this.samples=this.samples.slice(-3200);return;}
   if((this.silence>7200&&this.samples.length>=4000)||this.samples.length>=48000){const segment=this.samples.slice(0,48000);this.samples=[];this.voiced=false;this.silence=0;void this.send(segment);}
  }
  private async send(samples:number[]){if(this.stopped)return;if(this.busy){if(this.pending.length<3)this.pending.push(samples);return;}this.busy=true;
   const buffer=new ArrayBuffer(samples.length*2),view=new DataView(buffer);samples.forEach((x,i)=>view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,x))*32767),true));
   let bytes='';for(const byte of new Uint8Array(buffer))bytes+=String.fromCharCode(byte);
   try{const result=await transcribe(btoa(bytes));if(this.stopped||!result.text)return;const match=Object.assign([{transcript:result.text,confidence:result.confidence}],{isFinal:true});this.onresult?.({resultIndex:0,results:[match]});}
   catch(error){if(!this.stopped)this.onerror?.({error:'network',message:error instanceof Error?error.message:'Voice service unavailable.'});}
   finally{this.busy=false;const next=this.pending.shift();if(next&&!this.stopped)void this.send(next);}
  }
  abort(){if(this.stopped)return;this.stopped=true;this.node?.disconnect();this.node=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;void this.context?.close().catch(()=>{});this.context=null;this.samples=[];this.pending=[];this.onend?.();}
 };
}
