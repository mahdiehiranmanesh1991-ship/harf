// «حرف» — PWA app shell. Everything local; no network except self-hosted model files and (opt-in) cloud ASR.
import { MemoryEngine } from './core/memory.js';
import { clean } from './core/cleanup.js';
import { toPersianDigits, normalize, ZWNJ } from './core/normalizer.js';
import { matchSnippet, snippetCandidates } from './core/snippets.js';
import { TEMPLATES } from './templates.js';
import { store } from './store.js';
import { Recorder } from './audio.js';
import { whisper, webSpeechAvailable, webSpeechSession, cloudTranscribe } from './voice.js';
import { MODELS, isModelCached, downloadModel, deleteModel } from './model-cache.js';

export const APP_VERSION = '1.0.1';
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const BASE = new URL('./', location.href).href;
const fa = (n) => toPersianDigits(String(n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let S = store.settings();
const mem = new MemoryEngine(store.memory() || undefined); mem.learningEnabled = S.learning;
let snippets = store.snippets();
const ed = $('#editor');
const saveSettings = () => { store.saveSettings(S); applySettings(); };
let memTimer; const saveMem = () => { clearTimeout(memTimer); memTimer = setTimeout(() => store.saveMemory(mem.model), 300); };

// ---------- toast / sheet ----------
let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1900); }
function sheet(html, onMount) { const s = $('#sheet'); $('#sheet-card').innerHTML = html; s.hidden = false; onMount?.($('#sheet-card')); }
const closeSheet = () => { $('#sheet').hidden = true; };
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });

// ---------- settings ----------
function applySettings() {
  const dark = S.theme === 'dark' || (S.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name=theme-color]').content = dark ? '#120f24' : '#f6f4ff';
  document.documentElement.style.setProperty('--fs', S.fontSize + 'px');
  mem.learningEnabled = S.learning;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);

// ---------- editor helpers ----------
let lastSel = [0, 0];
const rememberSel = () => { lastSel = [ed.selectionStart, ed.selectionEnd]; };
['keyup', 'click', 'select', 'input', 'blur'].forEach((e) => ed.addEventListener(e, rememberSel));
function insertAt(text, { del = 0, select } = {}) {
  const [a0, b] = document.activeElement === ed ? [ed.selectionStart, ed.selectionEnd] : lastSel;
  const a = Math.max(0, a0 - del);
  ed.setRangeText(text, a, b, 'end');
  if (select) ed.setSelectionRange(a + select, a + select);
  rememberSel(); onEdit();
}
const before = () => ed.value.slice(0, document.activeElement === ed ? ed.selectionStart : lastSel[0]);
function countWords() { const n = MemoryEngine.tokenize(ed.value).length; $('#count').textContent = `${fa(n)} کلمه`; }
let draftT; function onEdit() {
  countWords(); renderSugg();
  clearTimeout(draftT); draftT = setTimeout(() => { store.saveDraft(ed.value); const d = $('#saved-dot'); d.textContent = 'ذخیره شد ✓'; d.classList.add('on'); setTimeout(() => d.classList.remove('on'), 900); }, 400);
}

// snippet auto-expand on space / newline
ed.addEventListener('beforeinput', (e) => {
  if (!S.autoExpand || (e.inputType !== 'insertText' && e.inputType !== 'insertLineBreak') || (e.inputType === 'insertText' && e.data !== ' ')) return;
  const m = matchSnippet(before(), snippets); if (!m) return;
  e.preventDefault(); insertAt(m.snippet.expansion + (e.inputType === 'insertText' ? ' ' : '\n'), { del: m.deleteCount });
  bump('expansions'); toast('⚡ میانبر جایگزین شد');
});
ed.addEventListener('input', onEdit);

