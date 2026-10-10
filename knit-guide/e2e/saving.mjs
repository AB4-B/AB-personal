// Saving, recovery and backup: failed writes, interrupted saves, failed loads, recovery points, lost library,
// backup file and re-read with progress. Uses the committed SYNTHETIC scarf only.
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

const flag = (k, v) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [`kg:test:${k}`, v]);
const state = () => tid('save-status').getAttribute('data-state');
const waitState = (s, ms = 12000) => page.waitForFunction((s) => document.querySelector('[data-testid=save-status]')?.getAttribute('data-state') === s, s, { timeout: ms });
const pid = () => page.url().split('/p/')[1].split('/')[0];
const knitUrl = () => `${BASE}#/p/${pid()}/knit`;
const stepsDone = async (n) => { for (let i = 0; i < n; i++) { await tid('step-done').click(); await page.waitForTimeout(80); } };
async function newScarf(name) {
  await page.goto(BASE); await page.waitForSelector('.hero');
  await tid('new-project').click(); await page.waitForSelector('[data-testid=paste-input]');
  await tid('paste-input').fill(SCARF); await tid('paste-read').click(); await page.waitForSelector('[data-testid=review]');
  await tid('review-continue').click(); await page.waitForSelector('[data-testid=setup]');
  await tid('size-One size').click(); await tid('project-name').fill(name);
  await tid('create-project').click(); await page.waitForSelector('[data-testid=open-instructions]');
}
const card = async () => (await tid('knit-card').innerText()).replace(/\s+/g, ' ');
const idb = (fn, arg) => page.evaluate(fn, arg);

await test('SAVE STATUS: saved only after the write; a failing write says NOT SAVED, survives a reload, then saves', async () => {
  await newScarf('Status scarf');
  await tid('start-knitting').click(); await page.waitForSelector('[data-testid=knit-card]');
  await stepsDone(1);
  await waitState('saved');
  assert(/Saved on this phone/.test(await tid('save-status').innerText()), 'saved text');
  await flag('failput', '1');
  await stepsDone(2);
  await waitState('failed');
  assert(/NOT SAVED/.test(await tid('save-status').innerText()), 'failure is shown');
  const where = await card();
  await page.reload(); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === where, 'position lost after reload while writes were failing');
  await flag('failput', '0');
  await waitState('saved', 15000);
  await page.reload(); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === where, 'position lost after the write finally saved');
  const wal = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kg:wal:')));
  assert(wal.length === 0, `safety copy not cleared: ${wal}`);
  return 'failed -> shown -> replayed -> saved';
});

await test('LOAD ERROR: a library that cannot be read shows an error, never an empty library', async () => {
  await flag('faildb', '1');
  await page.reload();
  await page.waitForSelector('[data-testid=load-error]', { timeout: 10000 });
  const t = await page.locator('body').innerText();
  assert(!/No projects yet/.test(t) && !(await tid('project-card').count()), 'must not show an empty library');
  assert(/Nothing has been deleted/.test(t), 'reassuring message');
  await flag('faildb', '0');
  await tid('load-retry').click();
  await page.waitForSelector('[data-testid=load-error]', { state: 'detached', timeout: 10000 });
  await page.goto(BASE); await page.waitForSelector('[data-testid=project-card]', { timeout: 10000 });
  return 'error shown, retry loads the projects';
});

