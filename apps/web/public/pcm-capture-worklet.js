// Captures the mono microphone channel into transferable Float32 frames. The main
// thread owns limits, permissions, resampling and teardown.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel && channel.length) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
