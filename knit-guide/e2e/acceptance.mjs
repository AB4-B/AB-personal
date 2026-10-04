// End-to-end acceptance run on an iPhone-sized viewport (Chromium emulation).
// Usage: npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PDF = process.env.PATTERN_PDF ?? 'fixtures/raglan-lace-cardigan.pdf';
const OUT = 'docs/screenshots';
const BASE = 'http://localhost:4173/';
if (!existsSync(PDF)) throw new Error(`Test pattern not found: ${PDF}`);
mkdirSync(OUT, { recursive: true });

const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
let page = await context.newPage();
const consoleErrors = [];
const watch = (p) => { p.on('pageerror', (e) => consoleErrors.push(String(e))); p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text())); };
watch(page);

const results = [];
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
async function test(name, fn) {
  try { const detail = await fn(); results.push({ name, pass: true, detail }); console.log('PASS', name, detail ?? ''); }
  catch (e) { results.push({ name, pass: false, detail: String(e.message ?? e).split('\n')[0] }); console.log('FAIL', name, '\n   ', String(e.message ?? e).split('\n').slice(0, 4).join('\n    ')); try { await shot(`FAIL-${name.slice(0, 20).replace(/\W+/g, '-')}`); } catch {} }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const tid = (id) => page.getByTestId(id);
const stid = (id) => page.locator('.sheet').getByTestId(id);
const gotoHome = async () => { await page.goto(BASE); await page.waitForSelector('.hero'); };

const SHEET_ACTION = async (testid) => { await page.getByTestId(testid).click(); };
async function openInstruction(re) {
  const row = page.locator('[data-testid=instruction]', { has: page.locator('.body', { hasText: re }) }).first();
  await row.scrollIntoViewIfNeeded();
  await row.getByTestId('plus').click();
  await page.waitForSelector('.sheet');
}
const closeSheet = async () => { await page.locator('.sheet [aria-label=Close]').first().click(); await page.waitForSelector('.sheet', { state: 'detached' }); };

let projectUrl;

await test('T1 create project from the cardigan PDF (upload → parse → review)', async () => {
  await gotoHome();
  await shot('01-home-empty');
  await tid('new-project').click();
  await page.waitForSelector('[data-testid=pdf-input]', { state: 'attached' });
  await shot('02-upload');
  await page.setInputFiles('[data-testid=pdf-input]', PDF);
  await page.waitForSelector('[data-testid=review]', { timeout: 60000 });
  await shot('03-review-details');
  const title = await page.locator('#rt').inputValue();
  assert(title === 'Top-Down Raglan Summer Lace Cardigan', `title was "${title}"`);
  assert((await page.locator('#rs').inputValue()) === 'S, M, L, XL, 2X, 3X', 'sizes not detected');
  await tid('tab-outline').click();
  await page.waitForSelector('[data-testid=rv-ins]');
  await shot('04-review-outline');
  await tid('tab-images').click();
  await page.waitForSelector('[data-testid=rv-image]');
  const nImg = await page.locator('[data-testid=rv-image]').count();
  await shot('05-review-charts');
  await tid('tab-abbr').click();
  await tid('warning-count').scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await tid('warning-count').click();
  await shot('06-review-warnings');
  return `review screen shown, ${nImg} images found`;
});

await test('T2 select one of the six sizes (L) and finish setup', async () => {
  await tid('review-continue').click();
  await page.waitForSelector('[data-testid=setup]');
  const sizes = await page.locator('[data-testid=size-pick] .size-btn').count();
  assert(sizes === 6, `expected 6 sizes, got ${sizes}`);
  await tid('size-L').click();
  assert((await tid('size-L').getAttribute('aria-pressed')) === 'true', 'size not selected');
  await page.locator('#pn').fill("Amanda's summer cardigan");
  await page.locator('#bl').fill('Mid-thigh');
  await page.locator('#md').fill('Make this a long cardigan. Aim for mid-thigh.');
  await page.getByLabel('My gauge stitches').fill('16');
  await page.getByLabel('My gauge rows').fill('21');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('07-setup-size');
  await tid('create-project').click();
  await page.waitForSelector('[data-testid=open-instructions]');
  projectUrl = page.url();
  await shot('08-project-detail-new');
  const sz = await tid('detail-size').innerText();
  assert(sz.startsWith('L'), `size shown as ${sz}`);
  return `size shown: ${sz.replace(/\n/g, ' ')}`;
});

await test('T3 open the collapsible pattern outline', async () => {
  await tid('open-instructions').click();
  await page.waitForSelector('[data-testid=outline]');
  const heads = await page.locator('.sec-head').allInnerTexts();
  await shot('09-outline-collapsed');
  // expand Pattern notes + For Reference
  await page.locator('[data-section=ref] > .sec-head').click();
  await page.locator('[data-section=ref-charts] > .sec-head').click();
  await page.locator('[data-section=ref-abbr] > .sec-head').click();
  await shot('10-outline-reference');
  await page.locator('[data-section=ref] > .sec-head').click();
  const open = await page.locator('.sec.open').count();
  return `sections: ${heads.map((h) => h.split('\n')[0]).join(' | ')}`;
});

await test('T4 choose a yoke instruction → KNIT FROM HERE', async () => {
  await openInstruction(/Next row \(RS\)/);
  await shot('11-instruction-sheet');
  await tid('knit-from-here').click();
  await page.waitForSelector('.sheet', { state: 'detached' });
  const cur = page.locator('[data-current]');
  assert((await cur.count()) === 1, 'no current instruction highlighted');
  const txt = await cur.innerText();
  assert(/Next row \(RS\)/.test(txt), 'wrong instruction is current');
  await shot('12-knit-from-here');
  return 'highlighted with NOW KNITTING tag';
});

await test('T5 browse elsewhere → TO CURRENT INSTRUCTION returns to it', async () => {
  // open the last section far below and scroll there
  await page.locator('[data-section]', { has: page.locator('.sec-head', { hasText: 'Button Band' }) }).locator('> .sec-head').click();
  await page.locator('.sec-head', { hasText: 'Button Band' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForSelector('[data-testid=to-current]', { timeout: 5000 });
  await shot('13-browsing-elsewhere');
  await tid('to-current').click();
  await page.waitForFunction(() => { const r = document.querySelector('[data-current]')?.getBoundingClientRect(); return r && r.top > 40 && r.top < innerHeight * 0.5; }, null, { timeout: 5000 });
  await shot('14-back-at-current');
  return 'current instruction scrolled into view';
});

await test('T6 attach a repeat counter to an instruction', async () => {
  await openInstruction(/AT THE SAME TIME/);
  const chips = await page.locator('[data-testid=suggestion]').allInnerTexts();
  await tid('act-counter').click();
  await tid('kind-times').click();
  await tid('counter-target').fill('13');
  await tid('create-counter').click();
  await page.waitForSelector('.sheet [data-testid=counter]');
  await page.getByLabel('Plus one').first().click();
  await page.getByLabel('Plus one').first().click();
  await page.getByLabel('Plus one').first().click();
  const v = await stid('counter-value').first().innerText();
  assert(/3\s*\/\s*13/.test(v.replace(/\n/g, ' ')), `counter shows "${v}"`);
  await shot('15-repeat-counter');
  await closeSheet();
  return `Repeat 3 / 13 (suggested chips: ${chips.join(', ')})`;
});

await test('T7 stitch counter: target 164, group 10 → 16 groups + 4 = 164/164', async () => {
  await openInstruction(/Next row \(RS\)/);
  await tid('act-stitch').click();
  await tid('stitch-target').fill('164');
  await tid('group-10').click();
  await tid('create-stitch').click();
  await page.waitForSelector('.sheet [data-testid=stitch-counter]');
  for (let i = 0; i < 12; i++) await stid('plus-group').click();
  for (let i = 0; i < 3; i++) await stid('plus-one').click();
  const mid = await stid('stitch-formula').innerText();
  assert(mid === '12 × 10 + 3 = 123', `mid-count formula "${mid}"`);
  await shot('16-stitch-counter-123');
  for (let i = 0; i < 4; i++) await stid('plus-group').click();
  for (let i = 0; i < 1; i++) await stid('plus-one').click();
  const formula = await stid('stitch-formula').innerText();
  assert(formula === '16 × 10 + 4 = 164', `formula "${formula}"`);
  const done = await stid('stitch-complete').innerText();
  assert(/164\/164/.test(done), `banner "${done}"`);
  await shot('17-stitch-counter-164');
  await closeSheet();
  return `${formula} · ${done}`;
});

await test('T8 add note "Stopped after second marker."', async () => {
  await openInstruction(/Next row \(RS\)/);
  await tid('act-note').click();
  await page.getByLabel('New note').fill('Stopped after second marker.');
  await page.getByRole('button', { name: 'SAVE NOTE' }).click();
  await page.waitForSelector('[data-testid=note]');
  await closeSheet();
  return 'note saved on the instruction';
});

await test('T9 Quick Stop', async () => {
  await tid('quick-stop').click();
  await page.waitForSelector('[data-testid=stop-saved]');
  await tid('stop-note').fill('Finished second raglan increase, next row is WS.');
  await shot('18-quick-stop');
  await tid('stop-done').click();
  return 'stopping point + note saved';
});

let beforeReload;
await test('T10 close/reload the application', async () => {
  beforeReload = await page.evaluate(() => document.querySelector('[data-current]')?.id);
  await page.reload();
  await page.waitForSelector('[data-testid=outline]');
  // fully close the page and open a fresh one (≈ closing Safari)
  await page.close();
  page = await context.newPage();
  watch(page);
  await page.goto(BASE);
  await page.waitForSelector('.hero');
  return 'reloaded, then closed tab and opened a new one';
});

await test('T11 resume project: exact instruction, counters, stitch count, note, size, modification', async () => {
  await shot('19-home-resume');
  await tid('resume-active').click();   // "resume active project" card on Home
  await page.waitForSelector('[data-testid=outline]');
  await page.waitForFunction(() => document.querySelector('[data-current]'));
  const afterId = await page.evaluate(() => document.querySelector('[data-current]')?.id);
  assert(afterId === beforeReload, `current instruction changed: ${beforeReload} → ${afterId}`);
  // project page continue card
  await page.goto(projectUrl);
  await page.waitForSelector('[data-testid=continue-card]');
  const card = await tid('continue-card').innerText();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('20-continue-card');
  assert(/CONTINUE KNITTING/.test(card), 'no CONTINUE KNITTING card');
  assert(/Finished second raglan increase/.test(card), 'last note missing on card');
  assert(/Cardigan/.test(card), 'section missing on card');
  assert((await tid('detail-size').innerText()).startsWith('L'), 'size lost');
  assert(await page.getByText('Make this a long cardigan. Aim for mid-thigh.').first().isVisible(), 'modification lost');
  await tid('continue-card').click();
  await page.waitForSelector('[data-testid=live-panel]');
  const stitch = await tid('stitch-formula').innerText();
  assert(stitch === '16 × 10 + 4 = 164', `stitch counter after reload: ${stitch}`);
  assert(await tid('stitch-complete').isVisible(), 'complete banner lost');
  const noteVisible = await page.getByText('Stopped after second marker.').first().isVisible();
  assert(noteVisible, 'instruction note lost');
  await page.waitForTimeout(600);
  const inView = await page.evaluate(() => { const r = document.querySelector('[data-current]').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; });
  assert(inView, 'did not scroll to the exact instruction');
  await shot('21-resumed-live-panel');
  // repeat counter lives on the V-neck instruction
  await openInstruction(/AT THE SAME TIME/);
  const rep = (await stid('counter-value').first().innerText()).replace(/\n/g, ' ');
  assert(/3\s*\/\s*13/.test(rep), `repeat counter after reload: ${rep}`);
  await closeSheet();
  return `same instruction (${afterId}), ${stitch}, repeat ${rep}, note + size + modification restored`;
});

await test('T12 open original PDF and return without losing progress', async () => {
  await page.getByTestId('topbar-pdf').click();
  await page.waitForSelector('[data-testid=pdf-viewer] canvas', { timeout: 20000 });
  await page.locator('[data-testid=pdf-zoom-in]').click();
  await page.waitForTimeout(400);
  await shot('22-pdf-viewer');
  // jump to source page of the current instruction, then scroll to page 3 to test memory
  await page.locator('[data-testid=pdf-scroll]').evaluate((el) => { el.scrollTop = document.getElementById('pdfpage-3').offsetTop - 10; });
  await page.waitForTimeout(700);
  const pg = await tid('pdf-page').innerText();
  await tid('pdf-return').click();
  await page.waitForSelector('[data-testid=outline]');
  const after = await page.evaluate(() => document.querySelector('[data-current]')?.id);
  assert(after === beforeReload, 'current instruction lost after PDF');
  assert((await tid('stitch-formula').innerText()) === '16 × 10 + 4 = 164', 'stitch count lost after PDF');
  await page.getByTestId('topbar-pdf').click();
  await page.waitForSelector('[data-testid=pdf-viewer] canvas', { timeout: 20000 });
  await page.waitForTimeout(500);
  const pg2 = await tid('pdf-page').innerText();
  assert(/Page 3\//i.test(pg2), `last PDF page not remembered: ${pg2}`);
  await tid('pdf-return').click();
  await page.waitForSelector('[data-testid=outline]');
  return `viewer showed ${pg.replace(/\s+/g, ' ')}; reopened on ${pg2.replace(/\s+/g, ' ')}; progress intact`;
});

await test('T13 simultaneous raglan + V-neck + lace repeat, original text intact', async () => {
  // make the generated row guide the current instruction
  await page.locator('[data-testid=instruction] .body', { hasText: 'row-by-row guide' }).first().scrollIntoViewIfNeeded();
  await openInstruction(/row-by-row guide/);
  await tid('knit-from-here').click();
  await page.waitForSelector('[data-testid=tracker]');
  await page.locator('[data-testid=tracker] button', { hasText: 'Adjust' }).click();
  await page.locator('#jr').fill('17');
  await page.locator('#jr').blur();
  await page.locator('.sheet [aria-label=Close]').click();
  const row17 = await tid('tracker').innerText();
  assert(/ROW 17/.test(row17), 'row 17 not shown');
  assert(/Pattern row 1 of 4/.test(row17), 'lace row 1 of 4 missing');
  const statuses17 = await page.locator('[data-testid=tracker-line]').evaluateAll((els) => els.map((e) => e.dataset.status + ':' + e.querySelector('.lbl').textContent));
  assert(statuses17.some((s) => s.startsWith('do:Raglan')), `raglan should be active on row 17: ${statuses17}`);
  assert(statuses17.some((s) => s.startsWith('do:V-neck')), `V-neck should be active on row 17: ${statuses17}`);
  assert(/Shaping row 5 of 13/.test(row17), 'V-neck event count wrong for size L');
  assert(/AT THE SAME TIME/.test(row17), "designer's original sentence not shown");
  await tid('tracker').scrollIntoViewIfNeeded();
  await shot('23-tracker-row-17');
  await tid('tracker-next').click();
  const row18 = await tid('tracker').innerText();
  assert(/ROW 18/.test(row18) && /Pattern row 2 of 4/.test(row18), 'row 18 lace wrong');
  const statuses18 = await page.locator('[data-testid=tracker-line]').evaluateAll((els) => els.map((e) => e.dataset.status));
  assert(statuses18.every((s) => s === 'none'), `row 18 should have no increases: ${statuses18}`);
  assert(/sl1, purl to end/.test(row18), 'WS row original text missing');
  await shot('24-tracker-row-18');
  await tid('needs-review').click();
  await shot('25-tracker-needs-review');
  // the source instructions are unchanged in the stored pattern
  const same = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('knit-guide'); q.onsuccess = () => r(q.result); });
    const pats = await new Promise((r) => { const q = db.transaction('patterns').objectStore('patterns').getAll(); q.onsuccess = () => r(q.result); });
    return pats[0].instructions.find((i) => i.text.startsWith('AT THE SAME TIME'))?.text;
  });
  assert(same === 'AT THE SAME TIME, to shape the V-neck, work the increases at the beginning and the end of the row in every 4th row 11 (11, 13, 13, 12, 14) times.', `stored text altered: ${same}`);
  return 'row 17: lace 1/4 + raglan + V-neck (5 of 13); row 18: lace 2/4, no increases; source text byte-identical';
});

