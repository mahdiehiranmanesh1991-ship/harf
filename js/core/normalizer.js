// Port of HarfCore/PersianNormalizer.swift
export const ZWNJ = '\u200C';
const letterMap = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'هٔ' };
const arabicDigits = { '٠': '۰', '١': '۱', '٢': '۲', '٣': '۳', '٤': '۴', '٥': '۵', '٦': '۶', '٧': '۷', '٨': '۸', '٩': '۹' };
const FA = '۰۱۲۳۴۵۶۷۸۹';
export function normalizeLetters(s) {
  let out = '';
  for (const ch of s) { if (ch === 'ـ') continue; out += letterMap[ch] ?? arabicDigits[ch] ?? ch; }
  return out;
}
export const toPersianDigits = (s) => s.replace(/[0-9]/g, (d) => FA[+d]);
export const toLatinDigits = (s) => s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
export function fixZWNJ(s) {
  let t = s;
  t = t.replace(/(^|[\s«(])(ن?می)\s+(?=\p{Script=Arabic})/gu, `$1$2${ZWNJ}`);
  t = t.replace(/(\p{Script=Arabic})\s+(ها|های|هایی|هایم|هایش|ترین|تر)(?=$|[\s.,،؛!?؟»)])/gu, `$1${ZWNJ}$2`);
  t = t.replace(/\u200C{2,}/g, ZWNJ);
  t = t.replace(/\s\u200C|\u200C\s/g, ' ');
  return t;
}
export const normalize = (s) => fixZWNJ(normalizeLetters(s));
export const isPersian = (s) => /[\u0600-\u06FF\uFB50-\uFEFF]/.test(s);
