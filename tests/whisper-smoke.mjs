// Real on-device Whisper in headless Chrome: download (split parts) → cache → worker → transcript.
// Usage: PW_DIR=/tmp/pw node tests/whisper-smoke.mjs http://127.0.0.1:8812/ /workspace/harf-asr/s1_gyro.wav [model]
import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs';
const require = createRequire((process.env.PW_DIR || '/tmp/pw') + '/'); const { chromium } = require('playwright-core');
const [URL_ = 'http://127.0.0.1:8812/', WAV, MODEL = 'whisper-tiny-fa'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); p.on('console', (m) => console.log('[page]', m.text())); p.on('pageerror', (e) => console.log('[err]', e));
await p.goto(URL_); await p.evaluate(() => localStorage.setItem('harf.settings', JSON.stringify({ onboarded: true })));
const wav = readFileSync(WAV).toString('base64');
const r = await p.evaluate(async ({ wav, MODEL }) => {
  const { downloadModel } = await import('./js/model-cache.js'); const { whisper } = await import('./js/voice.js'); const { resample } = await import('./js/audio.js');
  let t = performance.now(); let last = 0;
  await downloadModel(new URL('./', location.href).href, MODEL, (x) => { if (x - last > 0.25) { last = x; console.log('download', Math.round(x * 100) + '%'); } });
  const dl = performance.now() - t;
  const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0)).buffer; const ac = new OfflineAudioContext(1, 1, 16000);
  const buf = await ac.decodeAudioData(bytes); const pcm = resample(buf.getChannelData(0).slice(), buf.sampleRate, 16000);
  t = performance.now(); let load = 0; const out = await whisper.transcribe(MODEL, pcm, 'fa', (ms) => { load = ms; }); const total = performance.now() - t;
  const t2 = performance.now(); const out2 = await whisper.transcribe(MODEL, resample(buf.getChannelData(0).slice(), buf.sampleRate, 16000), 'fa'); 
  return { text: out.text, dl: Math.round(dl), load: Math.round(load), first: Math.round(total), second: Math.round(performance.now() - t2), audioSec: +(pcm.length / 16000).toFixed(1) };
}, { wav, MODEL });
console.log(JSON.stringify(r, null, 1)); await b.close();