await test('Extra: explain, abbreviations, size resolution + Original, chart viewer, modifications', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await openInstruction(/Provisional cast on/);
  const guidedTxt = await tid('sheet-pattern').innerText();
  assert(/Provisional cast on 54 sts\./.test(guidedTxt), `size L cast on should read 54 sts, got: ${guidedTxt}`);
  assert(!/\[|50, 54/.test(guidedTxt), 'other sizes visible in the guide');
  await shot('26-size-resolved');
  await tid('act-original').click();
  const orig = await tid('original-view').innerText();
  assert(/50 \[50, 54, 54, 54, 58\]/.test(orig), 'View Original must show the untouched multi-size text');
  await shot('27-original-numbers');
  await page.locator('.sheet [aria-label=Back]').click();
  await tid('act-explain').click();
  await shot('28-explain');
  await page.locator('.sheet [aria-label=Back]').click();
  await closeSheet();
  await page.locator('[data-section]', { has: page.locator('.sec-head', { hasText: 'Pattern notes' }) }).locator('> .sec-head').click();
  await openInstruction(/Lace Pattern in rows/);
  await page.locator('.sheet [data-testid=sheet-pattern] .abbr', { hasText: /^ssk$/ }).first().click();
  await page.waitForSelector('[data-testid=abbr-sheet]');
  const abbr = await tid('abbr-sheet').innerText();
  assert(/slip, slip, knit/i.test(abbr) && /From the pattern/i.test(abbr), `abbreviation sheet: ${abbr}`);
  await shot('28b-abbreviation-ssk');
  await page.locator('.sheet [aria-label=Close]').last().click();
  await tid('act-explain').click();
  const steps = await tid('explain-steps').innerText();
  assert(/Knit 2 stitches\./.test(steps) && /yarn over/.test(steps) && /Slip the next two stitches knitwise/.test(steps), `steps: ${steps}`);
  await shot('29-explain-lace');
  await closeSheet();
  // abbreviation tap in an instruction
  await page.locator('[data-testid=instruction] .body .abbr', { hasText: /^ssk$/ }).first().scrollIntoViewIfNeeded().catch(() => {});
  return 'guide says 54 sts for L; View Original shows 50 [50, 54, 54, 54, 58]; explain gives plain steps';
});

