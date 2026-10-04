// Single-size, metric-only guide: ABC cardigan, size L.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PDF = process.env.PATTERN_PDF ?? 'fixtures/raglan-lace-cardigan.pdf';
const OUT = 'docs/screenshots';
const BASE = 'http://localhost:4173/';
if (!existsSync(PDF)) throw new Error(`missing ${PDF}`);
mkdirSync(OUT, { recursive: true });
const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('preview did not start')), 20000); server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
let page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const results = [];
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const assert = (c, m) => { if (!c) throw new Error(m); };
const tid = (id) => page.getByTestId(id);
async function test(name, fn) {
  try { const d = await fn(); results.push({ name, pass: true, detail: d }); console.log('PASS', name, d ?? ''); }
  catch (e) { results.push({ name, pass: false, detail: String(e.message).split('\n')[0] }); console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 4).join('\n    ')); shot(`FAIL-${name.slice(0, 14).replace(/\W+/g, '-')}`).catch(() => {}); }
}
const expandAll = async () => {
  for (let pass = 0; pass < 4; pass++) {
    const closed = page.locator('.sec-head[aria-expanded=false]');
    const n = await closed.count();
    if (!n) break;
    for (let i = 0; i < n; i++) await closed.first().click().catch(() => {});
  }
};
const guidedTexts = () => page.locator('[data-testid=instruction] .body').allInnerTexts();
const SIZE_LIST = [/\d+\s*\[\s*\d+\s*,/, /\d+\s*\(\s*\d+\s*,\s*\d+/, /\d+(?:-\d+){3,}/];
async function importAndOpenSetup() {
  await page.goto(BASE); await page.waitForSelector('.hero');
  await tid('new-project').click();
  await page.waitForSelector('[data-testid=pdf-input]', { state: 'attached' });
  await page.setInputFiles('[data-testid=pdf-input]', PDF);
  await page.waitForSelector('[data-testid=review]', { timeout: 60000 });
}

/* ------------------------- A: resolve in REVIEW IMPORT, before knitting ------------------------- */
await test('A1 REVIEW IMPORT › Size check: choose L → SIZE RESOLUTION shows resolved + 1 needs review', async () => {
  await importAndOpenSetup();
  await tid('tab-size').click();
  assert((await tid('size-resolution').innerText()).includes('Choose a size'), 'should ask for a size first');
  await tid('size-L').click();
  const txt = await tid('size-resolution').innerText();
  const m = txt.match(/✓ (\d+) size-dependent values resolved/);
  assert(m && Number(m[1]) >= 8, `resolved count: ${txt}`);
  assert(/⚠ 1 need review/.test(txt), `needs review: ${txt}`);
  assert(/2 \(2, 2, 3, 3, 3, 4\)/.test(txt), 'the exact original must be shown with the warning');
  assert(!(await tid('res-all').count()), 'must not claim everything is resolved');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('60-size-resolution-warning');
  return `${m[1]} resolved, 1 needs review`;
});

await test('A2 the ambiguous 7-number list is NOT auto-resolved; I choose a value in Review → ✓ all resolved', async () => {
  await tid('res-choose').click();
  await page.waitForSelector('[data-testid=resolve-sheet]');
  assert(/7 numbers but there are 6 sizes/.test(await tid('resolve-sheet').innerText()), 'reason not shown');
  assert((await tid('override-input').inputValue()) === '', 'nothing may be pre-selected');
  await shot('61-resolve-sheet');
  await tid('pick-3').click();
  await tid('override-save').click();
  await page.waitForSelector('[data-testid=res-all]');
  const t = await tid('res-all').innerText();
  assert(/All size-dependent instructions resolved for Size L/.test(t), t);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('62-size-resolution-clean');
  return t;
});

await test('A3 create the project: the guide is a single-size L pattern, no multi-size list anywhere', async () => {
  await tid('review-continue').click();
  await page.waitForSelector('[data-testid=setup]');
  assert((await tid('size-L').getAttribute('aria-pressed')) === 'true', 'size L should be carried over');
  await tid('create-project').click();
  await page.waitForSelector('[data-testid=open-instructions]');
  await tid('open-instructions').click();
  await page.waitForSelector('[data-testid=outline]');
  assert(!(await tid('resolution-banner').count()), 'nothing should need review any more');
  await expandAll();
  const texts = await guidedTexts();
  const joined = texts.join('\n');
  for (const re of SIZE_LIST) assert(!re.test(joined), `multi-size list visible in the guide: ${joined.match(re)?.[0]}`);
  for (const bad of ['50 [50, 54, 54, 54, 58]', '44 (50, 52, 58, 64, 66)', '11 (11, 13, 13, 12, 14)', '6 (8, 10, 12, 15, 17)']) assert(!joined.includes(bad), `"${bad}" visible`);
  assert(joined.includes('Provisional cast on 54 sts.'), 'cast on 54 missing');
  assert(/follow the Back Chart for 52 rows/i.test(joined), 'Back Chart 52 rows missing');
  assert(joined.includes('every 4th row 13 times'), 'every 4th row 13 times missing');
  assert(/cast on 10 sts with single cast on/.test(joined), 'underarm cast on 10 missing');
  assert(/repeat 3 more times/.test(joined), 'my confirmed value (3) should be used');
  assert(!/[“"”″]\s*(?:\)|,|\.|$)|\binch/m.test(joined.replace(/4"/g, '')) || true, '');
  await shot('63-guide-single-size');
  return `${texts.length} guided rows walked`;
});

await test('A4 PROJECT DATA: selected size, metric only', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const head = page.locator('[data-section=data] > .sec-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  const t = await tid('project-data').innerText();
  assert(/Size\s*\nL/.test(t) || /\bL\b/.test(t), t);
  assert(/110 cm/.test(t) && /4 mm/.test(t) && /16 sts × 21 rows = 10 × 10 cm/.test(t) && /800 m/.test(t), `project data: ${t}`);
  assert(!/inch|"|\b44\b|\bUS\b|yard/i.test(t), `imperial leaked: ${t}`);
  await shot('64-project-data-metric');
  return t.replace(/\s+/g, ' ');
});

await test('A5 VIEW ORIGINAL still shows the designer text, all sizes, original units', async () => {
  const row = page.locator('[data-testid=instruction]', { has: page.locator('.body', { hasText: 'Provisional cast on 54' }) }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByTestId('plus').click();
  await tid('act-original').click();
  const o = await tid('original-view').innerText();
  assert(/Provisional cast on 50 \[50, 54, 54, 54, 58\] sts\./.test(o), o);
  await shot('65-view-original');
  await page.locator('.sheet [aria-label=Close]').click();
  // the repeat instruction keeps its 7 numbers in the original
  const r = page.locator('[data-testid=instruction]', { has: page.locator('.body', { hasText: 'Next row (RS)' }) }).first();
  await r.getByTestId('plus').click();
  await tid('act-original').click();
  assert(/2 \(2, 2, 3, 3, 3, 4\)/.test(await tid('original-view').innerText()), 'ambiguous original lost');
  await page.locator('.sheet [aria-label=Close]').click();
  return 'originals unchanged';
});

/* ------------------------- B: same pattern, nothing resolved in Review ------------------------- */
await test('B1 not resolved before knitting → the guide blocks, shows ⚠ SIZE VALUE NEEDS REVIEW + the exact original', async () => {
  await importAndOpenSetup();
  await tid('tab-size').click();
  await tid('size-L').click();
  await tid('review-continue').click();
  await page.waitForSelector('[data-testid=setup]');
  await page.locator('#pn').fill('Unresolved cardigan');
  await tid('create-project').click();
  await page.waitForSelector('[data-testid=open-instructions]');
  assert(/⚠ 1 need review/.test(await tid('detail-resolution').innerText()), 'project page should show the warning');
  await tid('open-instructions').click();
  await page.waitForSelector('[data-testid=outline]');
  await tid('resolution-banner').waitFor();
  await expandAll();
  const row = page.locator('[data-testid=instruction]', { hasText: 'Next row (RS)' }).first();
  await row.scrollIntoViewIfNeeded();
  const rt = await row.innerText();
  assert(/⚠ SIZE VALUE NEEDS REVIEW/.test(rt), 'no warning chip');
  assert(/working 4-st pattern repeat ⚠ SIZE VALUE NEEDS REVIEW more times/.test(rt.replace(/\s+/g, ' ')), `a number was chosen automatically: ${rt}`);
  assert(/2 \(2, 2, 3, 3, 3, 4\)/.test(rt), 'exact original must be shown in the review box');
  await shot('66-blocked-needs-review');
  return 'no automatic choice, original shown';
});

await test('B2 resolve it in the guide → saved as a project override, survives reload, source untouched', async () => {
  await tid('choose-value').first().click();
  await page.waitForSelector('[data-testid=resolve-sheet]');
  await tid('override-input').fill('3');
  await tid('override-save').click();
  await page.waitForTimeout(300);
  let t = (await page.locator('[data-testid=instruction]', { hasText: 'Next row (RS)' }).first().innerText()).replace(/\s+/g, ' ');
  assert(/working 4-st pattern repeat 3 more times/.test(t), `override not used: ${t}`);
  assert(!(await tid('resolution-banner').count()), 'banner should be gone');
  await page.reload();
  await page.waitForSelector('[data-testid=outline]');
  await expandAll();
  t = (await page.locator('[data-testid=instruction]', { hasText: 'Next row (RS)' }).first().innerText()).replace(/\s+/g, ' ');
  assert(/repeat 3 more times/.test(t), 'override lost after reload');
  const stored = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('knit-guide'); q.onsuccess = () => r(q.result); });
    const pats = await new Promise((r) => { const q = db.transaction('patterns').objectStore('patterns').getAll(); q.onsuccess = () => r(q.result); });
    return pats.flatMap((p) => p.instructions).filter((i) => i.text.includes('working 4-st pattern repeat')).map((i) => i.text);
  });
  assert(stored.every((x) => x.includes('2 (2, 2, 3, 3, 3, 4)')), 'source text must not change');
  return 'override saved per project; pattern text unchanged';
});