// ---------- suggestions ----------
function currentToken(b) { const m = b.match(/[\p{L}\p{M}\p{N}\u200C]+$/u); return m ? m[0] : ''; }
function getSuggestions() {
  const b = before(); const out = [];
  for (const s of snippetCandidates(b, snippets).slice(0, 2)) out.push({ text: s.expansion.split('\n')[0], kind: 'snippet', s });
  for (const s of mem.suggest(b, { limit: 3 })) if (!out.some((o) => o.text === s.text)) out.push(s);
  return out.slice(0, 4);
}
function renderSugg() {
  const box = $('#sugg'); if ($('#kbar').hidden) return;
  const list = getSuggestions();
  box.innerHTML = list.length ? list.map((s, i) => `<button data-i="${i}" class="${s.kind === 'snippet' ? 'snip' : i === 0 ? 'top1' : ''}" data-testid="sugg-item">${esc(s.text)}${s.kind === 'snippet' ? '<span class="k">⚡</span>' : ''}</button>`).join('')
    : `<span class="empty">${ed.value ? 'پیشنهادها اینجا ظاهر می‌شوند' : 'شروع کن؛ «حرف» کلمه‌هایت را یاد می‌گیرد'}</span>`;
  box._list = list;
}
function acceptSuggestion(s) {
  const b = before();
  if (s.kind === 'snippet') { const tok = b.split(/[ \n]/).at(-1); insertAt(s.s.expansion + ' ', { del: tok.length }); bump('expansions'); return; }
  const tok = s.kind === 'completion' ? currentToken(b) : '';
  const lead = s.kind === 'nextWord' && b && !/\s$/.test(b) ? ' ' : '';
  insertAt(lead + s.text + ' ', { del: tok.length }); bump('accepted');
}
// pointerdown + preventDefault keeps focus (and the iOS keyboard) on the editor
function keepFocus(el, handler) {
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  el.addEventListener('click', (e) => { const btn = e.target.closest('button'); if (btn) handler(btn, e); });
}
keepFocus($('#sugg'), (btn) => { const s = $('#sugg')._list?.[+btn.dataset.i]; if (s) acceptSuggestion(s); });
keepFocus($('#quick'), (btn) => {
  if (btn.id === 'digits-toggle') { const d = $('#digits'); d.hidden = !d.hidden; return pinBar(); }
  if (btn.id === 'kbar-copy') return copyText();
  if (btn.id === 'kbar-mic') { ed.blur(); return startVoice(); }
  if (btn.dataset.wrap) { const [a, b] = [ed.selectionStart, ed.selectionEnd]; const sel = ed.value.slice(a, b); insertAt('«' + sel + '»', { select: sel ? sel.length + 2 : 1 }); return; }
  insertAt(btn.dataset.ins === ZWNJ ? ZWNJ : btn.dataset.ins);
});
$('#digits').innerHTML = '۱۲۳۴۵۶۷۸۹۰'.split('').map((d) => `<button data-d="${d}">${d}</button>`).join('');
keepFocus($('#digits'), (btn) => insertAt(btn.dataset.d));

// ---------- keyboard accessory bar via visualViewport ----------
const vv = window.visualViewport;
function pinBar() {
  const bar = $('#kbar'); if (bar.hidden) return;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--kb', kb + 'px');
  document.documentElement.style.setProperty('--vvh', (vv ? vv.height : innerHeight) + 'px');
  document.documentElement.style.setProperty('--kbarh', bar.offsetHeight + 'px');
}
vv?.addEventListener('resize', pinBar); vv?.addEventListener('scroll', pinBar);
ed.addEventListener('focus', () => { $('#kbar').hidden = false; document.body.classList.add('typing'); renderSugg(); pinBar(); setTimeout(pinBar, 350); });
ed.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ed) { $('#kbar').hidden = true; document.body.classList.remove('typing'); $('#digits').hidden = true; } }, 120));

// ---------- copy / share / clear ----------
function bump(k, n = 1) { const s = store.stats(); s[k] = (s[k] || 0) + n; store.saveStats(s); }
function commit(text) {
  if (!text.trim()) return;
  mem.learn(text); saveMem();
  const h = store.history(); if (h[0]?.text === text) { h[0].t = Date.now(); } else h.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, t: Date.now() });
  store.saveHistory(h);
}
async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
}
async function copyText(text = ed.value) {
  if (!text.trim()) return toast('متنی برای کپی نیست');
  const ok = await writeClipboard(text);
  if (!ok) return toast('کپی نشد؛ متن را نگه دار و «Copy» را بزن');
  commit(text); bump('copies');
  const b = $('#btn-copy'); b.classList.add('done'); $('#copy-label').textContent = 'کپی شد ✓'; setTimeout(() => { b.classList.remove('done'); $('#copy-label').textContent = 'کپی کن'; }, 1600);
  toast('✓ کپی شد — حالا در هر برنامه‌ای Paste کن');
}
$('#btn-copy').onclick = () => copyText();
$('#btn-share').onclick = async () => {
  const text = ed.value; if (!text.trim()) return toast('متنی برای اشتراک نیست');
  commit(text);
  if (navigator.share) { try { await navigator.share({ text }); } catch {} } else copyText(text);
};
$('#btn-clear').onclick = () => {
  if (!ed.value) return;
  commit(ed.value); const old = ed.value; ed.value = ''; onEdit();
  toast('متن در تاریخچه ذخیره شد'); undoClear = old;
};
let undoClear = null;

