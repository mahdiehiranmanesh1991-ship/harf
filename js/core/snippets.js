// Port of HarfCore/Snippets.swift
import { normalizeLetters } from './normalizer.js';
export const DEFAULT_SNIPPETS = [
  { id: 's1', shortcut: ';امضا', expansion: 'با احترام\nمهدیه ایرانمنش\nوکیل پایه‌یک دادگستری' },
  { id: 's2', shortcut: ';ریاست', expansion: 'ریاست محترم شعبه ... دادگاه عمومی حقوقی کرمان\nبا سلام و احترام،' },
  { id: 's3', shortcut: ';sig', expansion: 'Best regards,\nMahdieh Iranmanesh\nAttorney at Law' },
];
const n = (s) => normalizeLetters(s).replace(/^؛/, ';').toLowerCase();
/** If text before cursor ends with a shortcut → { snippet, deleteCount } (deleteCount in UTF-16 units). */
export function matchSnippet(beforeCursor, snippets = DEFAULT_SNIPPETS) {
  const parts = beforeCursor.split(/[ \n]/); const last = parts.at(-1) || '';
  if (!last) return null;
  const k = n(last);
  for (const s of snippets) if (s.shortcut && n(s.shortcut) === k) return { snippet: s, deleteCount: last.length, chars: [...last].length };
  return null;
}
/** Snippets whose shortcut starts with the current token (for the suggestion bar). */
export function snippetCandidates(beforeCursor, snippets = DEFAULT_SNIPPETS) {
  const last = beforeCursor.split(/[ \n]/).at(-1) || '';
  if (!last.startsWith(';') && !last.startsWith('؛')) return [];
  const k = n(last.replace(/^؛/, ';'));
  return snippets.filter((s) => n(s.shortcut).startsWith(k));
}
