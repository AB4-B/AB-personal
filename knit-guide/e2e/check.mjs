// Pattern Check: the summary, only doubtful instructions are listed, corrections are saved. SYNTHETIC text only.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'docs/screenshots';
const BASE = 'http://localhost:4173/';
const SCARF = readFileSync('fixtures/synthetic-scarf.txt', 'utf8');
mkdirSync(OUT, { recursive: true });
const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('preview did not start')), 20000); server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
await context.addInitScript(() => {
  // test hooks: make the main database fail to open, or make project writes fail
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = function (name, ...a) {
    if (name === 'knit-guide' && localStorage.getItem('kg:test:faildb') === '1') {
      const req = {};
      setTimeout(() => { req.error = new DOMException('blocked by test', 'AbortError'); req.onerror && req.onerror({ target: req }); }, 0);
      return req;
    }
    return open(name, ...a);
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    if (this.name === 'projects' && localStorage.getItem('kg:test:failput') === '1') throw new DOMException('quota (test)', 'QuotaExceededError');
    return put.apply(this, a);
  };
});
let page = await context.newPage();
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(String(e)));
watch(page);
const results = [];
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const assert = (c, m) => { if (!c) throw new Error(m); };
const tid = (id) => page.getByTestId(id);
async function test(name, fn) {
  try { const d = await fn(); results.push({ name, pass: true, detail: d }); console.log('PASS', name, d ?? ''); }
  catch (e) { results.push({ name, pass: false, detail: String(e.message).split('\n')[0] }); console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 4).join('\n    ')); shot(`FAIL-${name.slice(0, 14).replace(/\W+/g, '-')}`).catch(() => {}); }
}

async function createFromPaste(text, size, name) {
  await page.goto(BASE); await page.waitForSelector('.hero');
  await tid('new-project').click();
  await page.waitForSelector('[data-testid=paste-input]');
  await tid('paste-input').fill(text);
  await tid('paste-read').click();
  await page.waitForSelector('[data-testid=review]');
  await tid('review-continue').click();
  await page.waitForSelector('[data-testid=setup]');
  await tid(`size-${size}`).click();
  if (name) await tid('project-name').fill(name);
  await tid('create-project').click();
  await page.waitForSelector('[data-testid=open-instructions]');
}
const cardText = async () => (await tid('knit-card').innerText()).replace(/\s+/g, ' ');


const HAT = `Check Hat
SIZE: One size.
NEEDLES: 4 mm circular.
GAUGE: 20 stitches and 28 rows = 10 x 10 cm.
HAT:
Cast on 80 stitches.
Join in the round.
Knit 4 rounds.
Increase 8 sts evenly across the round. [90 sts]
Work Chart A for 20 rounds.
Bind off all stitches.`;
const pid = () => page.url().split('/p/')[1].split('/')[0];
const n = async (id) => Number((await tid(`${id}-n`).innerText()).split(' ')[0]);

await test('PATTERN CHECK: summary, only doubtful steps listed, a correction is saved and counted', async () => {
  await page.goto(BASE); await page.waitForSelector('.hero');
  await tid('new-project').click(); await page.waitForSelector('[data-testid=paste-input]');
  await tid('paste-input').fill(HAT); await tid('paste-read').click(); await page.waitForSelector('[data-testid=review]');
  await tid('review-continue').click(); await page.waitForSelector('[data-testid=setup]');
  await tid('size-One size').click(); await tid('project-name').fill('Check hat');
  await tid('create-project').click(); await page.waitForSelector('[data-testid=open-instructions]');
  const summary = await tid('check-summary').innerText();
  assert(/interpreted/.test(summary) && /need/.test(summary), `summary on the project screen: ${summary}`);
  await tid('open-check').click(); await page.waitForSelector('[data-testid=pattern-check]');
  assert((await n('check-count')) === 1, `count differences: ${await tid('check-count-n').innerText()}`);
  assert((await n('check-unsupported')) === 1, 'one unsupported chart');
  assert((await n('check-review')) === 0, 'nothing else needs review');
  const items = page.locator('[data-testid=check-item]');
  assert((await items.count()) === 2, `only the two doubtful steps are listed, got ${await items.count()}`);
  const interpreted = await tid('check-interpreted-n').innerText();
  assert(/^4 of 6$/.test(interpreted.trim()), `interpreted: ${interpreted}`);
  // accept the count difference
  await page.locator('[data-testid=check-item][data-kind=count]').getByText('I checked it, it is fine').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=check-count-n]')?.textContent?.trim() === '0');
  // correct the chart instruction
  await page.locator('[data-testid=check-item][data-kind=unsupported]').getByText('Correct this').click();
  await tid('check-text').fill('Work the chart A rows from the original, 20 rounds.');
  await tid('check-save').click();
  await page.waitForSelector('[data-testid=check-clear]');
  assert((await n('check-unsupported')) === 0, 'chart counted as corrected');
  const corrected = await tid('check-corrected').innerText();
  assert(/CORRECTED OR CHECKED BY YOU \(2\)/.test(corrected), corrected);
  // survives a reload; the project screen shows everything interpreted
  await page.reload(); await page.waitForSelector('[data-testid=check-clear]');
  await page.goto(`${BASE}#/p/${pid()}`); await page.waitForSelector('[data-testid=check-summary]');
  assert(/All 6 steps interpreted/.test(await tid('check-summary').innerText()), await tid('check-summary').innerText());
  // the correction is what the knit screen shows
  await page.goto(`${BASE}#/p/${pid()}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  let seen = '';
  for (let i = 0; i < 12 && !/chart A rows/.test(seen); i++) { seen = await cardText(); if (/chart A rows/.test(seen)) break; await tid('step-done').click(); await page.waitForTimeout(80); }
  assert(/chart A rows/.test(seen), `the corrected step was never shown: ${seen.slice(0, 200)}`);
  return 'summary, listing, accept, correct, persisted';
});

console.log('\nErrors:', errors.length ? errors : 'none');
writeFileSync('docs/acceptance-results-check.json', JSON.stringify({ ran: new Date().toISOString(), results, errors }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
server.kill();
process.exit(results.every((r) => r.pass) && errors.length === 0 ? 0 : 1);