// ---------- templates ----------
$('#btn-templates').onclick = () => sheet(`<h3>📜 عبارت‌های آماده</h3><p class="muted">بزن تا در محل مکان‌نما اضافه شود. «…» را با اطلاعات پرونده پر کن.</p>` +
  `<div class="cat">⚡ میانبرهای تو</div>` + snippets.map((s, i) => `<button class="tpl" data-snip="${i}"><b dir="auto">${esc(s.shortcut)}</b><br>${esc(s.expansion)}</button>`).join('') +
  TEMPLATES.map((g) => `<div class="cat">${esc(g.cat)}</div>` + g.items.map((t) => `<button class="tpl" data-testid="tpl" data-t="${esc(t)}">${esc(t)}</button>`).join('')).join('') +
  `<button class="btn-wide" data-close>بستن</button>`, (c) => c.addEventListener('click', (e) => {
  const b = e.target.closest('.tpl'); if (!b) return;
  const t = b.dataset.snip != null ? snippets[+b.dataset.snip].expansion : b.dataset.t;
  const pre = before(); insertAt((pre && !/\n$/.test(pre) ? '\n' : '') + t); closeSheet(); go('write'); toast('اضافه شد');
}));
function idleChips() {
  const box = $('#idle-sugg'); const items = [...snippets.slice(0, 3).map((s) => ({ l: '⚡ ' + s.shortcut.replace(/^;/, '؛'), t: s.expansion })), ...TEMPLATES.flatMap((g) => g.items).slice(0, 4).map((t) => ({ l: t.split('\n')[0].slice(0, 26) + '…', t }))];
  box.innerHTML = items.map((x, i) => `<button class="tpl-chip" data-i="${i}">${esc(x.l)}</button>`).join('');
  box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const t = items[+b.dataset.i].t; const pre = before(); insertAt((pre && !/\n$/.test(pre) ? '\n' : '') + t); };
}

