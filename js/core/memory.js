// Port of HarfCore/MemoryEngine.swift — personal on-device memory: unigram + bigram + recency.
import { normalizeLetters } from './normalizer.js';
import { SEED } from './seed.js';
const isWordCh = (ch) => /[\p{L}\p{M}\p{N}]/u.test(ch) || ch === '\u200C' || ch === "'" || ch === '-';
export const emptyModel = () => ({ unigrams: {}, bigrams: {}, lastUsed: {}, blocked: [], version: 1 });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export class MemoryEngine {
  constructor(model = emptyModel(), seed = SEED) {
    this.model = { ...emptyModel(), ...model }; this.seed = seed;
    this.learningEnabled = true; this.maxUnigrams = 20000; this.maxBigramsPerWord = 30;
  }
  static tokenize(text) {
    const norm = normalizeLetters(text); const toks = []; let cur = '';
    for (const ch of norm) { if (isWordCh(ch)) cur += ch; else if (cur) { toks.push(cur); cur = ''; } }
    if (cur) toks.push(cur);
    return toks.map((t) => t.replace(/^[\u200C\-']+|[\u200C\-']+$/g, '')).filter(Boolean);
  }
  static key(w) { return w.toLowerCase(); }
  isBlocked(k) { return this.model.blocked.includes(k); }
  learn(text, { secure = false, now = Date.now() } = {}) {
    if (!this.learningEnabled || secure) return;
    const toks = MemoryEngine.tokenize(text); if (!toks.length) return;
    const m = this.model; let prev = null;
    for (const t of toks) {
      if ([...t].length > 32 || /^\p{N}+$/u.test(t)) { prev = null; continue; }
      const k = MemoryEngine.key(t);
      if (this.isBlocked(k)) { prev = null; continue; }
      m.unigrams[k] = (own(m.unigrams, k) ? m.unigrams[k] : 0) + 1;
      m.lastUsed[k] = now / 1000;
      if (prev) {
        const b = own(m.bigrams, prev) ? m.bigrams[prev] : (m.bigrams[prev] = {});
        b[k] = (own(b, k) ? b[k] : 0) + 1;
        if (Object.keys(b).length > this.maxBigramsPerWord) this.pruneBigrams(prev);
      }
      prev = k;
    }
    if (Object.keys(m.unigrams).length > this.maxUnigrams) this.pruneUnigrams();
  }
  pruneBigrams(p) {
    const kept = Object.entries(this.model.bigrams[p]).sort((a, b) => b[1] - a[1]).slice(0, this.maxBigramsPerWord);
    this.model.bigrams[p] = Object.fromEntries(kept);
  }
  pruneUnigrams() {
    const m = this.model;
    const keys = new Set(Object.entries(m.unigrams).sort((a, b) => b[1] - a[1]).slice(0, Math.floor(this.maxUnigrams * 9 / 10)).map((e) => e[0]));
    const f = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.has(k)));
    m.unigrams = f(m.unigrams); m.lastUsed = f(m.lastUsed); m.bigrams = f(m.bigrams);
  }
  forget(word) {
    const k = MemoryEngine.key(normalizeLetters(word)); const m = this.model;
    delete m.unigrams[k]; delete m.lastUsed[k]; delete m.bigrams[k];
    for (const p in m.bigrams) delete m.bigrams[p][k];
  }
  block(word) { this.forget(word); const k = MemoryEngine.key(normalizeLetters(word)); if (!this.isBlocked(k)) this.model.blocked.push(k); }
  unblock(word) { const k = MemoryEngine.key(word); this.model.blocked = this.model.blocked.filter((w) => w !== k); }
  setCount(word, c) { this.model.unigrams[MemoryEngine.key(word)] = Math.max(0, c | 0); }
  reset() { this.model = emptyModel(); }
  topWords(n = 100) {
    return Object.entries(this.model.unigrams).sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1])).slice(0, n);
  }
  suggest(context, { limit = 3, now = Date.now() } = {}) {
    const last = [...context].at(-1);
    const endsWithBoundary = last === undefined ? true : !(/[\p{L}\p{M}\p{N}]/u.test(last) || last === '\u200C');
    const toks = MemoryEngine.tokenize(context);
    if (endsWithBoundary) return this.nextWords(toks.at(-1), limit);
    return this.completions(toks.at(-1) || '', { previous: toks.length >= 2 ? toks.at(-2) : null, limit, now });
  }
  nextWords(word, limit = 3) {
    if (!word) return [];
    const m = this.model.bigrams[MemoryEngine.key(normalizeLetters(word))] || {};
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    return Object.entries(m).filter(([w]) => !this.isBlocked(w))
      .sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1])).slice(0, limit)
      .map(([text, c]) => ({ text, kind: 'nextWord', score: c / Math.max(total, 1) }));
  }
  completions(prefix, { previous = null, limit = 3, now = Date.now() } = {}) {
    const p = MemoryEngine.key(normalizeLetters(prefix)); if (!p) return [];
    const scores = new Map(); const nowT = now / 1000; const m = this.model;
    for (const [w, c] of Object.entries(m.unigrams)) {
      if (!w.startsWith(p) || w === p) continue;
      let s = 10 * Math.log(1 + c); const t = m.lastUsed[w];
      if (t !== undefined) { const days = Math.max(0, (nowT - t) / 86400); s *= 1 + Math.pow(0.5, days / 7); }
      scores.set(w, s);
    }
    for (const [w, c] of Object.entries(this.seed)) {
      const k = MemoryEngine.key(w);
      if (k.startsWith(p) && k !== p && !this.isBlocked(k)) scores.set(k, (scores.get(k) || 0) + Math.log(1 + c));
    }
    if (previous) {
      const b = m.bigrams[MemoryEngine.key(normalizeLetters(previous))];
      if (b) for (const [w, c] of Object.entries(b)) if (w.startsWith(p)) scores.set(w, (scores.get(w) || 0) + 15 * c);
    }
    return [...scores].sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1])).slice(0, limit)
      .map(([text, score]) => ({ text, kind: 'completion', score }));
  }
  exportJSON() {
    const m = this.model; const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    return JSON.stringify({ bigrams: sortObj(Object.fromEntries(Object.entries(m.bigrams).map(([k, v]) => [k, sortObj(v)]))), blocked: [...m.blocked].sort(), lastUsed: sortObj(m.lastUsed), unigrams: sortObj(m.unigrams), version: m.version });
  }
  importJSON(json, merge = true) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || typeof d.unigrams !== 'object') throw new Error('invalid memory file');
    const m = { ...emptyModel(), ...d, blocked: [...(d.blocked || [])] };
    if (!merge) { this.model = m; return; }
    const t = this.model;
    for (const [k, v] of Object.entries(m.unigrams)) t.unigrams[k] = (t.unigrams[k] || 0) + v;
    for (const [p, inner] of Object.entries(m.bigrams)) { t.bigrams[p] ||= {}; for (const [k, v] of Object.entries(inner)) t.bigrams[p][k] = (t.bigrams[p][k] || 0) + v; }
    for (const [k, v] of Object.entries(m.lastUsed)) t.lastUsed[k] = Math.max(t.lastUsed[k] || 0, v);
    for (const b of m.blocked) if (!t.blocked.includes(b)) t.blocked.push(b);
  }
}
