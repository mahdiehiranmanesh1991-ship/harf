// Port of HarfCore/Tests/HarfCoreTests.swift (same cases) + web-specific extras.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/core/normalizer.js';
import { clean } from '../js/core/cleanup.js';
import { MemoryEngine } from '../js/core/memory.js';
import { SEED } from '../js/core/seed.js';
import { matchSnippet, snippetCandidates, DEFAULT_SNIPPETS } from '../js/core/snippets.js';
const Z = '\u200C';

test('Normalizer: Arabic ye/kaf', () => assert.equal(N.normalizeLetters('كتاب علي'), 'کتاب علی'));
test('Normalizer: digits', () => {
  assert.equal(N.toPersianDigits('ماده 13'), 'ماده ۱۳');
  assert.equal(N.toLatinDigits('۱۴۰۵/۰۸/۰۶'), '1405/08/06');
  assert.equal(N.normalizeLetters('١٢٣'), '۱۲۳');
});
test('Normalizer: tatweel', () => assert.equal(N.normalizeLetters('سـلام'), 'سلام'));
test('Normalizer: ZWNJ می/نمی', () => { assert.equal(N.fixZWNJ('من می روم'), `من می${Z}روم`); assert.equal(N.fixZWNJ('نمی دانم'), `نمی${Z}دانم`); });
test('Normalizer: ZWNJ suffix', () => { assert.equal(N.fixZWNJ('پرونده ها را'), `پرونده${Z}ها را`); assert.equal(N.fixZWNJ('بزرگ ترین'), `بزرگ${Z}ترین`); });
test('Normalizer: does not touch میز', () => assert.equal(N.fixZWNJ('میز بزرگ'), 'میز بزرگ'));
test('Normalizer: isPersian', () => { assert.ok(N.isPersian('سلام')); assert.ok(!N.isPersian('hello')); });

test('Cleanup: Persian fillers', () => assert.equal(clean('اومم من فردا اِم دادخواست رو می فرستم'), `من فردا دادخواست رو می${Z}فرستم.`));
test('Cleanup: English fillers', () => assert.equal(clean('um I will uh send the file'), 'I will send the file.'));
test('Cleanup: Persian punctuation', () => assert.equal(clean('سلام, خوبی?'), 'سلام، خوبی؟'));
test('Cleanup: spoken punctuation', () => { assert.equal(clean('جلسه فردا است نقطه'), 'جلسه فردا است.'); assert.equal(clean('وقت داری علامت سوال'), 'وقت داری؟'); });
test('Cleanup: repeats', () => assert.equal(clean('من من میرم'), 'من میرم.'));
test('Cleanup: space before punct', () => assert.equal(clean('hello , world'), 'Hello, world.'));
test('Cleanup: Arabic letters', () => assert.equal(clean('كي مي آيي'), `کی می${Z}آیی.`));
test('Cleanup: persianDigits option', () => assert.equal(clean('ماده 158', { persianDigits: true }), 'ماده ۱۵۸.'));
test('Cleanup: empty', () => assert.equal(clean('  '), ''));
test('Cleanup: سر خط → newline', () => assert.equal(clean('سلام سر خط جلسه فردا است'), 'سلام\nجلسه فردا است.'));
test('Cleanup: toggles off keep text', () => assert.equal(clean('اِم سلام', { removeFillers: false, fixPunctuation: false }), 'اِم سلام'));