// ---------- voice ----------
const ENGINES = {
  'whisper-tiny-fa': { name: 'روی گوشی · سبک', kind: 'whisper' },
  'whisper-small-fa': { name: 'روی گوشی · دقیق', kind: 'whisper' },
  webspeech: { name: 'گفتار مرورگر', kind: 'webspeech' },
  cloud: { name: 'ابری (کلید خودت)', kind: 'cloud' },
};
const cached = {};
async function refreshCached() { for (const id of Object.keys(MODELS)) cached[id] = await isModelCached(BASE, id).catch(() => false); }
let rec = null, wsSess = null, voiceTimer = null, voiceCancelled = false, waveRaf = null;
const V = { el: $('#voice'), status: (t) => { $('#voice-status').textContent = t; }, partial: (t) => { $('#voice-partial').textContent = t; } };
function drawWave(buf) {
  const c = $('#wave'); const g = c.getContext('2d'); const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
  const bars = 48, step = Math.floor(buf.length / bars), bw = W / bars;
  const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#22d3ee'); grad.addColorStop(.5, '#8b5cf6'); grad.addColorStop(1, '#f472b6'); g.fillStyle = grad;
  for (let i = 0; i < bars; i++) {
    let peak = 0; for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(buf[i * step + j] - 128) / 128);
    const h = Math.max(6, Math.min(H, peak * H * 2.4)); const x = i * bw + bw * 0.2, w = bw * 0.6;
    g.beginPath(); g.roundRect ? g.roundRect(x, (H - h) / 2, w, h, w / 2) : g.rect(x, (H - h) / 2, w, h); g.fill();
  }
}
function fakeWave() { const buf = new Uint8Array(1024); const t = performance.now() / 300; for (let i = 0; i < buf.length; i++) buf[i] = 128 + Math.sin(i / 9 + t) * 30 * (0.5 + 0.5 * Math.sin(t + i / 120)); drawWave(buf); waveRaf = requestAnimationFrame(fakeWave); }
function voiceUI(open) { V.el.hidden = !open; V.el.classList.remove('busy'); $('#voice-progress').hidden = true; V.partial(''); if (!open) { clearInterval(voiceTimer); cancelAnimationFrame(waveRaf); } }
const fmtTime = (s) => fa(Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'));

async function startVoice() {
  const id = S.engine; const eng = ENGINES[id] || ENGINES['whisper-tiny-fa'];
  if (eng.kind === 'webspeech' && !webSpeechAvailable()) return toast('موتور گفتار مرورگر در دسترس نیست؛ در تنظیمات موتور دیگری انتخاب کن');
  if (eng.kind === 'cloud' && !store.cloudKey()) { go('settings'); return toast('اول کلید API سرویس ابری را وارد کن'); }
  if (eng.kind === 'whisper' && !cached[id] && !window.__harfMockVoice) {
    return sheet(`<h3>⬇︎ دانلود مدل گفتار</h3><p class="muted">برای تایپ صوتی آفلاین، مدل «${esc(MODELS[id].label)}» یک‌بار دانلود می‌شود (${fa(MODELS[id].mb)} مگابایت) و بعد از آن بدون اینترنت کار می‌کند. بهتر است با وای‌فای باشد.</p><div class="progress" id="dlp"><i></i></div><p class="muted" id="dlt"></p><div class="btn-row"><button class="btn-sm primary" id="dl-go" data-testid="dl-go">شروع دانلود</button><button class="btn-sm" data-close>بعداً</button></div>`,
      (c) => { $('#dl-go', c).onclick = async () => { $('#dl-go', c).disabled = true; try { await downloadModel(BASE, id, (p, got) => { $('#dlp i', c).style.width = (p * 100) + '%'; $('#dlt', c).textContent = `${fa(Math.round(p * 100))}٪ — ${fa((got / 1048576).toFixed(0))} از ${fa(MODELS[id].mb)} مگابایت`; }); cached[id] = true; closeSheet(); renderEngines(); toast('✓ مدل آماده است'); startVoice(); } catch (e) { $('#dlt', c).textContent = 'دانلود ناموفق بود: ' + e.message; $('#dl-go', c).disabled = false; } }; });
  }
  voiceCancelled = false; voiceUI(true); $('#voice-engine').textContent = '🎙️ ' + eng.name; V.status('در حال گوش دادن… راحت حرف بزن');
  const t0 = performance.now(); voiceTimer = setInterval(() => { $('#voice-time').textContent = fmtTime((performance.now() - t0) / 1000); }, 250); $('#voice-time').textContent = fmtTime(0);
  try {
    if (eng.kind === 'webspeech' && !window.__harfMockVoice) { fakeWave(); wsSess = webSpeechSession(S.voiceLang, (t) => V.partial(t)); }
    else { rec = new Recorder(); await rec.start(drawWave); if (eng.kind === 'whisper' && !window.__harfMockVoice) whisper.load(id).catch(() => {}); }
  } catch (e) { voiceUI(false); rec = null; return toast(e.name === 'NotAllowedError' ? 'اجازه‌ی میکروفون داده نشد — از تنظیمات Safari اجازه بده' : 'میکروفون باز نشد: ' + e.message); }
}
async function stopVoice() {
  clearInterval(voiceTimer); cancelAnimationFrame(waveRaf); V.el.classList.add('busy');
  const id = S.engine; const eng = ENGINES[id]; let text = '';
  try {
    if (wsSess) { V.status('در حال نهایی کردن…'); text = await wsSess.stop(); wsSess = null; }
    else if (rec) {
      const secs = rec.seconds; const pcm = await rec.stop(); rec = null; bump('voiceSec', Math.round(secs));
      if (voiceCancelled) return;
      if (window.__harfMockVoice) { V.status('در حال تبدیل گفتار به متن…'); text = await window.__harfMockVoice(pcm, id); }
      else if (eng.kind === 'cloud') { V.status('در حال ارسال به سرویس ابری…'); text = await cloudTranscribe({ base: S.cloudBase, key: store.cloudKey(), model: S.cloudModel, language: S.voiceLang }, pcm); }
      else { V.status('در حال تبدیل گفتار به متن روی گوشی…'); const r = await whisper.transcribe(id, pcm, S.voiceLang); text = r.text; }
    }
    if (voiceCancelled) return;
    text = clean(text || '', S);
    if (!text) { voiceUI(false); return toast('چیزی شنیده نشد؛ دوباره امتحان کن'); }
    const pre = before(); insertAt((pre && !/\s$/.test(pre) ? ' ' : '') + text);
    voiceUI(false); toast('✓ متن اضافه شد');
    if (S.autoCopyVoice) copyText();
  } catch (e) { voiceUI(false); toast('خطا در تایپ صوتی: ' + e.message); }
}
$('#btn-mic').onclick = startVoice; $('#voice-stop').onclick = stopVoice;
$('#voice-cancel').onclick = async () => { voiceCancelled = true; wsSess?.abort(); wsSess = null; if (rec) { await rec.stop(); rec = null; } voiceUI(false); };

// ---------- engines UI ----------
function engineStatus(id) {
  const e = ENGINES[id];
  if (e.kind === 'whisper') return cached[id] ? ['دانلود شده · آفلاین', 'good'] : [`${fa(MODELS[id].mb)} مگابایت`, ''];
  if (e.kind === 'webspeech') return webSpeechAvailable() ? ['در این مرورگر هست', 'good'] : ['در دسترس نیست', 'warn'];
  return store.cloudKey() ? ['کلید ثبت شده', 'good'] : ['نیاز به کلید', 'warn'];
}
const ENGINE_DESC = {
  'whisper-tiny-fa': 'پیشنهادی. کاملاً روی گوشی و بدون اینترنت (بعد از یک‌بار دانلود). سریع، دقت متوسط.',
  'whisper-small-fa': 'آزمایشی. دقیق‌تر ولی چند برابر کندتر (برای هر جمله چند ده ثانیه) و سنگین؛ ممکن است روی آیفون‌های قدیمی‌تر به‌خاطر کمبود حافظه بسته شود.',
  webspeech: 'موتور خود مرورگر. روی آیفون احتمالاً فارسی را پشتیبانی نمی‌کند و صدا را برای اپل می‌فرستد؛ برای انگلیسی خوب است.',
  cloud: 'دقیق‌ترین گزینه با کلید API خودت (مثلاً Groq). صدا برای آن سرویس ارسال می‌شود و به اینترنت آزاد نیاز دارد.',
};
function renderEngines() {
  $('#engines').innerHTML = Object.entries(ENGINES).map(([id, e]) => { const [st, cls] = engineStatus(id);
    return `<div class="engine ${S.engine === id ? 'on' : ''}" data-eng="${id}" data-testid="engine-${id}" role="button"><div class="h"><span>${S.engine === id ? '◉' : '○'} ${esc(e.name)}</span><em class="${cls}">${st}</em></div><p>${ENGINE_DESC[id]}</p>${e.kind === 'whisper' ? `<div class="dl">${cached[id] ? `<button class="chip-btn danger" data-del="${id}">حذف مدل</button>` : `<button class="chip-btn" data-dl="${id}">دانلود حالا</button>`}</div><div class="progress" hidden data-p="${id}"><i></i></div>` : ''}</div>`; }).join('');
  $('#cloud-box').classList.toggle('on', S.engine === 'cloud');
  const e = ENGINES[S.engine]; $('#engine-hint').textContent = `موتور صوتی: ${e.name}` + (e.kind === 'whisper' && !cached[S.engine] ? ' · بار اول دانلود می‌شود' : '');
}
$('#engines').addEventListener('click', async (ev) => {
  const del = ev.target.closest('[data-del]'), dl = ev.target.closest('[data-dl]');
  if (del) { await deleteModel(BASE, del.dataset.del); whisper.unload(); cached[del.dataset.del] = false; renderEngines(); return toast('مدل حذف شد'); }
  if (dl) { const id = dl.dataset.dl; const p = $(`[data-p="${id}"]`); p.hidden = false; dl.disabled = true; dl.textContent = 'در حال دانلود…';
    try { await downloadModel(BASE, id, (x) => { p.firstElementChild.style.width = x * 100 + '%'; dl.textContent = fa(Math.round(x * 100)) + '٪'; }); cached[id] = true; toast('✓ مدل دانلود شد'); } catch (e) { toast('دانلود ناموفق: ' + e.message); } renderEngines(); return; }
  const card = ev.target.closest('[data-eng]'); if (card) { S.engine = card.dataset.eng; whisper.unload(); saveSettings(); renderEngines(); }
});
$('#cloud-base').onchange = (e) => { S.cloudBase = e.target.value.trim(); saveSettings(); };
$('#cloud-model').onchange = (e) => { S.cloudModel = e.target.value.trim(); saveSettings(); };
$('#cloud-key').onchange = (e) => { store.saveCloudKey(e.target.value.trim()); renderEngines(); };
$$('[data-preset]').forEach((b) => b.onclick = () => { const p = b.dataset.preset === 'groq' ? ['https://api.groq.com/openai/v1', 'whisper-large-v3'] : ['https://api.openai.com/v1', 'whisper-1']; [S.cloudBase, S.cloudModel] = p; saveSettings(); fillSettings(); });

// ---------- settings screen ----------
function fillSettings() {
  $$('[data-set]').forEach((i) => { i.checked = !!S[i.dataset.set]; });
  $$('#theme-seg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === S.theme));
  $('#font-size').value = S.fontSize; $('#voice-lang').value = S.voiceLang;
  $('#cloud-base').value = S.cloudBase; $('#cloud-model').value = S.cloudModel; $('#cloud-key').value = store.cloudKey();
  $('#ver').textContent = `نسخه‌ی ${fa(APP_VERSION)} · حرف — ساخته شده برای مهدیه`;
  renderEngines();
}
$$('[data-set]').forEach((i) => i.onchange = () => { S[i.dataset.set] = i.checked; saveSettings(); });
$('#theme-seg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.theme = b.dataset.theme; saveSettings(); fillSettings(); };
$('#font-size').oninput = (e) => { S.fontSize = +e.target.value; saveSettings(); };
$('#voice-lang').onchange = (e) => { S.voiceLang = e.target.value; saveSettings(); };
function download(name, obj) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const stamp = () => new Date().toISOString().slice(0, 10);
$('#all-export').onclick = () => { const d = store.exportAll(); d.memory = JSON.parse(mem.exportJSON()); download(`harf-backup-${stamp()}.json`, d); };
$('#all-import').onchange = async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); const m = store.importAll(d); if (m) mem.importJSON(m, true); saveMem(); S = store.settings(); snippets = store.snippets(); applySettings(); fillSettings(); toast('✓ پشتیبان بازگردانی شد'); } catch (err) { toast('فایل پشتیبان معتبر نیست'); } e.target.value = ''; };
$('#wipe').onclick = () => sheet(`<h3>پاک کردن همه‌چیز؟</h3><p class="muted">حافظه، تاریخچه، میانبرها و تنظیمات از این گوشی پاک می‌شوند. اول پشتیبان بگیر.</p><div class="btn-row"><button class="btn-sm danger" id="wipe-yes">بله، پاک کن</button><button class="btn-sm" data-close>انصراف</button></div>`, (c) => { $('#wipe-yes', c).onclick = async () => { store.wipe(); try { await caches.delete('harf-models-v1'); } catch {} location.reload(); }; });
$('#show-onboard').onclick = () => onboarding(0);

