// Verifies a DEPLOYED (or locally hosted-under-a-subpath) build: HTTPS/secure-context rules, manifest, icons,
// service worker, offline reload, and that the single-size + metric guide is in the build.
// Uses a made-up pattern, never a real one.  Usage: BASE=https://host/knit-guide/ node e2e/deploy-check.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:8099/knit-guide/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const out = []; const ok = (n, d = '') => { out.push([true, n, d]); console.log('PASS', n, d); };
const bad = (n, d = '') => { out.push([false, n, d]); console.log('FAIL', n, d); };
const check = (c, n, d) => (c ? ok(n, d) : bad(n, d));
const get = async (p) => { const r = await ctx.request.get(new URL(p, BASE).href); return r; };

const home = await get('');
check(home.status() === 200, 'index.html 200');
const man = await (await get('manifest.webmanifest')).json();
check(man.display === 'standalone' && man.name === 'Knit Guide' && man.start_url === './', 'manifest: standalone, name, start_url', JSON.stringify({ d: man.display, s: man.start_url, scope: man.scope }));
for (const ic of man.icons) check((await get(ic.src)).status() === 200, `manifest icon ${ic.src} (${ic.sizes}${ic.purpose ? ' ' + ic.purpose : ''})`);
check((await get('icons/apple-touch-icon.png')).status() === 200, 'apple-touch-icon 200');
const html = await home.text();
check(/apple-mobile-web-app-capable/.test(html) && /viewport-fit=cover/.test(html), 'iOS home-screen meta tags present');

await page.goto(BASE); await page.waitForSelector('.hero');
check(await page.evaluate(() => window.isSecureContext), 'secure context (service workers allowed)');
const stamp = await page.getByTestId('build-stamp').innerText();
check(/single-size, metric-only guide/.test(stamp), 'build stamp present', stamp);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller);
ok('service worker active and controlling the page');
const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat());
check(cached.some((p) => /pdf\.worker/.test(p)), 'pdf.js worker precached for offline PDF import', `${cached.length} files cached`);
check(cached.some((p) => /index\.html$|\/$/.test(p)) && cached.some((p) => /\.css$/.test(p)) && cached.some((p) => /index-.*\.js$/.test(p)), 'app shell precached');

// made-up pattern: 6 sizes, dash list, inches, a deliberately ambiguous 7-number list
const text = `Test Cardigan
Designer: Nobody
Sizes: S - M - L - XL - 2X - 3X
Finished measurements:
Chest: 36-40-44-48-52-56 inches (90-100-110-120-130-140 cm)
Needles: US 6 (4.0 mm)
Gauge: 16 sts x 21 rows = 4" x 4" (10 cm x 10 cm)
Abbreviations:
k - knit
p - purl
Cardigan
Cast on 50-50-54-54-54-58 stitches with US 6 needles.
Work until piece measures 12 inches.
Repeat 2 (2, 2, 3, 3, 3, 4) more times.
Bind off.`;
await page.getByTestId('new-project').click();
await ctx.setOffline(true);
await page.getByTestId('paste-input').fill(text);
await page.getByTestId('paste-read').click();
await page.waitForSelector('[data-testid=review]');
await page.getByTestId('tab-size').click();
await page.getByTestId('size-L').click();
const res = await page.getByTestId('size-resolution').innerText();
check(/⚠ 1 need review/.test(res) && /7 numbers but there are 6 sizes/.test(res), 'offline: ambiguous 7-number list blocked, NEEDS REVIEW shown');
await page.getByTestId('review-continue').click();
await page.getByTestId('create-project').click();
await page.waitForSelector('[data-testid=open-instructions]');
await page.getByTestId('open-instructions').click();
await page.waitForSelector('[data-testid=outline]');
const heads = page.locator('.sec-head[aria-expanded=false]');
for (let i = await heads.count(); i > 0; i--) await heads.first().click().catch(() => {});
const guided = (await page.locator('[data-testid=instruction] .body').allInnerTexts()).join('\n');
check(/Cast on 54 stitches with 4 mm needles\./.test(guided), 'guide: size L only, needles in mm', guided.split('\n').find((l) => /Cast on/.test(l)));
check(/measures 30\.5 cm/.test(guided), 'guide: 12 inches -> 30.5 cm');
check(!/\b50-50-54|\binches\b|US 6/.test(guided.replace(/Repeat 2 \(2, 2, 3, 3, 3, 4\)/g, '')), 'guide: no other sizes, no imperial');
check(/⚠ SIZE VALUE NEEDS REVIEW/.test(guided), 'guide: ambiguous value flagged, not guessed');
await page.getByTestId('topbar-pdf').click();
await page.waitForSelector('[data-testid=text-viewer]');
check(/Cast on 50-50-54-54-54-58 stitches with US 6 needles\./.test(await page.getByTestId('text-scroll').innerText()), 'offline: ORIGINAL TEXT shows the untouched source (all sizes, US 6)');
await page.getByTestId('text-return').click();

await page.reload();                       // still offline
await page.waitForSelector('[data-testid=outline]', { timeout: 15000 });
ok('offline reload: app and project load with the network off');
await ctx.setOffline(false);
await page.goto(BASE); await page.waitForSelector('.hero');
check((await page.getByTestId('project-card').count()) === 1, 'project persisted in IndexedDB across reloads');
check(errors.length === 0, 'no page errors', errors.join(' | '));
await browser.close();
process.exit(out.some((x) => !x[0]) ? 1 : 0);
