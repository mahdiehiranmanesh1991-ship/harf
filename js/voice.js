// Voice engines: on-device Whisper (worker), Web Speech API, optional cloud (OpenAI/Groq compatible).
import { encodeWav } from './audio.js';
let worker = null, seq = 0; const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; if (data.type === 'loaded') return p.onLoaded?.(data.ms); pending.delete(data.id); data.type === 'error' ? p.reject(new Error(data.error)) : p.resolve(data); };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker crashed (حافظه‌ی گوشی کافی نبود؟)')); pending.clear(); worker = null; };
  return worker;
}
const call = (msg, transfer = [], onLoaded) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, onLoaded }); getWorker().postMessage({ ...msg, id }, transfer); });
export const whisper = {
  load: (model, onLoaded) => call({ type: 'load', model }, [], onLoaded),
  transcribe: (model, audio, language, onLoaded) => call({ type: 'transcribe', model, audio, language }, [audio.buffer], onLoaded),
  unload() { worker?.terminate(); worker = null; },
};
export const webSpeechAvailable = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
/** Live Web Speech session. Resolves with final transcript on stop(). */
export function webSpeechSession(lang, onPartial) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition; const r = new R();
  r.lang = lang === 'en' ? 'en-US' : 'fa-IR'; r.continuous = true; r.interimResults = true;
  let finalText = '', err = null, ended;
  const done = new Promise((res) => { ended = res; });
  r.onresult = (e) => { let interim = ''; finalText = ''; for (const res of e.results) (res.isFinal ? (finalText += res[0].transcript + ' ') : (interim += res[0].transcript)); onPartial?.(finalText + interim); };
  r.onerror = (e) => { err = e.error; }; r.onend = () => ended();
  r.start();
  return { async stop() { try { r.stop(); } catch {} await Promise.race([done, new Promise((s) => setTimeout(s, 2500))]); if (err && !finalText) throw new Error(err === 'language-not-supported' ? 'زبان فارسی در موتور گفتار این مرورگر پشتیبانی نمی‌شود' : err); return finalText.trim(); }, abort() { try { r.abort(); } catch {} } };
}
export async function cloudTranscribe({ base, key, model, language }, pcm) {
  if (!key) throw new Error('کلید API وارد نشده است');
  const fd = new FormData(); fd.append('file', encodeWav(pcm), 'audio.wav'); fd.append('model', model || 'whisper-1');
  if (language && language !== 'auto') fd.append('language', language); fd.append('response_format', 'json');
  const res = await fetch(base.replace(/\/+$/, '') + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  if (!res.ok) throw new Error(`سرویس ابری خطا داد (${res.status})`);
  return ((await res.json()).text || '').trim();
}