// ---------- history ----------
const jdate = (t) => { try { return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t); } catch { return new Date(t).toLocaleString(); } };
function renderHistory() {
  const q = normalize($('#hist-search').value.trim()); const h = store.history().filter((x) => !q || normalize(x.text).includes(q));
  $('#hist-list').innerHTML = h.length ? h.slice(0, 150).map((x) => `<div class="item" data-id="${x.id}"><div class="txt" dir="auto">${esc(x.text)}</div><div class="meta"><span>${jdate(x.t)}</span><span class="b"><button class="chip-btn" data-a="copy">کپی</button><button class="chip-btn" data-a="edit">ویرایش</button><button class="chip-btn danger" data-a="del">حذف</button></span></div></div>`).join('')
    : `<div class="empty-state"><div class="e">🕘</div>${q ? 'چیزی پیدا نشد' : 'هر متنی که کپی یا پاک کنی اینجا نگه داشته می‌شود.'}</div>`;
}
$('#hist-search').oninput = renderHistory;
$('#hist-list').onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; const id = b.closest('.item').dataset.id; const h = store.history(); const x = h.find((i) => i.id === id);
  if (b.dataset.a === 'copy') copyText(x.text);
  if (b.dataset.a === 'edit') { ed.value = x.text; onEdit(); go('write'); }
  if (b.dataset.a === 'del') { store.saveHistory(h.filter((i) => i.id !== id)); renderHistory(); } };