await test('Extra: durability, taps right before reload/close are not lost', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await openInstruction(/AT THE SAME TIME/);
  const read = async () => (await stid('counter-value').first().innerText()).replace(/\s+/g, ' ');
  const before = Number((await read()).split('/')[0]);
  for (let i = 0; i < 5; i++) await page.locator('.sheet').getByLabel('Plus one').first().click({ noWaitAfter: true });
  await page.reload();            // immediately, without waiting for any save
  await page.waitForSelector('[data-testid=outline]');
  await openInstruction(/AT THE SAME TIME/);
  const after = Number((await read()).split('/')[0]);
  assert(after === before + 5, `counter was ${before}, five taps then reload gave ${after}`);
  await closeSheet();
  return `${before} → ${after} after 5 taps + instant reload`;
});

await test('Extra: section note + accidental-reset protection', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-section]', { has: page.locator('.sec-head', { hasText: 'Cardigan' }) }).first().locator('[data-testid=section-note-btn]').first().click();
  await page.getByLabel('New note').fill('Check gauge before dividing.');
  await page.getByRole('button', { name: 'SAVE NOTE' }).click();
  await page.waitForSelector('text=Check gauge before dividing.');
  // reset needs a second tap
  await openInstruction(/AT THE SAME TIME/);
  const before = (await stid('counter-value').first().innerText()).replace(/\s+/g, ' ');
  await page.locator('.sheet').getByRole('button', { name: 'Reset', exact: true }).first().click();
  const armed = await page.locator('.sheet').getByRole('button', { name: /Tap again to reset/ }).count();
  const mid = (await stid('counter-value').first().innerText()).replace(/\s+/g, ' ');
  assert(armed === 1 && mid === before, `reset fired on first tap (${before} → ${mid})`);
  await closeSheet();
  return 'section note saved; first tap on Reset only arms it';
});

