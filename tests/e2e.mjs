// Headless-Chrome E2E for «حرف» at iPhone size (390×844).
// Usage: python3 -m http.server 8812 -d /workspace/harf-web &  PW_DIR=/tmp/pw node tests/e2e.mjs http://127.0.0.1:8812/
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
const require = createRequire((process.env.PW_DIR || '/tmp/pw') + '/');
const { chromium } = require('playwright-core');
const URL_ = process.argv[2] || 'http://127.0.0.1:8812/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = new URL('../screenshots/', import.meta.url).pathname; rmSync(SHOTS, { recursive: true, force: true }); mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('•', ...a); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran', colorScheme: 'dark',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write', 'microphone'], { origin: ORIGIN });
const page = await ctx.newPage(); const external = [], errors = [];
page.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !/^(data|blob):/.test(u)) external.push(u); });
page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const tid = (t) => `[data-testid="${t}"]`; let n = 0;
const shot = async (name, settle = 500) => { await sleep(settle); const f = `${SHOTS}${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: f }); log('screenshot', f); };
const click = async (sel) => { await page.locator(sel).first().waitFor({ state: 'visible', timeout: 10000 }); await page.locator(sel).first().click(); };
const val = () => page.inputValue(tid('editor'));
const sugg = () => page.$$eval(tid('sugg-item'), (b) => b.map((x) => x.textContent));

// 1. onboarding
await page.goto(URL_); await page.evaluate(() => document.fonts.ready);
await page.locator(tid('onboarding')).waitFor(); await shot('onboarding-1', 700);
for (let i = 0; i < 5; i++) { if (i === 2) await shot('onboarding-backtap', 300); await click(tid('onb-next')); await sleep(150); }
assert.ok(await page.locator('#sheet').isHidden()); await shot('write-empty');

// 2. typing + kbar
await click(tid('editor')); await page.keyboard.type('سلام وقت بخیر');
assert.equal(await val(), 'سلام وقت بخیر'); assert.ok(await page.locator(tid('kbar')).isVisible(), 'accessory bar visible');
await click(tid('zwnj')); assert.ok((await val()).endsWith('\u200C'), 'ZWNJ inserted'); await page.keyboard.press('Backspace');
await shot('typing-kbar');

// 3. learn from copy → completions + next-word suggestions
await page.fill(tid('editor'), 'پرونده‌ی موکل در دادگاه مطرح است'); await page.evaluate(() => window.__harf.copyText());
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'پرونده‌ی موکل در دادگاه مطرح است', 'clipboard');
await page.fill(tid('editor'), ''); await click(tid('editor')); await page.keyboard.type('پرو'); await sleep(100);
let s = await sugg(); log('suggest پرو →', s); assert.ok(s.includes('پرونده‌ی'), 'completion from memory');
await page.locator(tid('sugg-item'), { hasText: 'پرونده‌ی' }).first().click();
assert.equal(await val(), 'پرونده‌ی '); s = await sugg(); log('next →', s); assert.equal(s[0], 'موکل', 'next-word suggestion');
await shot('suggestions-next');
await page.locator(tid('sugg-item')).first().click(); assert.equal(await val(), 'پرونده‌ی موکل ');
// seed lexicon completion
await page.keyboard.type('داد'); s = await sugg(); log('suggest داد →', s); assert.ok(s.length >= 2);

// 4. snippet expansion (Persian semicolon) + candidates bar
await page.fill(tid('editor'), ''); await click(tid('editor')); await page.keyboard.type('؛ام'); s = await sugg(); assert.ok(s.some((x) => x.includes('با احترام')), 'snippet candidate'); await shot('snippet-candidate');
await page.keyboard.type('ضا ');
assert.match(await val(), /^با احترام\nمهدیه ایرانمنش\nوکیل پایه‌یک دادگستری $/); log('snippet expanded'); await shot('snippet-expanded');

// 5. copy button
await page.locator(tid('editor')).blur(); await sleep(250); await click(tid('copy'));
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await val()); await shot('copied', 250);

// 6. templates sheet
await click(tid('open-templates')); await shot('templates'); await page.locator(tid('tpl')).first().click(); assert.match(await val(), /ریاست محترم شعبه/);

// 7. voice (mocked engine; fake mic → real waveform pipeline + real cleanup)
await page.fill(tid('editor'), 'متن قبلی'); await page.locator(tid('editor')).blur(); await sleep(250);
await page.evaluate(() => { window.__harfMockVoice = async (pcm) => { window.__pcmLen = pcm.length; await new Promise((r) => setTimeout(r, 300)); return 'اِم سلام وقت بخیر نقطه جلسه ساعت 10 برگزار می شه علامت سوال'; }; });
await click(tid('mic')); await page.locator(tid('voice')).waitFor(); await sleep(1600); await shot('voice-recording', 0);
await click(tid('voice-stop')); await page.locator(tid('voice')).waitFor({ state: 'hidden' });
const v = await val(); log('voice →', JSON.stringify(v)); assert.equal(v, 'متن قبلی سلام وقت بخیر. جلسه ساعت 10 برگزار می‌شه؟');
assert.ok(await page.evaluate(() => window.__pcmLen) > 16000, 'recorded ≥1s of 16 kHz audio'); await shot('voice-inserted');

// 8. memory editor: present, edit, block, delete
await click(tid('tab-memory')); await shot('memory');
await page.fill(tid('mem-search'), 'موکل'); await page.locator('.word[data-w="موکل"]').waitFor();
await page.locator('.word[data-w="موکل"] [data-a=edit]').click(); await page.fill(tid('mem-edit-word'), 'موکلین'); await click(tid('mem-edit-save'));
await page.fill(tid('mem-search'), 'موکلین'); await page.locator('.word[data-w="موکلین"]').waitFor();
await page.locator('.word[data-w="موکلین"] [data-a=block]').click();
assert.ok(await page.evaluate(() => window.__harf.mem.model.blocked.includes('موکلین')));
await page.fill(tid('mem-search'), 'دادگاه'); await page.locator('.word[data-w="دادگاه"] [data-a=del]').click();
assert.equal(await page.evaluate(() => window.__harf.mem.model.unigrams['دادگاه']), undefined);
await page.fill(tid('mem-add'), 'ماده‌ی ۱۰۸'); await click(tid('mem-add-btn')); await page.fill(tid('mem-search'), ''); await page.locator('#blocked-list').evaluate((e) => e.closest('details').open = true);
await shot('memory-edited');
await page.reload(); await page.evaluate(() => document.fonts.ready);
assert.ok(await page.evaluate(() => JSON.parse(localStorage['harf.memory']).blocked.includes('موکلین')), 'memory persisted');

// 9. history, snippets, settings
await click(tid('tab-history')); await page.fill(tid('hist-search'), 'پرونده'); await shot('history');
await click(tid('tab-snippets')); await shot('snippets');
await click(tid('snip-new')); await page.fill(tid('snip-short'), 'آدرس'); await page.fill(tid('snip-exp'), 'کرمان، بلوار جمهوری'); await click(tid('snip-save'));
await click(tid('tab-write')); await page.fill(tid('editor'), ''); await click(tid('editor')); await page.keyboard.type(';آدرس '); assert.equal(await val(), 'کرمان، بلوار جمهوری '); await page.locator(tid('editor')).blur();
await click(tid('tab-settings')); await sleep(300); await shot('settings');
await page.evaluate(() => scrollTo(0, 99999)); await shot('settings-bottom');
await page.locator('#theme-seg [data-theme=light]').click(); await click(tid('tab-write')); await shot('write-light');
await click(tid('tab-settings')); await page.locator('#theme-seg [data-theme=auto]').click(); await click(tid('tab-write'));

// 10. offline reload
await page.evaluate(() => navigator.serviceWorker.ready); await sleep(500);
await ctx.setOffline(true); await page.reload(); await page.evaluate(() => document.fonts.ready);
assert.ok(await page.locator(tid('editor')).isVisible(), 'app loads offline');
assert.equal(await val(), 'کرمان، بلوار جمهوری ', 'draft restored offline');
await click(tid('editor')); await page.keyboard.type(' پرو'); s = await sugg(); assert.ok(s.length > 0, 'suggestions offline'); await shot('offline');
await ctx.setOffline(false);

assert.deepEqual(external, [], 'no external requests'); assert.deepEqual(errors, [], 'no console errors');
log('ALL E2E PASSED'); await browser.close();