test('Memory: tokenize', () => assert.deepEqual(MemoryEngine.tokenize(`سلام، می${Z}روم! hello`), ['سلام', `می${Z}روم`, 'hello']));
test('Memory: learn and complete', () => {
  const m = new MemoryEngine(undefined, {}); m.learn('دادخواست دادخواست دادنامه');
  const s = m.completions('داد'); assert.equal(s[0].text, 'دادخواست'); assert.equal(s.length, 2);
});
test('Memory: seed legal vocabulary', () => {
  const m = new MemoryEngine(); assert.ok(m.completions('لای', { limit: 5 }).map((x) => x.text).includes('لایحه'));
  assert.ok(SEED['ابلاغیه'] !== undefined); assert.ok(SEED['خوانده'] !== undefined); assert.ok(Object.keys(SEED).length > 200);
});
test('Memory: personal beats seed', () => {
  const m = new MemoryEngine(undefined, { 'دادگاه': 100, 'دادخواست': 1 }); for (let i = 0; i < 5; i++) m.learn('دادخواست');
  assert.equal(m.completions('داد')[0].text, 'دادخواست');
});
test('Memory: next word', () => {
  const m = new MemoryEngine(undefined, {}); m.learn('ریاست محترم دادگاه. ریاست محترم شعبه. ریاست محترم دادگاه');
  const s = m.suggest('ریاست '); assert.equal(s[0].text, 'محترم'); assert.equal(s[0].kind, 'nextWord');
  assert.equal(m.suggest('محترم ')[0].text, 'دادگاه');
});
test('Memory: bigram boosts completion', () => {
  const m = new MemoryEngine(undefined, {}); m.learn('دادگاه دادگاه دادگاه'); m.learn('هزینه دادرسی');
  assert.equal(m.suggest('هزینه داد')[0].text, 'دادرسی');
});
test('Memory: secure not learned', () => { const m = new MemoryEngine(undefined, {}); m.learn('secretpass', { secure: true }); assert.equal(Object.keys(m.model.unigrams).length, 0); });
test('Memory: paused learning', () => { const m = new MemoryEngine(undefined, {}); m.learningEnabled = false; m.learn('سلام'); assert.equal(Object.keys(m.model.unigrams).length, 0); });
test('Memory: numbers & long tokens skipped', () => { const m = new MemoryEngine(undefined, {}); m.learn('09123456789 ' + 'x'.repeat(40)); assert.equal(Object.keys(m.model.unigrams).length, 0); });
test('Memory: forget and block', () => {
  const m = new MemoryEngine(undefined, { 'دادگاه': 5 }); m.learn('دادگاه عالی'); m.block('دادگاه');
  assert.equal(m.model.unigrams['دادگاه'], undefined); assert.equal(m.completions('داد').length, 0);
  m.learn('دادگاه'); assert.equal(m.model.unigrams['دادگاه'], undefined);
  m.unblock('دادگاه'); m.learn('دادگاه'); assert.equal(m.model.unigrams['دادگاه'], 1);
});
test('Memory: Arabic kaf normalized on learn', () => {
  const m = new MemoryEngine(undefined, {}); m.learn('كرمان'); assert.equal(m.model.unigrams['کرمان'], 1); assert.equal(m.completions('كر')[0].text, 'کرمان');
});
test('Memory: export/import round trip', () => {
  const a = new MemoryEngine(undefined, {}); a.learn('hello world hello'); const data = a.exportJSON();
  const b = new MemoryEngine(undefined, {}); b.importJSON(data, false); assert.deepEqual(b.model, JSON.parse(data));
  b.importJSON(data, true); assert.equal(b.model.unigrams.hello, 4);
  assert.throws(() => b.importJSON('{"x":1}'));
});
test('Memory: pruning', () => {
  const m = new MemoryEngine(undefined, {}); m.maxUnigrams = 10;
  m.learn(Array.from({ length: 30 }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}${i}x`).join(' '));
  assert.ok(Object.keys(m.model.unigrams).length <= 10);
});
test('Memory: English case-insensitive', () => { const m = new MemoryEngine(undefined, {}); m.learn('Court court'); assert.equal(m.model.unigrams.court, 2); });
test('Memory: recency boosts recent word', () => {
  const m = new MemoryEngine(undefined, {}); const day = 86400000, now = Date.now();
  m.learn('کرمانشاه', { now: now - 60 * day }); m.learn('کرمان‌زمین', { now });
  assert.equal(m.completions('کرم', { now })[0].text, 'کرمان‌زمین');
});
test('Memory: proto-safe keys', () => { const m = new MemoryEngine(undefined, {}); m.learn('constructor toString constructor'); assert.equal(m.model.unigrams.constructor, 2); });

test('Snippets: match', () => {
  const r = matchSnippet('متن نامه ;امضا'); assert.ok(r); assert.equal(r.chars, 5); assert.ok(r.snippet.expansion.includes('مهدیه ایرانمنش'));
});
test('Snippets: no match', () => assert.equal(matchSnippet('سلام '), null));
test('Snippets: candidates by prefix (also Persian ؛)', () => {
  assert.equal(snippetCandidates('سلام ;ام')[0].shortcut, ';امضا');
  assert.equal(snippetCandidates('؛ری')[0].shortcut, ';ریاست');
  assert.equal(snippetCandidates('سلام').length, 0);
  assert.equal(DEFAULT_SNIPPETS.length, 3);
});