await test('Extra: chart viewer opens, zooms, returns to current', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[data-section=ref] > .sec-head').click();
  await page.locator('[data-section=ref-charts] > .sec-head').click().catch(() => {});
  if (!(await tid('chart-tile').first().isVisible())) await page.locator('[data-section=ref-charts] > .sec-head').click();
  await tid('chart-tile').first().click();
  await page.waitForSelector('[data-testid=chart-img]');
  await page.waitForTimeout(300);
  const s0 = Number(await tid('chart-img').getAttribute('data-scale'));
  await shot('30-chart-viewer');
  await tid('chart-zoom-in').click(); await tid('chart-zoom-in').click();
  const s1 = Number(await tid('chart-img').getAttribute('data-scale'));
  assert(s1 > s0 * 1.5, `zoom did not change (${s0} → ${s1})`);
  await shot('31-chart-zoomed');
  await tid('chart-return').click();
  await page.waitForSelector('[data-testid=outline]');
  return `scale ${s0.toFixed(2)} → ${s1.toFixed(2)}`;
});

await test('Extra: works offline after first load (PWA)', async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(projectUrl);
  await page.waitForSelector('[data-testid=continue-card]', { timeout: 15000 });
  await shot('32-offline-project');
  await page.getByTestId('open-pdf').click();
  await page.waitForSelector('[data-testid=pdf-viewer] canvas', { timeout: 20000 });
  await context.setOffline(false);
  return 'project + original PDF open with the network off';
});

await test('Extra: home screen with project', async () => {
  await gotoHome();
  await shot('33-home-with-project');
  return 'ok';
});

console.log('\nConsole/page errors:', consoleErrors.length ? consoleErrors : 'none');
writeFileSync('docs/acceptance-results.json', JSON.stringify({ ran: new Date().toISOString(), viewport: '390x844 @2x iPhone emulation (Chromium)', results, consoleErrors }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
process.exit(failed.length ? 1 : 0);
