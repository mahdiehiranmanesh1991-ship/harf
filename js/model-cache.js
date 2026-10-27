// Self-hosted Whisper models (no Hugging Face → works in Iran). Files > 95 MB are stored as
// .partNN chunks + .parts.json on GitHub Pages and re-assembled here, then kept in Cache Storage.
export const MODEL_CACHE = 'harf-models-v1';
export const MODELS = {
  'whisper-tiny-fa': { label: 'سبک (Whisper Tiny فارسی)', mb: 108, files: ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx'] },
  'whisper-small-fa': { label: 'دقیق (Whisper Small فارسی)', mb: 312, files: ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx'] },
};
export const modelBase = (base, id) => new URL(`models/${id}/`, base).href;
const abs = (u, base) => new URL(u, base).href;
// files stored as .partNN chunks (each < 95 MB) + .parts.json
const isSplit = (url) => /decoder_model_merged_q4\.onnx$/.test(url);

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length); }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
/** Download one file (whole or split) into the cache. */
export async function cacheFile(url, onBytes) {
  const cache = await caches.open(MODEL_CACHE);
  if (await cache.match(url)) return;
  let body;
  const pj = isSplit(url) ? await fetch(url + '.parts.json', { cache: 'no-store' }).catch(() => null) : null;
  if (pj && pj.ok && (pj.headers.get('content-type') || '').includes('json')) {
    const { size, parts } = await pj.json(); body = new Uint8Array(size); let o = 0;
    for (const p of parts) { const b = await fetchWithProgress(abs(p, url), onBytes); body.set(b, o); o += b.length; }
    if (o !== size) throw new Error('size mismatch ' + url);
  } else body = await fetchWithProgress(url, onBytes);
  await cache.put(url, new Response(body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) } }));
}
export async function isModelCached(base, id) {
  if (!('caches' in self)) return false; const cache = await caches.open(MODEL_CACHE);
  for (const f of MODELS[id].files) if (!(await cache.match(modelBase(base, id) + f))) return false;
  return true;
}
export async function downloadModel(base, id, onProgress) {
  const m = MODELS[id]; const total = m.mb * 1048576; let got = 0;
  for (const f of m.files) await cacheFile(modelBase(base, id) + f, (n) => { got += n; onProgress?.(Math.min(0.999, got / total), got); });
  onProgress?.(1, got);
}
export async function deleteModel(base, id) {
  const cache = await caches.open(MODEL_CACHE);
  for (const f of MODELS[id].files) await cache.delete(modelBase(base, id) + f);
}
/** transformers.js custom cache: serve from our cache, assembling split files on demand. */
export const customCache = (base) => ({
  async match(req) {
    const url = abs(typeof req === 'string' ? req : req.url, base);
    const cache = await caches.open(MODEL_CACHE);
    let hit = await cache.match(url); if (hit) return hit;
    try { await cacheFile(url); hit = await cache.match(url); } catch { return undefined; }
    return hit || undefined;
  },
  async put() { /* we cache ourselves */ },
});