await test('RECOVERY POINTS: restore an earlier point, the current state is saved first and can be restored too', async () => {
  await newScarf('Recovery scarf');
  const id = pid();
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  await stepsDone(3);
  const early = await card();
  await page.goto(BASE); await page.waitForSelector('[data-testid=open-recovery]');
  await tid('open-recovery').click(); await tid('checkpoint-now').click(); await page.waitForTimeout(500);
  await page.getByLabel('Close').last().click();
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  await stepsDone(3);
  const late = await card();
  assert(early !== late, 'test needs different positions');
  await page.goto(BASE); await page.waitForSelector('[data-testid=open-recovery]');
  await tid('open-recovery').click(); await page.waitForSelector('[data-testid=recovery-points]');
  const row = page.locator('[data-testid=checkpoint]', { hasText: 'Recovery scarf' }).filter({ hasText: 'manual' }).first();
  await row.locator('button').first().click();
  assert(/Restoring moves you BACK/.test(await row.innerText()), `warns that it moves back: ${(await row.innerText()).replace(/\s+/g, ' ')}`);
  await row.getByText('Restore this point').click(); await row.getByText('Tap again to restore').click();
  await page.waitForTimeout(800);
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === early, 'did not return to the earlier position');
  // undo: the state before the restore was saved
  await page.goto(BASE); await page.waitForSelector('[data-testid=open-recovery]');
  await tid('open-recovery').click(); await page.waitForSelector('[data-testid=recovery-points]');
  const before = page.locator('[data-testid=checkpoint]', { hasText: 'Recovery scarf' }).filter({ hasText: 'before restore' }).first();
  await before.locator('button').first().click();
  await before.getByText('Restore this point').click(); await before.getByText('Tap again to restore').click();
  await page.waitForTimeout(800);
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === late, 'undo did not bring back the later position');
  return 'restore + undo';
});

await test('LOST LIBRARY: the main database is wiped, projects come back from recovery points', async () => {
  await page.goto(BASE); await page.waitForSelector('[data-testid=project-card]');
  const names = await page.locator('[data-testid=project-card]').allInnerTexts();
  assert(names.some((n) => /Recovery scarf/.test(n)), 'precondition');
  await page.evaluate(() => { indexedDB.deleteDatabase('knit-guide'); localStorage.removeItem('kg:test:faildb'); });
  await page.reload(); await page.waitForSelector('.hero');
  await page.waitForTimeout(800);
  assert(!(await page.locator('[data-testid=project-card]', { hasText: 'Recovery scarf' }).count()), 'library should be empty after the wipe');
  await tid('open-recovery').click(); await page.waitForSelector('[data-testid=recoverable]');
  const row = page.locator('[data-testid=recoverable] [data-testid=checkpoint]', { hasText: 'Recovery scarf' }).first();
  await row.locator('button').first().click();
  await row.getByText('Restore this point').click(); await row.getByText('Tap again to restore').click();
  await page.waitForTimeout(800);
  await page.getByLabel('Close').last().click();
  await page.locator('[data-testid=project-card]', { hasText: 'Recovery scarf' }).waitFor({ timeout: 8000 });
  return 'project recovered with its pattern';
});

await test('BACKUP FILE: not counted until checked; a damaged file is refused; restore never replaces newer progress', async () => {
  await newScarf('File scarf');
  const id = pid();
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  await stepsDone(2);
  await page.goto(BASE); await page.waitForSelector('[data-testid=backup-save]');
  const [dl] = await Promise.all([page.waitForEvent('download'), tid('backup-save').click()]);
  await dl.saveAs('/tmp/kg-saving-backup.json');
  await page.waitForSelector('[data-testid=backup-msg]');
  assert(/NOT counted as a backup/.test(await tid('backup-msg').innerText()), 'must not claim success');
  assert(/never/.test(await tid('backup-status').innerText()), 'no verified backup yet');
  writeFileSync('/tmp/kg-saving-bad.json', readFileSync('/tmp/kg-saving-backup.json', 'utf8').slice(0, 300));
  await tid('backup-check-input').setInputFiles('/tmp/kg-saving-bad.json');
  await page.waitForFunction(() => /NOT a good backup/.test(document.querySelector('[data-testid=backup-msg]')?.textContent ?? ''));
  assert(/never/.test(await tid('backup-status').innerText()), 'a damaged file must not count');
  await tid('backup-check-input').setInputFiles('/tmp/kg-saving-backup.json');
  await page.waitForFunction(() => /✓ Checked/.test(document.querySelector('[data-testid=backup-msg]')?.textContent ?? ''));
  assert(!/never/.test(await tid('backup-status').innerText().then((t) => t.split('\n')[0])), 'checked file should count');
  // more progress, then restore the older file: nothing newer is replaced
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  const newer = await (async () => { await stepsDone(2); return card(); })();
  await page.goto(BASE); await page.waitForSelector('[data-testid=backup-file-input]', { state: 'attached' });
  await tid('backup-file-input').setInputFiles('/tmp/kg-saving-backup.json');
  await page.waitForSelector('[data-testid=restore-preview]');
  const mine = page.locator('[data-testid=restore-item]', { hasText: 'File scarf' });
  assert((await mine.getAttribute('data-action')) === 'keep-phone', `expected keep-phone, got ${await mine.getAttribute('data-action')}`);
  await page.getByLabel('Close').last().click();
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === newer, 'newer progress was replaced');
  return 'verified only after checking; newer progress kept';
});