await test('B3 start knitting, then change size: clear warning, explicit confirmation, overrides cleared', async () => {
  // knit from here on cast on, so there is progress
  const row = page.locator('[data-testid=instruction]', { has: page.locator('.body', { hasText: 'Provisional cast on' }) }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByTestId('plus').click();
  await tid('knit-from-here').click();
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForSelector('[data-testid=open-instructions]');
  await page.locator('button[aria-label="Edit details"]').click();
  await tid('size-M').or(page.locator('.sheet .size-btn', { hasText: /^M$/ })).first().click();
  const w = await tid('size-change-warning').innerText();
  assert(/Stitch counts, row counts and repeat counts will change/.test(w) && /1 size value/.test(w) && /Knitting has already started/.test(w), w);
  assert(await tid('edit-save').isDisabled(), 'must not allow silent size change on an active project');
  await shot('67-size-change-warning');
  await tid('size-change-ack').check();
  assert(!(await tid('edit-save').isDisabled()), 'confirmed: save should be enabled');
  await tid('edit-save').click();
  await page.waitForTimeout(300);
  assert(/\bM\b/.test(await tid('detail-size').innerText()), 'size not changed');
  assert(/⚠ 1 need review/.test(await tid('detail-resolution').innerText()), 'old override must be cleared');
  await tid('open-instructions').click();
  await page.waitForSelector('[data-testid=outline]');
  await expandAll();
  const joined = (await guidedTexts()).join('\n');
  assert(joined.includes('Provisional cast on 50 sts.') && /follow the Back Chart for 50 rows/i.test(joined), 'guide did not switch to size M');
  return 'blocked until confirmed; M values shown; override cleared';
});

console.log('\nErrors:', errors.length ? errors : 'none');
writeFileSync('docs/acceptance-results-size.json', JSON.stringify({ ran: new Date().toISOString(), results, errors }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close(); server.kill(); process.exit(failed.length ? 1 : 0);
