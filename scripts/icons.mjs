// Renders PNG icons with headless Chrome (needs PW_DIR with playwright-core).
import { createRequire } from 'module'; import fs from 'fs'; import path from 'path';
const req = createRequire((process.env.PW_DIR || '/tmp/pw') + '/');
const { chromium } = req('playwright-core');
const font = fs.readFileSync(new URL('../fonts/Vazirmatn-Variable.woff2', import.meta.url)).toString('base64');
const html = (s, pad) => `<html><head><style>@font-face{font-family:V;src:url(data:font/woff2;base64,${font})}body{margin:0}
.i{width:${s}px;height:${s}px;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#f472b6 0%,transparent 45%),linear-gradient(135deg,#8b5cf6,#6366f1 50%,#22d3ee);position:relative;overflow:hidden}
.t{font-family:V;font-weight:900;color:#fff;font-size:${s * (pad ? .46 : .58)}px;line-height:1;margin-top:-${s * .06}px;text-shadow:0 ${s * .02}px ${s * .05}px rgba(30,10,80,.35)}
.d{position:absolute;width:${s * .1}px;height:${s * .1}px;border-radius:50%;background:#fff;bottom:${s * (pad ? .27 : .2)}px;left:${s * .47}px;opacity:.9}</style></head>
<body><div class="i"><div class="t">حرف</div></div></body></html>`;
const exe = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
for (const [name, s, pad] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180], ['maskable-512', 512, 1]]) {
  const p = await b.newPage({ viewport: { width: s, height: s } }); await p.setContent(html(s, pad)); await p.waitForTimeout(150);
  await p.screenshot({ path: path.join('icons', name + '.png') }); await p.close();
}
await b.close(); console.log('icons ok');
