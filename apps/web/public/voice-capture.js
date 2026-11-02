class VoiceCapture extends AudioWorkletProcessor{
 constructor(){super();this.buffer=new Float32Array(1024);this.used=0;}
 process(inputs){const channel=inputs[0]?.[0];if(channel)for(const sample of channel){this.buffer[this.used++]=sample;if(this.used===1024){this.port.postMessage(this.buffer);this.buffer=new Float32Array(1024);this.used=0;}}return true;}
}
registerProcessor('voice-capture',VoiceCapture);