// ---------- memory screen ----------
function renderMemory() {
  const q = normalize($('#mem-search').value.trim()).toLowerCase(); const all = mem.topWords(100000); const max = all[0]?.[1] || 1;
  const list = all.filter(([w]) => !q || w.includes(q)).slice(0, 200);
  const st = store.stats();
  $('#mem-stats').innerHTML = `<div><b>${fa(all.length)}</b><small>کلمه</small></div><div><b>${fa(Object.values(mem.model.bigrams).reduce((a, b) => a + Object.keys(b).length, 0))}</b><small>جفت‌کلمه</small></div><div><b>${fa(st.accepted || 0)}</b><small>پیشنهاد پذیرفته</small></div>`;
  $('#mem-learning').checked = S.learning;
  $('#mem-list').innerHTML = list.length ? list.map(([w, c]) => `<div class="word" data-w="${esc(w)}"><b dir="auto">${esc(w)}</b><span class="bar"><i style="width:${Math.max(6, c / max * 100)}%"></i></span><span class="n">${fa(c)}</span><button class="chip-btn" data-a="edit" aria-label="ویرایش">✎</button><button class="chip-btn" data-a="block" title="دیگر پیشنهاد نده">⛔</button><button class="chip-btn danger" data-a="del" aria-label="حذف">🗑</button></div>`).join('')
    : `<div class="empty-state"><div class="e">🧠</div>${q ? 'این کلمه در حافظه نیست' : 'هنوز چیزی یاد نگرفته‌ام. متنی بنویس و کپی کن.'}</div>`;
  $('#blocked-n').textContent = fa(mem.model.blocked.length);
  $('#blocked-list').innerHTML = mem.model.blocked.map((w) => `<button class="chip-btn" data-unblock="${esc(w)}">${esc(w)} ✕</button>`).join('') || '<span class="muted">هیچ</span>';
}
$('#mem-search').oninput = renderMemory;
$('#mem-learning').onchange = (e) => { S.learning = e.target.checked; saveSettings(); toast(S.learning ? 'یادگیری روشن شد' : 'یادگیری متوقف شد'); };
$('#mem-add-btn').onclick = () => { const v = $('#mem-add').value.trim(); if (!v) return; const was = mem.learningEnabled; mem.learningEnabled = true; mem.learn(v); mem.learn(v); mem.learningEnabled = was; saveMem(); $('#mem-add').value = ''; renderMemory(); toast('اضافه شد'); };
$('#mem-list').onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; const w = b.closest('.word').dataset.w;
  if (b.dataset.a === 'del') { mem.forget(w); toast('حذف شد'); }
  if (b.dataset.a === 'block') { mem.block(w); toast('دیگر پیشنهاد نمی‌شود'); }
  if (b.dataset.a === 'edit') return sheet(`<h3>ویرایش «${esc(w)}»</h3><label class="muted">کلمه</label><input id="mw" value="${esc(w)}" dir="auto" data-testid="mem-edit-word"><label class="muted">تعداد استفاده (اولویت)</label><input id="mc" type="number" min="0" value="${mem.model.unigrams[w] || 0}"><div class="btn-row"><button class="btn-sm primary" id="msave" data-testid="mem-edit-save">ذخیره</button><button class="btn-sm" data-close>انصراف</button></div>`, (c) => { $('#msave', c).onclick = () => { const nw = normalize($('#mw', c).value.trim()).toLowerCase(); const n = +$('#mc', c).value; if (nw && nw !== w) { const bg = mem.model.bigrams[w]; mem.forget(w); if (bg) mem.model.bigrams[nw] = bg; } if (nw) mem.setCount(nw, n); saveMem(); closeSheet(); renderMemory(); }; });
  saveMem(); renderMemory(); };
