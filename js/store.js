// Local-only persistence (localStorage). Nothing leaves the phone.
import { DEFAULT_SNIPPETS } from './core/snippets.js';
const P = 'harf.';
const get = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { console.warn('storage', e); } };
export const DEFAULT_SETTINGS = {
  theme: 'auto', persianDigits: false, removeFillers: true, fixPunctuation: true, normalizePersian: true,
  autoExpand: true, learning: true, engine: 'whisper-tiny-fa', voiceLang: 'fa', cloudBase: 'https://api.groq.com/openai/v1',
  cloudModel: 'whisper-large-v3', fontSize: 21, onboarded: false, autoCopyVoice: false,
};
export const store = {
  settings: () => ({ ...DEFAULT_SETTINGS, ...get('settings', {}) }),
  saveSettings: (s) => set('settings', s),
  memory: () => get('memory', null), saveMemory: (m) => set('memory', m),
  snippets: () => get('snippets', DEFAULT_SNIPPETS), saveSnippets: (s) => set('snippets', s),
  history: () => get('history', []), saveHistory: (h) => set('history', h.slice(0, 300)),
  draft: () => get('draft', ''), saveDraft: (t) => set('draft', t),
  cloudKey: () => get('cloudKey', ''), saveCloudKey: (k) => set('cloudKey', k),
  stats: () => get('stats', { copies: 0, voiceSec: 0, expansions: 0, accepted: 0 }), saveStats: (s) => set('stats', s),
  exportAll() { return { app: 'harf', version: 1, exported: new Date().toISOString(), settings: this.settings(), memory: this.memory(), snippets: this.snippets(), history: this.history(), stats: this.stats() }; },
  importAll(d, merge = true) {
    if (!d || d.app !== 'harf') throw new Error('not a harf backup');
    if (d.settings) set('settings', { ...this.settings(), ...d.settings });
    if (d.snippets) { const cur = merge ? this.snippets() : []; const seen = new Set(cur.map((s) => s.shortcut)); set('snippets', [...cur, ...d.snippets.filter((s) => !seen.has(s.shortcut))]); }
    if (d.history) { const cur = merge ? this.history() : []; const seen = new Set(cur.map((h) => h.id)); this.saveHistory([...cur, ...d.history.filter((h) => !seen.has(h.id))].sort((a, b) => b.t - a.t)); }
    return d.memory;
  },
  wipe() { Object.keys(localStorage).filter((k) => k.startsWith(P)).forEach((k) => localStorage.removeItem(k)); },
};
