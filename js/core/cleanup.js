// Port of HarfCore/TextCleanup.swift — rule-based cleanup for dictated text (local, no network).
import { normalizeLetters, fixZWNJ, toPersianDigits, isPersian } from './normalizer.js';
export const persianFillers = ['اِم', 'اوم', 'اومم', 'اممم', 'امم', 'ام ام', 'اِ', 'ااا', 'آآ', 'آآآ', 'یعنی چیزه', 'چیزه'];
export const englishFillers = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'you know', 'like,'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const L = '[\\p{L}\\p{M}\\p{N}_]';
export function stripFillers(s) {
  let t = s;
  const all = [...persianFillers, ...englishFillers].sort((a, b) => [...b].length - [...a].length);
  for (const f of all) t = t.replace(new RegExp(`(^|[\\s،,])${esc(f)}(?=$|[\\s،,.!?؟])[،,]?`, 'giu'), '$1');
  return t;
}
export function collapseRepeats(s) {
  return s.replace(new RegExp(`(?<!${L})(${L}+)(?:\\s+\\1(?!${L}))+`, 'giu'), '$1');
}
function capitalizeSentences(s) {
  let out = '', cap = true;
  for (const ch of s) {
    if (cap && /\p{L}/u.test(ch)) { out += ch.toUpperCase(); cap = false; continue; }
    out += ch; if ('.!?\n'.includes(ch)) cap = true;
  }
  return out;
}
export function fixPunct(s) {
  let t = s; const fa = isPersian(t);
  if (fa) t = t.replace(/,/g, '،').replace(/;/g, '؛').replace(/\?/g, '؟');
  const spoken = fa ? [['نقطه سر خط', '.\n'], ['سر خط', '\n'], ['علامت سوال', '؟'], ['علامت سؤال', '؟'], ['ویرگول', '،'], ['نقطه', '.']]
    : [['new line', '\n'], ['question mark', '?'], ['comma', ','], ['period', '.']];
  for (const [w, p] of spoken) t = t.replace(new RegExp(`\\s*(?<!\\p{L})${w}(?!\\p{L})`, 'giu'), p);
  t = t.replace(/\s+([.,،؛:!?؟])/g, '$1');
  t = t.replace(/([،؛!?؟])(?=[^\s\n])/g, '$1 ');
  t = t.replace(/([.,:])(?=[\p{Script=Arabic}A-Za-z])/gu, '$1 ');
  t = t.replace(/[ ]*\n[ ]*/g, '\n');
  t = t.replace(/^[ \t]+|[ \t]+$/g, '');
  if (t.length && !'.!?؟…\n'.includes(t.at(-1))) t += '.';
  if (!fa) t = capitalizeSentences(t);
  return t;
}
export const DEFAULT_CLEANUP = { removeFillers: true, fixPunctuation: true, normalizePersian: true, persianDigits: false };
export function clean(input, opts = {}) {
  const o = { ...DEFAULT_CLEANUP, ...opts };
  let t = input;
  if (o.normalizePersian) t = normalizeLetters(t);
  if (o.removeFillers) t = stripFillers(t);
  t = collapseRepeats(t);
  if (o.fixPunctuation) t = fixPunct(t);
  if (o.normalizePersian) t = fixZWNJ(t);
  if (o.persianDigits) t = toPersianDigits(t);
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}