$('#blocked-list').onclick = (e) => { const b = e.target.closest('[data-unblock]'); if (b) { mem.unblock(b.dataset.unblock); saveMem(); renderMemory(); } };
$('#mem-export').onclick = () => download(`harf-memory-${stamp()}.json`, mem.exportJSON());
$('#mem-import').onchange = async (e) => { try { mem.importJSON(await e.target.files[0].text(), true); saveMem(); renderMemory(); toast('✓ حافظه وارد شد'); } catch { toast('فایل حافظه معتبر نیست'); } e.target.value = ''; };
$('#mem-reset').onclick = () => sheet(`<h3>پاک کردن حافظه؟</h3><p class="muted">همه‌ی کلماتی که یاد گرفته‌ام پاک می‌شوند.</p><div class="btn-row"><button class="btn-sm danger" id="mr">پاک کن</button><button class="btn-sm" data-close>انصراف</button></div>`, (c) => { $('#mr', c).onclick = () => { mem.reset(); store.saveMemory(mem.model); closeSheet(); renderMemory(); }; });

// ---------- snippets screen ----------
function renderSnippets() {
  $('#snip-list').innerHTML = snippets.map((s, i) => `<div class="item"><div class="meta" style="margin:0 0 6px"><b style="color:var(--tx);font-size:15px">${esc(s.shortcut.replace(/^;/, "؛"))}</b><span class="b"><button class="chip-btn" data-e="${i}">ویرایش</button><button class="chip-btn danger" data-d="${i}">حذف</button></span></div><div class="txt" dir="auto">${esc(s.expansion)}</div></div>`).join('');
}
function editSnippet(i) {
  const s = i == null ? { id: 's' + Date.now(), shortcut: ';', expansion: '' } : snippets[i];
  sheet(`<h3>${i == null ? 'میانبر جدید' : 'ویرایش میانبر'}</h3><label class="muted">میانبر (با ; یا ؛ شروع شود)</label><input id="ss" value="${esc(s.shortcut)}" dir="auto" data-testid="snip-short"><label class="muted">متن کامل</label><textarea id="se" dir="auto" data-testid="snip-exp">${esc(s.expansion)}</textarea><div class="btn-row"><button class="btn-sm primary" id="ssave" data-testid="snip-save">ذخیره</button><button class="btn-sm" data-close>انصراف</button></div>`, (c) => {
    $('#ssave', c).onclick = () => { let sc = $('#ss', c).value.trim().replace(/^؛/, ';'); const ex = $('#se', c).value; if (!sc || sc === ';' || !ex.trim()) return toast('میانبر و متن را کامل کن'); if (!sc.startsWith(';')) sc = ';' + sc;
      const n = { ...s, shortcut: sc, expansion: ex }; if (i == null) snippets.push(n); else snippets[i] = n; store.saveSnippets(snippets); closeSheet(); renderSnippets(); idleChips(); toast('ذخیره شد'); }; });
}
$('#snip-new').onclick = () => editSnippet(null);
$('#snip-list').onclick = (e) => { const ed_ = e.target.closest('[data-e]'), d = e.target.closest('[data-d]'); if (ed_) editSnippet(+ed_.dataset.e); if (d) { snippets.splice(+d.dataset.d, 1); store.saveSnippets(snippets); renderSnippets(); idleChips(); } };

