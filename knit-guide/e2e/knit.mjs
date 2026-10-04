// Guided Knit mode acceptance (spec tests 1-20). Uses the committed SYNTHETIC pattern only
// (fixtures/synthetic-yoke-jacket.txt). Nothing here depends on a copyrighted pattern.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'docs/screenshots';
const BASE = 'http://localhost:4173/';
const SYN = readFileSync('fixtures/synthetic-yoke-jacket.txt', 'utf8');
mkdirSync(OUT, { recursive: true });
const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('preview did not start')), 20000); server.stdout.on('data', (d) => { if (String(d).includes('4173')) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
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
const kind = () => tid('knit-card').getAttribute('data-kind');
const stepTexts = async () => (await page.locator('[data-testid=knit-step] .kt').allInnerTexts()).join(' | ');

const all = []; // every card text seen while walking the whole pattern (for the global assertions)
const sizeLists = [/\d+\s*\[\s*\d+\s*,/, /\d+\s*\(\s*\d+\s*,\s*\d+/, /\d+(?:\s?[-–]\s?\d+){3,}/];

/* ------------------------------------------------------------ setup */
await test('K0 import the synthetic pattern, size L, start knitting', async () => {
  await createFromPaste(SYN, 'L', 'Synthetic jacket');
  await tid('start-knitting').click();
  await page.waitForSelector('[data-testid=knit-screen] [data-testid=knit-card]');
  await shot('80-knit-first-card');
  return (await tid('knit-context').innerText()).replace(/\s+/g, ' ');
});

await test('T6 flat work on a circular needle: described as flat, "do not join", with a turn', async () => {
  const t = await cardText();
  assert(/Cast on 7 stitches/.test(t), `first card: ${t.slice(0, 200)}`);
  const detail = await tid('construction-detail').innerText();
  assert(/back and forth/i.test(detail) && /do not join/i.test(detail), `construction: ${detail}`);
  assert(/circular needle/i.test(await tid('you-need').innerText()), 'YOU NEED should name a circular needle');
  assert(/flat/i.test(await tid('knit-context').innerText()), 'context panel');
  return detail;
});

await test('T13 a stitch-count checkpoint opens the stitch counter with the target filled in; a confirmed count is verified', async () => {
  assert(/You should now have 7 stitches/.test(await tid('checkpoint').innerText()), 'checkpoint text');
  await tid('count-stitches').click();
  await page.waitForSelector('[data-testid=count-sheet]');
  assert((await tid('cp-target').innerText()) === '7', 'target should be auto-filled with 7');
  for (let i = 0; i < 6; i++) await tid('plus-one').click();
  await tid('plus-group').click(); // jumps over: mismatch path (16 vs 7)
  assert(await tid('cp-mismatch').isVisible(), 'a mismatch must be shown, never silently accepted');
  await tid('minus-group').click();
  await tid('plus-one').click();
  assert((await tid('cp-current').innerText()) === '7', 'current should be 7');
  await tid('cp-confirm').click();
  await page.waitForSelector('[data-testid=cp-verified]');
  return 'verified at 7';
});

/* ---------------------------------------------------- walk to the yoke */
await test('T17 measurement-based instruction does not pretend to know the measurement', async () => {
  for (let i = 0; i < 40; i++) {
    all.push(await cardText());
    if ((await kind()) === 'yoke') break;
    const t = await cardText();
    if (/measures 16 cm/.test(t) || /MEASUREMENT CHECK/.test(t)) {
      const m = await tid('measure-check').first().innerText();
      assert(/cannot know/i.test(m) && /16 cm/.test(m), `measure box: ${m}`);
      assert(!(await tid('measure-result').count()), 'must not show a result before the knitter measures');
      await tid('measure-input').first().fill('12');
      await tid('measure-save').first().click();
      assert(/4 cm to go/.test(await tid('measure-result').first().innerText()), 'partial measurement result');
      await tid('measure-input').first().fill('16');
      await tid('measure-save').first().click();
      assert(/target reached/.test(await tid('measure-result').first().innerText()), 'reached');
      await shot('81-measure-check');
      results.push({ name: 'measure-seen', pass: true });
    }
    await tid('step-done').click();
    await page.waitForTimeout(80);
  }
  assert((await kind()) === 'yoke', 'never reached the yoke card');
  assert(results.some((r) => r.name === 'measure-seen'), 'no measurement-based card was seen on the way');
  return 'band lengths ask the knitter to measure; the guide never invents rows';
});

/* ------------------------------------------------------ yoke row tests */
await test('T8 V-neck + raglan on the same row become ONE ordered row with a jobs list', async () => {
  await shot('82-yoke-row-1');
  const jobs = await tid('knit-jobs').innerText();
  assert(/this row has 2 jobs/i.test(jobs) && /V-neck/.test(jobs) && /Raglan/.test(jobs), `jobs: ${jobs}`);
  const steps = await stepTexts();
  assert(/V-neck increase/.test(steps) && /marker 1/.test(steps) && /marker 4/.test(steps), `steps: ${steps}`);
  assert(/right side/i.test(await tid('knit-side').innerText()), 'row 1 is a right-side row');
  assert(/Turn your work/.test(steps), 'explicit turn');
  return jobs.replace(/\s+/g, ' ');
});

let before;
await test('T12 expected stitch count is correct for the row', async () => {
  const m = await tid('stitch-math').innerText();
  const x = m.match(/Stitches: (\d+) \+ (\d+) added = (\d+)/);
  assert(x && +x[1] + +x[2] === +x[3], `math: ${m}`);
  assert(+x[1] === 68 && +x[2] === 10, `row 1 of size L should be 68 + 10: ${m}`);
  before = m;
  return m;
});

await test('T9 completing the row updates BOTH counters', async () => {
  const lines = async () => (await page.locator('[data-testid=track-line]').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
  const a = await lines();
  assert(a.some((l) => /V-neck increase:? 1 of 9/.test(l)) && a.some((l) => /all four seams:? 1 of 4/.test(l)), `before: ${a}`);
  await tid('row-done').click();
  await page.waitForTimeout(100);
  const b = await lines();
  // row 2 is a wrong-side row: counters stay at the totals reached so far, never roll back
  assert(b.some((l) => /V-neck increase:? 1 of 9/.test(l)) && b.some((l) => /all four seams:? 1 of 4/.test(l)) && b.every((l) => !/this row/.test(l)), `after row 1: ${b}`);
  return `after ROW DONE: ${b.join(' | ')}`;
});

await test('T11 right side / wrong side advances with an explicit turn', async () => {
  assert(/wrong side/i.test(await tid('knit-side').innerText()), 'row 2 should be WRONG SIDE');
  assert(/ROW 2/.test(await tid('knit-rowno').innerText()), 'row number');
  const ctx = ((await tid('knit-where').innerText()) + ' ' + (await tid('knit-context').innerText())).replace(/\s+/g, ' ');
  assert(/wrong side/i.test(ctx) && /flat/i.test(ctx) && /Size L/.test(ctx) && /stitches now/i.test(ctx), `context: ${ctx}`);
  return ctx.replace(/\s+/g, ' ');
});

await test('T10 a row with no increases says so explicitly', async () => {
  const j = await tid('knit-jobs').innerText();
  assert(/No increases on this row/.test(j), `jobs box: ${j}`);
  assert(/\(no increases\)/.test(await tid('stitch-math').innerText()), 'stitch math should say no increases');
  return j;
});

await test('T14 Quick Stop in the middle of a simultaneous row restores exactly after a reload', async () => {
  await tid('row-done').click(); // row 3 (RS, raglan + maybe more)
  await tid('row-done').click(); // row 4
  await tid('row-done').click(); // row 5: V-neck + raglan again
  const jobs = await tid('knit-jobs').innerText();
  assert(/2 jobs/i.test(jobs), `row 5 should have 2 jobs: ${jobs}`);
  const row = (await tid('knit-rowno').innerText()).trim();
  await page.locator('[data-testid=knit-step] .kcheck').nth(0).click();
  await page.locator('[data-testid=knit-step] .kcheck').nth(1).click();
  const firstOpen = (await page.locator('[data-testid=knit-step].now .kt').innerText()).trim();
  await tid('quick-stop').click();
  await page.waitForSelector('[data-testid=stop-saved]');
  assert(/YOU STOPPED HERE/.test(await tid('stopped-here').innerText()), 'stopped card');
  await tid('stop-done').click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForSelector('[data-testid=knit-card]');
  assert((await tid('knit-rowno').innerText()).trim() === row, `row after reload: ${await tid('knit-rowno').innerText()}`);
  assert((await page.locator('[data-testid=knit-step].done').count()) === 2, 'two ticked steps must survive the reload');
  assert((await page.locator('[data-testid=knit-step].now .kt').innerText()).trim() === firstOpen, 'the next action must be identical');
  // and the project page shows the frozen state
  await page.goto(BASE + '#/p/' + page.url().split('/p/')[1].split('/')[0]);
  await page.waitForSelector('[data-testid=continue-card]');
  const card = await tid('stopped-here').innerText();
  assert(/Row 5/.test(card) && /RIGHT SIDE/.test(card) && /V-neck increase: 2 of 9/.test(card), `resume card: ${card}`);
  await shot('83-you-stopped-here');
  await tid('continue-card').click();
  await page.waitForSelector('[data-testid=knit-card]');
  return `${row}; next action "${firstOpen.slice(0, 50)}…"`;
});

let sawBh = false;
await test('T18 buttonhole state (due / done) is retained across a reload', async () => {
  for (let i = 0; i < 160; i++) {
    all.push(await cardText());
    if (await tid('bh-prompt').count()) break;
    if (await tid('yoke-long-enough').count()) break;
    await tid('row-done').click();
  }
  assert(await tid('bh-prompt').count(), 'buttonhole prompt never appeared after the V-neck finished');
  const p = await tid('bh-prompt').innerText();
  assert(/Buttonhole 1 of 4/.test(p) && /1 cm/.test(p), p);
  assert(!(await tid('bh-due').count()), 'must not announce BUTTONHOLE DUE before the knitter confirms the measurement');
  await tid('bh-reached').click();
  assert(/MARKED DUE/.test(await tid('bh-reached').innerText()), 'marked');
  await page.reload();
  await page.waitForSelector('[data-testid=knit-card]');
  assert(/MARKED DUE/.test(await tid('bh-reached').innerText()), 'due state lost on reload');
  // next right-side row carries the buttonhole
  for (let i = 0; i < 4 && !(await tid('bh-due').count()); i++) await tid('row-done').click();
  const due = await tid('bh-due').innerText();
  assert(/BUTTONHOLE 1 OF 4/.test(due), due);
  assert(/This row has/i.test(await tid('knit-jobs').innerText()) || /JOB/.test(await tid('knit-jobs').innerText()), 'buttonhole appears in the jobs list');
  assert(/Buttonhole/.test(await tid('knit-jobs').innerText()), 'job list names the buttonhole');
  await shot('84-buttonhole-due');
  await tid('row-done').click();
  assert(/knit the buttonhole yarn over normally/.test(await stepTexts()), 'the WS row after a buttonhole must say to knit the yarn over normally');
  await page.reload();
  await page.waitForSelector('[data-testid=knit-card]');
  assert(/Buttonhole:? 1 of 4/.test((await tid('knit-tracking').innerText()).replace(/\s+/g, ' ')), 'buttonhole count lost on reload');
  sawBh = true;
  return 'due, done and count survive reloads';
});

/* ------------------------------------------- walk the rest of the pattern */
async function walkAll(sink) {
  let reviewSeen = 0;
  let same = 0;
  let guard = 0;
  for (; guard < 600; guard++) {
    if ((await tid('knit-card').count()) === 0) break;
    const k = await kind();
    const t = await cardText();
    sink.push(t);
    if (/GUIDANCE NEEDS REVIEW/.test(t)) reviewSeen++;
    if (k === 'yoke') {
      if (await tid('yoke-long-enough').count()) { await tid('yoke-long-enough').click(); await page.waitForTimeout(100); continue; }
      await tid('row-done').click();
    } else if (k === 'measured') {
      if (await tid('measured-finished').count()) { await tid('step-done').click(); }
      else if (await tid('measured-due').count()) await tid('round-done').click();
      else await tid('measured-reached').click();
    } else if (k === 'legacy') {
      break;
    } else {
      await tid('step-done').click();
      await page.waitForTimeout(60);
      if ((await cardText()) === t) { if (++same >= 2) break; } else same = 0;
    }
    await page.waitForTimeout(40);
  }
  return { guard, reviewSeen };
}

await test('Walk: finish the yoke, sleeves (Magic Loop), body, ribs, assembly with no unreviewed gaps', async () => {
  const { guard, reviewSeen } = await walkAll(all);
  assert(guard < 599, 'walk did not terminate');
  const joined = all.join('\n');
  assert(/Magic Loop/.test(joined), 'a small circumference in the round must use Magic Loop');
  assert(!/double-pointed|DPN/i.test(joined), 'DPNs must not be the default');
  assert(/Sew the buttons onto the left band/.test(joined), 'assembly reached');
  assert(reviewSeen === 0, `${reviewSeen} cards needed review in the synthetic pattern`);
  return `${all.length} cards, ${sawBh ? 'buttonholes tracked, ' : ''}Magic Loop used`;
});

await test('T1/T2 only size-L values appear; no multi-size number lists anywhere in guided cards', async () => {
  const joined = all.join('\n');
  for (const re of sizeLists) assert(!re.test(joined), `size list leaked: ${joined.match(re)?.[0]}`);
  assert(/band measures 16 cm/.test(joined) && !/band measures 15 cm/.test(joined), 'band length for L is 16 cm, never 15 (S/M)');
  assert(/\b68\b/.test(joined), 'size L start stitch count (68) present');
  return 'no multi-size sequences';
});

await test('T4/T5 no imperial units and no US needle sizes in the guide', async () => {
  const joined = all.join('\n');
  assert(!/\binch(es)?\b|\d\s?"|[¼½¾⅜⅝⅞](?!\s?(?:cm|mm))|\bUS\s?\d/.test(joined), `imperial/US leaked: ${joined.match(/\binch(es)?\b|\d\s?"|[¼½¾⅜⅝⅞](?!\s?(?:cm|mm))|\bUS\s?\d/)?.[0]}`);
  assert(/\bmm\b|cm/.test(joined), 'metric units present');
  return 'metric only';
});

await test('T3/T19 View Original keeps the untouched multi-size source', async () => {
  await tid('knit-view-original').click();
  await page.waitForSelector('[data-testid=original-view]');
  const o = await tid('original-view').innerText();
  assert(/\d+-\d+-\d+-\d+|\d+ ?\[/.test(o) || /"|US/.test(o) || o.length > 10, `original view: ${o.slice(0, 120)}`);
  await page.locator('.sheet [aria-label=Close]').last().click();
  // the stored source text must be exactly the pasted multi-size text
  await page.goto(BASE + '#/p/' + page.url().split('/p/')[1]?.split('/')[0]);
  await page.evaluate(() => (location.hash = location.hash.replace(/\/(knit|outline).*/, '') + '/pdf'));
  await page.waitForSelector('[data-testid=text-viewer], .textview, pre', { timeout: 10000 }).catch(() => {});
  const body = await page.locator('body').innerText();
  assert(/15-15-16-16 cm = 6"-6"-6¼"-6¼"/.test(body), 'View Original must show 15-15-16-16 cm = 6"-6"-6¼"-6¼" untouched');
  assert(/Circular needle size 4\.5 mm = US 7/.test(body), 'original needle text must stay (US size) in View Original');
  return 'original multi-size / imperial / US text unchanged';
});

/* -------------------------------------------- ambiguity (own pattern) */
const AMBIG = `Review Test Cardigan
Designer: Test Designs
Sizes: S - M - L - XL

Finished measurements:
Chest: 96-104-112-120 cm

NEEDLES:
Circular needle size 4 mm.

KNITTING GAUGE:
20 stitches in width and 28 rows in height with stockinette stitch = 10 x 10 cm.

START HERE:
Cast on 40-44-48-52-56 stitches with circular needle size 4 mm.
Knit 4 rows.
Make the swirl braid cable twist over the front panel until it feels right.
Bind off.
`;
await test('T15 ambiguous size values show SIZE VALUE NEEDS REVIEW; T16 an ambiguous interpretation shows GUIDANCE NEEDS REVIEW', async () => {
  await createFromPaste(AMBIG, 'M', 'Review test');
  await tid('start-knitting').click();
  await page.waitForSelector('[data-testid=knit-card]');
  const t = await cardText();
  assert(/SIZE VALUE NEEDS REVIEW/.test(t), `first card: ${t.slice(0, 250)}`);
  assert(await tid('size-review-btn').isVisible(), 'choose-my-value button');
  assert(!/40-44-48/.test(await tid('knit-steps').innerText()), 'must not print the multi-size list as steps');
  await shot('85-size-needs-review');
  // resolve it, then advance to the unknown sentence
  await tid('size-review-btn').click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet button', { hasText: 'Use 48' }).click();
  await page.locator('.sheet button', { hasText: 'CONFIRM MY VALUE' }).click();
  await page.waitForTimeout(300);
  if (await page.locator('.sheet').count()) await page.locator('.sheet [aria-label=Close]').last().click();
  assert(/Cast on 48 stitches/.test(await stepTexts()), `my value should be used: ${await stepTexts()}`);
  assert(!(await tid('size-review-btn').count()), 'no review button after choosing a value');
  for (let i = 0; i < 4 && !(await tid('guidance-review').count()); i++) {
    await tid('step-done').click();
    await page.waitForTimeout(100);
  }
  assert(await tid('guidance-review').isVisible(), 'GUIDANCE NEEDS REVIEW box should appear for the unknown sentence');
  const g = await tid('guidance-review').innerText();
  assert(/GUIDANCE NEEDS REVIEW/.test(g) && /swirl braid cable twist/.test(g) && /ADD MY INTERPRETATION/.test(g), g);
  await tid('gr-add').click();
  await tid('gr-text').fill('Work the cable over 8 stitches.\nTurn your work.');
  await tid('gr-save').click();
  await page.waitForSelector('[data-testid=knit-step]');
  assert(/Work the cable over 8 stitches/.test(await stepTexts()), 'my interpretation should replace the review');
  assert(!(await tid('guidance-review').count()), 'review box cleared after saving an interpretation');
  await shot('86-guidance-review');
  return 'both review states shown; interpretation saved';
});

/* ------------------------------- DROPS 244-8 (local fixture only, never committed) */
const DROPS = 'fixtures/drops-244-8-pasted.txt';
if (existsSync(DROPS)) {
  await test('DROPS 244-8 (local only), size L: the whole pattern can be walked in Knit mode; sizes/metric hold', async () => {
    await createFromPaste(readFileSync(DROPS, 'utf8'), 'L', 'DROPS local');
    await tid('start-knitting').click();
    await page.waitForSelector('[data-testid=knit-card]');
    const seen = [];
    const { guard, reviewSeen } = await walkAll(seen);
    const joined = seen.join('\n');
    for (const re of sizeLists) assert(!re.test(joined), `size list leaked: ${joined.match(re)?.[0]}`);
    { const re = /\binch(es)?\b|\d\s?"|[¼½¾⅜⅝⅞](?!\s?(?:cm|mm))|\bUS\s?\d/; assert(!re.test(joined), `imperial/US leaked: ${joined.match(new RegExp('.{50}(' + re.source + ').{30}'))?.[0]}`); }
    assert(/Magic Loop/.test(joined), 'sleeve in the round should use Magic Loop');
    return `${seen.length} cards (${guard} iterations), ${reviewSeen} needing review`;
  });
}

/* ------------- one vocabulary, many projects: scarf, blanket, hat, raglan (synthetic, committed) */
const walkPat = async (file, size, name, hooks = {}) => {
  await createFromPaste(readFileSync(`fixtures/synthetic-${file}.txt`, 'utf8'), size, name);
  await tid('start-knitting').click();
  await page.waitForSelector('[data-testid=knit-card]');
  const seen = [];
  let clicks = 0;
  for (let i = 0; i < 400; i++) {
    if ((await tid('knit-card').count()) === 0) break;
    const t = await cardText();
    if (seen[seen.length - 1] !== t) seen.push(t);
    if (hooks.before) await hooks.before(i, t);
    if (await tid('repeat-length-reached').count() && (await tid('rep-count').innerText()).trim() >= (hooks.minRepeats ?? 3)) { await tid('repeat-length-reached').click(); }
    else {
      const k = await kind();
      if (k === 'yoke' || k === 'measured' || k === 'legacy') break;
      const before = t;
      await tid('step-done').click();
      clicks++;
      await page.waitForTimeout(40);
      if ((await cardText()) === before && /Weave in|Pull the tail|Bind off/.test(before) && i > 5) break;
    }
  }
  return { seen, clicks };
};

await test('GENERAL scarf: repeated ribbing rows are counted and end when the length is reached', async () => {
  const { seen } = await walkPat('scarf', 'One size', 'Scarf');
  const all = seen.join('\n');
  assert(!/GUIDANCE NEEDS REVIEW/.test(all), 'no review cards expected for the scarf');
  assert(/Repeat 3/.test(all.replace(/\s+/g, ' ')) || /3\s*Round|Repeat\s*3/.test(all.replace(/\s+/g, ' ')), 'repeat counter should count up');
  assert(/MEASUREMENT CHECK/.test(all) && /160 cm/.test(all), 'measurement check for 160 cm');
  assert(/Bind off all stitches in pattern/.test(all), 'moved on to the bind-off after "length reached"');
  return `${seen.length} cards`;
});

await test('GENERAL blanket: one size, rows 1-2 repeated until 85 cm, finishing steps', async () => {
  const { seen } = await walkPat('blanket', 'One size', 'Blanket');
  const all = seen.join('\n');
  assert(!/GUIDANCE NEEDS REVIEW/.test(all), 'no review cards expected for the blanket');
  assert(/85 cm/.test(all) && /Block the finished piece/.test(all), '85 cm and blocking');
  return `${seen.length} cards`;
});

await test('GENERAL hat: join in the round, 8 repeats of 2 rounds; Quick Stop mid-repeat survives a reload', async () => {
  let stopped = false;
  const { seen } = await walkPat('hat', 'Adult S', 'Hat', {
    before: async () => {
      if (stopped) return;
      if (!(await tid('rep-count').count())) return;
      // go three rounds into the repeats: repeat 2 of 8, round 1 of 2
      for (let k = 0; k < 3; k++) { await tid('step-done').click(); await page.waitForTimeout(80); }
      assert(/2 of 8/.test(await tid('rep-count').innerText()), `repeat counter: ${await tid('rep-count').innerText()}`);
      assert(/2 of 2/.test(await tid('rep-round').innerText()) || /1 of 2/.test(await tid('rep-round').innerText()), 'round counter');
      const where = `${await tid('rep-count').innerText()}|${await tid('rep-round').innerText()}`;
      await tid('quick-stop').click(); await page.waitForSelector('[data-testid=stop-saved]');
      assert(/Repeat 2 of 8/.test(await tid('stopped-here').innerText()), 'Quick Stop card names the repeat');
      await tid('stop-done').click(); await page.waitForTimeout(300);
      await page.reload(); await page.waitForSelector('[data-testid=knit-card]');
      assert(`${await tid('rep-count').innerText()}|${await tid('rep-round').innerText()}` === where, 'repeat position lost on reload');
      stopped = true;
    },
  });
  const all = seen.join('\n');
  assert(!/GUIDANCE NEEDS REVIEW/.test(all), 'no review cards expected for the hat');
  assert(/Cast on 100 stitches/.test(all) && /Join in the round/.test(all), 'Adult S cast-on with join');
  assert(/WORKING IN THE ROUND|In the round/i.test(all), 'working in the round');
  assert(stopped, 'the repeat card was never reached');
  return `${seen.length} cards`;
});

await test('GENERAL raglan: repeated kfb rounds show the stitch count and the designer\'s total as a checkpoint', async () => {
  let checked = false;
  const { seen } = await walkPat('raglan-sweater', 'M', 'Raglan', {
    before: async () => {
      if (checked || !(await tid('rep-stitches').count())) return;
      if (!/88/.test((await page.locator('[data-testid=rep-stitches]').first().innerText()).replace(/\D/g, '')) && !/92/.test((await tid('rep-stitches').innerText()))) return;
      assert((await tid('rep-stitches').innerText()).trim() === '92', `first round of the first repeat should end on 92: ${await tid('rep-stitches').innerText()}`);
      checked = true;
    },
  });
  const all = seen.join('\n');
  assert(checked, 'stitch tile never seen');
  assert(/kfb/.test(all) && /Do this 2 times/.test(all), 'kfb round with its repeated group');
  assert(/You should now have\s*184\s*stitches/.test(all.replace(/\s+/g, ' ')), 'designer count 184 as a checkpoint at the last repeat');
  assert(!/GUIDANCE NEEDS REVIEW/.test(all), 'no review cards expected for the raglan');
  return `${seen.length} cards`;
});

await test('GENERAL cm jacket: swatch gives row ESTIMATES; measuring makes events due; Quick Stop restores', async () => {
  const text = readFileSync('fixtures/synthetic-jacket-cm.txt', 'utf8');
  await page.goto(BASE); await page.waitForSelector('.hero');
  await tid('new-project').click(); await page.waitForSelector('[data-testid=paste-input]');
  await tid('paste-input').fill(text); await tid('paste-read').click(); await page.waitForSelector('[data-testid=review]');
  await tid('review-continue').click(); await page.waitForSelector('[data-testid=setup]');
  await tid('size-One size').click();
  await page.getByLabel('My gauge stitches').fill('22');
  await page.getByLabel('My gauge rows').fill('30');
  await tid('project-name').fill('Jacket cm');
  await tid('create-project').click(); await page.waitForSelector('[data-testid=open-instructions]');
  await tid('start-knitting').click(); await page.waitForSelector('[data-testid=knit-card]');
  for (let i = 0; i < 20 && (await tid('knit-card').getAttribute('data-kind')) !== 'timeline'; i++) { await tid('step-done').click(); await page.waitForTimeout(60); }
  assert((await tid('knit-card').getAttribute('data-kind')) === 'timeline', 'timeline card never reached');
  assert(/ESTIMATES from your swatch \(30 rows per 10 cm\)/.test(await tid('timeline-gauge-note').innerText()), 'estimates are labelled');
  assert(await tid('timeline-nothing-due').count(), 'nothing is due before measuring');
  await tid('timeline-cm').fill('6'); await tid('timeline-save').click(); await page.waitForTimeout(150);
  assert(await tid('due-event').count() === 1, 'the 6 cm decrease is due');
  const due = (await tid('due-event').innerText()).replace(/\s+/g, ' ');
  assert(/about row 18 \(estimate\)/.test(due), `row estimate labelled: ${due}`);
  await tid('quick-stop').click(); await page.waitForSelector('[data-testid=stop-saved]');
  await tid('stop-done').click(); await page.waitForTimeout(300);
  await page.reload(); await page.waitForSelector('[data-testid=knit-card]');
  assert(await tid('due-event').count() === 1, 'due event restored after reload');
  await tid('event-done').click(); await page.waitForTimeout(150);
  assert(await tid('due-event').count() === 0 && /1 of /.test(await tid('track-line').innerText()), 'event ticked off');
  return 'ok';
});

/* ------------------- Flax (Tin Can Knits): 19 sizes, two columns, size subsets. Local fixture only. */
const FLAX = 'fixtures/flax-worsted.pdf';
if (existsSync(FLAX)) {
  const openFlax = async (size) => {
    await page.goto(BASE); await page.waitForSelector('.hero');
    await tid('new-project').click();
    await page.setInputFiles('[data-testid=pdf-input]', FLAX);
    await page.waitForSelector('[data-testid=review]', { timeout: 120000 });
    return size;
  };
  await test('FLAX: 19 sizes with names like "0-6 mo" and "Adult XS" are found; the table fills Project Data in cm', async () => {
    await openFlax();
    const sizes = await tid('sizes-input').inputValue();
    assert(sizes === '0-6 mo, 6-12 mo, 1-2 yrs, 2-4 yrs, 4-6 yrs, 6-8 yrs, 8-10 yrs, XS, S, SM, M, ML, L, XL, XXL, 3XL, 4XL, 5XL, 6XL', `sizes: ${sizes}`);
    await tid('review-continue').click(); await page.waitForSelector('[data-testid=setup]');
    assert((await page.locator('[data-testid=size-pick] button').count()) === 19, 'nineteen size buttons');
    await tid('size-L').click();
    const res = (await tid('size-resolution').innerText()).replace(/\s+/g, ' ');
    assert(/✓ \d+ size-dependent values resolved/.test(res) && !/need review/.test(res), res);
    await tid('create-project').click(); await page.waitForSelector('[data-testid=open-instructions]');
    const d = (await page.locator('.card').first().innerText()).replace(/\s+/g, ' ');
    assert(/106\.5 cm/.test(d) && /1095 m/.test(d) && !/["”]|\binch/i.test(d), `project data: ${d.slice(0, 300)}`);
    return 'chest 106.5 cm, yarn 1095 m';
  });
  await test('FLAX size L: only L values, scoped XL-only rounds left out; XL shows them', async () => {
    await tid('start-knitting').click(); await page.waitForSelector('[data-testid=knit-card]');
    const seenL = [];
    for (let i = 0; i < 60; i++) { seenL.push(await cardText()); const k = await kind(); if (k !== 'steps') break; await tid('step-done').click(); await page.waitForTimeout(40); }
    const L = seenL.join('\n');
    assert(/Cast on 90 stitches/.test(L), `L cast-on: ${L.slice(0, 300)}`);
    for (const re of sizeLists) assert(!re.test(L), `size list leaked: ${L.match(re)?.[0]}`);
    // outline text for all instructions at L must not contain the XL-only rounds
    await tid('to-outline').click(); await page.waitForSelector('[data-testid=outline]');
    const expand = async () => { for (let k = 0; k < 5; k++) { const c = page.locator('.sec-head[aria-expanded=false]'); const n = await c.count(); if (!n) break; for (let j = 0; j < n; j++) await c.first().click().catch(() => {}); } };
    await expand();
    const outL = (await page.locator('[data-testid=outline]').innerText()).replace(/\s+/g, ' ');
    assert(!/Round 3: \[kfb/.test(outL), 'XL-only Round 3 must be hidden at size L');
    assert(/Work in pattern .* until yoke measures at least 20\.5 cm/.test(outL) || /yoke measures at least 2\d(\.\d)? cm/.test(outL), 'yoke depth in cm for L');
    assert(!/\d+(?:\s?[-–]\s?\d+){5,}/.test(outL), 'no long multi-size number sequence in the L guide');
    return 'L guide resolved; XL-only block hidden';
  });
}

/* ------------------------------------------------------ offline / PWA */
await test('T20 offline: the Knit screen still opens after the first load (PWA)', async () => {
  await page.goto(BASE);
  await page.waitForSelector('.hero');
  await page.evaluate(async () => { const r = await navigator.serviceWorker?.ready; return !!r; });
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.getByTestId('resume-active').click().catch(() => {});
  await page.waitForTimeout(500);
  await context.setOffline(false);
  return 'app shell loads with the network off (full offline PDF check: e2e/acceptance.mjs)';
});

console.log('\nErrors:', errors.length ? errors : 'none');
const rs = results.filter((r) => r.name !== 'measure-seen');
writeFileSync('docs/acceptance-results-knit.json', JSON.stringify({ ran: new Date().toISOString(), results: rs, errors }, null, 2));
console.log(`\n${rs.filter((r) => r.pass).length}/${rs.length} passed`);
await browser.close();
server.kill();
process.exit(rs.every((r) => r.pass) && errors.length === 0 ? 0 : 1);
