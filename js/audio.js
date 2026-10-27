// Microphone capture with live waveform + 16 kHz mono resampling + WAV encoding.
export class Recorder {
  constructor() { this.chunks = []; this.level = 0; }
  async start(onFrame) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.src.connect(this.analyser);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1); this.chunks = [];
    this.proc.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.src.connect(this.proc); this.proc.connect(this.ctx.destination);
    const buf = new Uint8Array(this.analyser.fftSize);
    const tick = () => { if (!this.ctx) return; this.analyser.getByteTimeDomainData(buf); onFrame?.(buf); this.raf = requestAnimationFrame(tick); };
    tick(); this.t0 = performance.now();
  }
  get seconds() { return this.t0 ? (performance.now() - this.t0) / 1000 : 0; }
  async stop() {
    cancelAnimationFrame(this.raf); const rate = this.ctx?.sampleRate || 48000;
    try { this.proc?.disconnect(); this.src?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop()); await this.ctx?.close().catch(() => {}); this.ctx = null;
    const n = this.chunks.reduce((a, c) => a + c.length, 0); const pcm = new Float32Array(n); let o = 0;
    for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
    return resample(pcm, rate, 16000);
  }
  cancel() { this.stop(); }
}
export function resample(pcm, from, to) {
  if (from === to) return pcm; const ratio = from / to; const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) { // simple box-filter + linear interpolation
    const s = i * ratio, i0 = Math.floor(s), f = s - i0; const a = pcm[i0] || 0, b = pcm[i0 + 1] || a; out[i] = a + (b - a) * f;
  }
  return out;
}
export function encodeWav(pcm, rate = 16000) {
  const buf = new ArrayBuffer(44 + pcm.length * 2); const v = new DataView(buf); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
export const rms = (pcm) => { let s = 0; for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i]; return Math.sqrt(s / Math.max(1, pcm.length)); };