// ---------- navigation ----------
function go(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  if (name === 'history') renderHistory(); if (name === 'memory') renderMemory(); if (name === 'snippets') renderSnippets(); if (name === 'settings') { fillSettings(); refreshCached().then(renderEngines); }
  scrollTo(0, 0);
}
$('#tabs').onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); };
$('#btn-help').onclick = () => onboarding(0);

// ---------- onboarding ----------
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const ONB = [
  { e: '👋', h: 'سلام مهدیه! این «حرف» است', p: `<p>جایی برای نوشتن سریع و تایپ صوتی فارسی، با حافظه‌ای که کلمه‌های حقوقی خودت را یاد می‌گیرد.</p><p>روش کار ساده است: <b>اینجا بنویس یا حرف بزن ← «کپی کن» ← در واتس‌اپ، ثنا، ایمیل یا هر جای دیگر Paste کن.</b></p>` },
  { e: '📲', h: 'روی صفحه‌ی اصلی نصبش کن', p: `<ol><li>در Safari دکمه‌ی <b>اشتراک‌گذاری ⤴︎</b> پایین صفحه را بزن.</li><li><b>Add to Home Screen</b> (افزودن به صفحه‌ی اصلی) را انتخاب کن.</li><li>از این به بعد «حرف» را از آیکونش باز کن؛ بدون اینترنت هم کار می‌کند.</li></ol>` },
  { e: '👆', h: 'باز کردن با دو ضربه پشت گوشی', p: `<ol><li>برنامه‌ی <b>Shortcuts</b> (میان‌برها) ← ＋ ← <b>Open URLs</b> و آدرس همین صفحه را بده؛ نامش را «حرف» بگذار.</li><li><b>Settings ← Accessibility ← Touch ← Back Tap</b> (تنظیمات ← دسترسی‌پذیری ← لمس ← ضربه به پشت).</li><li><b>Double Tap</b> را بزن و میانبر «حرف» را انتخاب کن.</li></ol><p>حالا هر جا هستی، دو ضربه به پشت گوشی بزن تا «حرف» باز شود.</p>` },
  { e: '⌨️', h: 'یک نکته‌ی صادقانه', p: `<p>یک برنامه‌ی وب نمی‌تواند جای کیبورد آیفون را بگیرد؛ پس «حرف» کیبورد خود گوشی را استفاده می‌کند و بالای آن یک نوار پیشنهاد، نیم‌فاصله و علائم فارسی اضافه می‌کند.</p><p>برای تایپ صوتی، دکمه‌ی 🎙️ را بزن. بار اول مدل گفتار (حدود ۱۰۸ مگابایت) دانلود می‌شود و بعد کاملاً روی گوشی کار می‌کند.</p>` },
  { e: '🔒', h: 'همه‌چیز روی گوشی خودت', p: `<p>هیچ سرور، حساب کاربری یا ردیابی‌ای در کار نیست. متن‌ها، حافظه و میانبرها فقط در همین گوشی می‌مانند و هر وقت خواستی از «تنظیمات» پشتیبان بگیری یا پاکشان کنی.</p><p>میانبر <code>؛امضا</code> را امتحان کن 😉</p>` },
];
function onboarding(i) {
  const o = ONB[i]; const last = i === ONB.length - 1;
  sheet(`<div class="onb" data-testid="onboarding"><div class="big">${o.e}</div><h3>${o.h}</h3>${o.p}<div class="dots">${ONB.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div><div class="btn-row" style="justify-content:center"><button class="btn-sm primary" id="onb-next" data-testid="onb-next">${last ? 'شروع کنیم ✨' : 'بعدی'}</button>${last ? '' : '<button class="btn-sm" id="onb-skip">رد شدن</button>'}</div></div>`, (c) => {
    const done = () => { S.onboarded = true; saveSettings(); closeSheet(); };
    $('#onb-next', c).onclick = () => (last ? done() : onboarding(i + 1)); const sk = $('#onb-skip', c); if (sk) sk.onclick = done; });
}

// ---------- boot ----------
applySettings();
ed.value = store.draft(); countWords(); idleChips(); fillSettings();
refreshCached().then(renderEngines);
const h = new Date().getHours(); $('#greet').textContent = h < 12 ? 'صبح بخیر مهدیه ☀️' : h < 18 ? 'روزت بخیر مهدیه' : 'عصر بخیر مهدیه 🌙';
if (!S.onboarded) onboarding(isStandalone() ? 2 : 0);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__harf = { mem, store, go, copyText, insertAt, version: APP_VERSION };
