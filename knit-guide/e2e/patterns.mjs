// Second-pattern acceptance: (A) copy-paste import of the DROPS "No Nonsense Cardigan" web text,
// (B) PDF import of the DROPS "Sand Ripples" pattern printed from Safari.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'docs/screenshots';
const BASE = 'http://localhost:4173/';
const PASTE = process.env.PASTE_TXT ?? 'fixtures/drops-244-8-pasted.txt';
const SAND = process.env.SAND_PDF ?? 'fixtures/drops-no-nonsense-cardigan.pdf';
for (const f of [PASTE, SAND]) if (!existsSync(f)) throw new Error(`missing fixture ${f}`);
mkdirSync(OUT, { recursive: true });

const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('preview did not start')), 20000); server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' };

const results = [];
const errors = [];
let page;
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const assert = (c, m) => { if (!c) throw new Error(m); };
const tid = (id) => page.getByTestId(id);
async function test(name, fn) {
  try { const d = await fn(); results.push({ name, pass: true, detail: d }); console.log('PASS', name, d ?? ''); }
  catch (e) { results.push({ name, pass: false, detail: String(e.message).split('\n')[0] }); console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 3).join('\n    ')); try { await shot(`FAIL-${name.slice(0, 18).replace(/\W+/g, '-')}`); } catch {} }
}
const openSec = async (title) => { const h = page.locator('.sec-head', { hasText: title }).first(); await h.scrollIntoViewIfNeeded(); if ((await h.getAttribute('aria-expanded')) !== 'true') await h.click(); };
async function openInstruction(re) {
  const row = page.locator('[data-testid=instruction]', { has: page.locator('.body', { hasText: re }) }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByTestId('plus').click();
  await page.waitForSelector('.sheet');
}
const closeSheet = async () => { await page.locator('.sheet [aria-label=Close]').last().click(); await page.waitForTimeout(150); };

/* ============================ A: pasted text ============================ */
let ctx = await browser.newContext(ctxOpts);
page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE); await page.waitForSelector('.hero');

