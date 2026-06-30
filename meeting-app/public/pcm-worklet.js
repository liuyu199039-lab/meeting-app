// Runs on the audio thread. Converts mic Float32 samples to 16-bit PCM and
// posts them out continuously — no gaps, so no dropped words.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      const buf = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        let s = Math.max(-1, Math.min(1, ch[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(buf.buffer, [buf.buffer]);
    }
    return true; // keep processor alive
  }
}
registerProcessor("pcm-processor", PCMProcessor);