await test('RE-READ with progress: same instructions are re-read after a recovery point; changed instructions are refused', async () => {
  await newScarf('Reread scarf');
  const id = pid();
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  await stepsDone(2);
  const where = await card();
  const tamper = (mode) => page.evaluate(async ([id, mode]) => {
    const db = await new Promise((r) => { const q = indexedDB.open('knit-guide'); q.onsuccess = () => r(q.result); });
    const proj = await new Promise((r) => { const g = db.transaction('projects').objectStore('projects').get(id); g.onsuccess = () => r(g.result); });
    const pat = await new Promise((r) => { const g = db.transaction('patterns').objectStore('patterns').get(proj.patternId); g.onsuccess = () => r(g.result); });
    delete pat.readerVersion;
    if (mode === 'text') pat.instructions[1].text = 'OLD SCRAMBLED TEXT';
    if (mode === 'drop') pat.instructions.splice(2, 1);
    await new Promise((r) => { const w = db.transaction('patterns', 'readwrite').objectStore('patterns').put(pat, pat.id); w.onsuccess = () => r(); });
    return pat.instructions.length;
  }, [id, mode]);
  const reread = async () => {
    await page.goto('about:blank'); await page.goto(`${BASE}#/p/${id}`); await page.waitForSelector('[data-testid=open-instructions]');
    assert(await tid('reread-offer').count(), 'offer shown for a project in progress (no automatic re-read)');
    await page.getByText('Re-read pattern from the saved PDF').click(); await page.getByText('Tap again to re-read').click();
    await page.waitForSelector('[data-testid=reread-msg]', { timeout: 15000 });
    return (await tid('reread-msg').innerText()).replace(/\s+/g, ' ');
  };
  await tamper('text');
  const ok = await reread();
  assert(/Pattern text re-read/.test(ok), `should re-read: ${ok}`);
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === where, 'place moved after the re-read');
  await tamper('drop');
  const refused = await reread();
  assert(/Not re-read/.test(refused), `should refuse: ${refused}`);
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  assert((await card()) === where, 'place moved after a refused re-read');
  await page.goto(BASE); await page.waitForSelector('[data-testid=open-recovery]');
  await tid('open-recovery').click(); await page.waitForSelector('[data-testid=recovery-points]');
  assert(await page.locator('[data-testid=checkpoint]', { hasText: 'before re-read' }).count(), 'recovery point before the re-read');
  return 'refused when unsafe, safe re-read keeps the place';
});

await test('OFFLINE: knitting with no network is saved on the phone and survives a reload', async () => {
  await newScarf('Offline scarf');
  const id = pid();
  await page.goto(`${BASE}#/p/${id}/knit`); await page.waitForSelector('[data-testid=knit-card]');
  await page.evaluate(async () => { await navigator.serviceWorker?.ready; });
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await stepsDone(3);
  await waitState('saved');
  const where = await card();
  await page.reload(); await page.waitForSelector('[data-testid=knit-card]', { timeout: 15000 });
  assert((await card()) === where, 'offline progress lost after reload');
  await context.setOffline(false);
  return 'saved offline';
});

console.log('\nErrors:', errors.length ? errors : 'none');
writeFileSync('docs/acceptance-results-saving.json', JSON.stringify({ ran: new Date().toISOString(), results, errors }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
server.kill();
process.exit(results.every((r) => r.pass) && errors.length === 0 ? 0 : 1);