await test('P1 paste the website text → review', async () => {
  await tid('new-project').click();
  await page.waitForSelector('[data-testid=paste-input]');
  await tid('paste-input').fill(readFileSync(PASTE, 'utf8'));
  await shot('40-paste-input');
  await tid('paste-read').click();
  await page.waitForSelector('[data-testid=review]');
  assert((await page.locator('#rt').inputValue()) === 'No Nonsense Cardigan', 'title');
  assert((await page.locator('#rs').inputValue()) === 'S, M, L, XL, XXL, XXXL', 'sizes');
  assert(/17/.test(await page.getByLabel('Gauge stitches').inputValue()), 'gauge stitches');
  await shot('41-paste-review-details');
  await tid('tab-outline').click();
  const sections = await page.locator('[data-testid=rv-section] input[aria-label="Section heading"]').evaluateAll((els) => els.map((e) => e.value));
  assert(sections.includes('YOKE') && sections.includes('V-NECK'), `sections: ${sections}`);
  const junk = await page.locator('[data-testid=rv-ins] textarea').evaluateAll((els) => els.map((e) => e.value).filter((t) => /Videos|Lessons|Comments \(|related pattern|You might also like|Charred/.test(t)));
  assert(junk.length === 0, `web chrome leaked into the outline: ${junk[0]}`);
  await shot('42-paste-review-outline');
  return `${sections.length} sections, no web chrome`;
});

await test('P2 choose XL, create project, dash lists resolve (cast on 68-68-68-74-74-74 → 74)', async () => {
  await tid('review-continue').click();
  await page.waitForSelector('[data-testid=setup]');
  await tid('size-XL').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('43-paste-setup');
  await tid('create-project').click();
  await page.waitForSelector('[data-testid=open-instructions]');
  const pre = await tid('detail-size').innerText();
  assert(/XL/.test(pre) && /128 cm/.test(pre) && !/inch|⅜|"/.test(pre), `size line: ${pre}`);
  assert(/ORIGINAL TEXT/.test(await tid('open-pdf').innerText()), 'button should say ORIGINAL TEXT');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('44-paste-project');
  await tid('open-instructions').click();
  await page.waitForSelector('[data-testid=outline]');
  await openSec('START THE PIECE HERE');
  await openSec('LEFT BAND');
  await openInstruction(/Cast on 74 stitches at the end of this row/);
  const val = (await tid('sheet-pattern').innerText()).match(/(?:Cast on|cast on) (\d+)/)?.[1] ?? '?';
  assert(val === '74', `resolved ${val}`);
  await shot('45-paste-dash-resolved');
  const chip = (await page.locator('[data-testid=suggestion]').allInnerTexts()).join('|');
  assert(/STITCH COUNTER: 74/.test(chip), `chips ${chip}`);
  await page.locator('[data-testid=suggestion]', { hasText: 'STITCH COUNTER' }).first().click();
  await tid('knit-from-here').click();
  await page.waitForSelector('[data-testid=live-panel] [data-testid=stitch-counter]');
  return `XL → ${val}; stitch counter suggested and started at 74`;
});

await test('P3 YOKE guide: V-neck every 4th row (14 times for XL), complex raglan flagged NEEDS REVIEW', async () => {
  await openSec('YOKE');
  await openInstruction(/row-by-row guide/);
  await tid('knit-from-here').click();
  await page.waitForSelector('[data-testid=tracker]');
  const t1 = await tid('tracker').innerText();
  assert(/ROW 1\b/.test(t1) && /Shaping row 1 of 14/.test(t1), `row 1: ${t1.slice(0, 200)}`);
  assert(/NEEDS REVIEW/.test(t1), 'raglan should be flagged');
  await tid('tracker').scrollIntoViewIfNeeded();
  await shot('46-paste-yoke-row-1');
  for (let i = 0; i < 4; i++) await tid('tracker-next').click();
  const t5 = await tid('tracker').innerText();
  assert(/ROW 5\b/.test(t5) && /Shaping row 2 of 14/.test(t5), `row 5: ${t5.slice(0, 200)}`);
  assert(/Increase for the neck inside the bands every 4th row/.test(t5), 'designer sentence missing');
  await shot('47-paste-yoke-row-5');
  return 'row 1 = V-neck shaping 1 of 14, row 5 = 2 of 14 (XL), raglan lines NEEDS REVIEW with originals';
});

await test('P4 original text opens, highlights the current instruction, returns', async () => {
  await page.getByTestId('topbar-pdf').click();
  await page.waitForSelector('[data-testid=text-viewer] .srcline');
  const txt = await tid('text-scroll').innerText();
  assert(/EXPLANATIONS FOR THE PATTERN/.test(txt) && /Videos|Comments \(133\)/.test(txt), 'original (including the web chrome) must be kept unchanged');
  await shot('48-original-text');
  await tid('text-return').click();
  await page.waitForSelector('[data-testid=outline]');
  assert((await page.locator('[data-current]').count()) === 1, 'current lost');
  return 'pasted text kept verbatim including the parts hidden from the guide';
});

await test('P5 reload keeps pasted-text project', async () => {
  await page.reload();
  await page.waitForSelector('[data-testid=tracker]');
  assert(/ROW 5\b/.test(await tid('tracker').innerText()), 'row lost');
  return 'row 5 restored';
});
await ctx.close();

/* ============================ B: Sand Ripples PDF ============================ */
ctx = await browser.newContext(ctxOpts);
page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE); await page.waitForSelector('.hero');

await test('S1 import the Safari-printed DROPS PDF', async () => {
  await tid('new-project').click();
  await page.waitForSelector('[data-testid=pdf-input]', { state: 'attached' });
  await page.setInputFiles('[data-testid=pdf-input]', SAND);
  await page.waitForSelector('[data-testid=review]', { timeout: 60000 });
  assert((await page.locator('#rt').inputValue()) === 'Sand Ripples', 'title');
  assert((await page.locator('#rd').inputValue()) === 'DROPS Design', 'designer');
  assert((await page.locator('#rs').inputValue()) === 'S, M, L, XL, XXL, XXXL', 'sizes');
  await shot('50-sand-review');
  await tid('tab-outline').click();
  const sections = await page.locator('[data-testid=rv-section] input[aria-label="Section heading"]').evaluateAll((els) => els.map((e) => e.value));
  assert(sections.includes('BODY PIECE') && sections.includes('SLEEVE') && sections.includes('ASSEMBLY'), `sections ${sections}`);
  await shot('51-sand-review-outline');
  await tid('tab-images').click();
  const n = await page.locator('[data-testid=rv-image]').count();
  return `${sections.length} sections, ${n} images`;
});

await test('S2 size M is preselected from the print; create', async () => {
  await tid('review-continue').click();
  await page.waitForSelector('[data-testid=setup]');
  assert((await tid('size-M').getAttribute('aria-pressed')) === 'true', 'size M should be preselected');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('52-sand-setup');
  await tid('create-project').click();
  await page.waitForSelector('[data-testid=open-instructions]');
  const sz = await tid('detail-size').innerText();
  assert(/bust 88 cm/.test(sz) && !/in\b|"/.test(sz.replace('bust','')), `size line ${sz}`);
  return sz.replace(/\n/g, ' ');
});

await test('S3 dash list resolves for M; buttonhole list shows ONLY size M, metric; AT THE SAME TIME flagged', async () => {
  await tid('open-instructions').click();
  await page.waitForSelector('[data-testid=outline]');
  await openSec('BODY PIECE');
  await openInstruction(/^Cast on 228 sts/);
  const val = (await tid('sheet-pattern').innerText()).match(/(?:Cast on|cast on) (\d+)/)?.[1] ?? '?';
  assert(val === '228', `cast on for M resolved to ${val}`);
  await shot('53-sand-cast-on-M');
  await closeSheet();
  await openSec('BUTTONHOLES');
  const bh = page.locator('[data-testid=instruction]', { hasText: 'Make buttonholes when piece measures' }).first();
  await bh.scrollIntoViewIfNeeded();
  const bt = await bh.innerText();
  assert(/10, 18, 26 and 34 cm/.test(bt), `size M line missing: ${bt}`);
  assert(!/SIZE [A-Z]/.test(bt) && !/16, 24|8, 15|9, 17/.test(bt) && !/["″]/.test(bt), `other sizes or inches visible: ${bt}`);
  await shot('54-sand-size-lines');
  const flagged = page.locator('[data-testid=instruction]', { hasText: 'AT THE SAME TIME' }).first();
  await flagged.scrollIntoViewIfNeeded();
  assert(await flagged.locator('[data-testid=review-badge]').count() > 0, 'AT THE SAME TIME not flagged');
  await shot('55-sand-simultaneous-flag');
  return 'cast on 228 (M); only the SIZE M buttonhole line, metric only; measurement-based simultaneous instructions flagged';
});

await test('S4 original PDF opens (4 pages)', async () => {
  await page.getByTestId('topbar-pdf').click();
  await page.waitForSelector('[data-testid=pdf-viewer] canvas', { timeout: 20000 });
  const pg = await tid('pdf-page').innerText();
  assert(/\/4/.test(pg), pg);
  await page.waitForTimeout(500);
  await shot('56-sand-pdf');
  return pg.replace(/\s+/g, ' ');
});
await ctx.close();

console.log('\nErrors:', errors.length ? errors : 'none');
writeFileSync('docs/acceptance-results-patterns.json', JSON.stringify({ ran: new Date().toISOString(), results, errors }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close(); server.kill(); process.exit(failed.length ? 1 : 0);
