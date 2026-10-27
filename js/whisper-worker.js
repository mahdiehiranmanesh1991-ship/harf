// Web Worker: on-device Whisper (transformers.js + onnxruntime-web WASM, all self-hosted).
import { pipeline, env } from '../vendor/transformers.min.js';
import { customCache } from './model-cache.js';
const BASE = new URL('../', import.meta.url).href;
env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = BASE + 'models/';
env.useBrowserCache = false; env.useCustomCache = true; env.customCache = customCache(BASE);
env.backends.onnx.wasm.wasmPaths = BASE + 'vendor/'; env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false;
let asr = null, loadedId = null, loading = null;
async function ensure(model) {
  if (loadedId === model && asr) return null;
  if (loading?.model === model) { await loading.p; return null; }
  if (asr) { try { await asr.dispose(); } catch {} asr = null; loadedId = null; }
  const t0 = performance.now();
  const p = pipeline('automatic-speech-recognition', model, { dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, device: 'wasm' });
  loading = { model, p };
  try { asr = await p; loadedId = model; } finally { loading = null; }
  return performance.now() - t0;
}
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load' || type === 'transcribe') {
      const ms = await ensure(data.model); if (ms != null) self.postMessage({ id, type: 'loaded', ms });
      if (type === 'load') return self.postMessage({ id, type: 'done' });
      const t1 = performance.now();
      const lang = data.language === 'en' ? 'english' : data.language === 'auto' ? null : 'persian';
      let text = '';
      try {
        const out = await asr(data.audio, { language: lang, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, no_repeat_ngram_size: 3, max_new_tokens: 220 });
        text = (out?.text || '').trim();
      } catch (e) { if (!/token_ids must be a non-empty/.test(String(e))) throw e; }
      self.postMessage({ id, type: 'done', text, ms: performance.now() - t1 });
    }
  } catch (e) { self.postMessage({ id, type: 'error', error: String(e?.message || e) }); }
};
