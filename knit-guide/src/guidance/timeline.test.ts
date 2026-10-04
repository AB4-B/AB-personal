/** Measurement-based shaping and gauge estimates, on a synthetic pattern written in centimetres. */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finalizePattern } from '../parser/edit';
import { parsePastedText } from '../parser/parse';
import type { Project } from '../model/types';
import { cmFor, rowsFor, spacingRows, gaugeCheck } from '../model/gauge';
import { buildModel } from './flow';
import { buildTimeline, stitchesAfter } from './timeline';

const pattern = () => finalizePattern(parsePastedText(readFileSync('fixtures/synthetic-jacket-cm.txt', 'utf8'), {}));
const project = (p: ReturnType<typeof pattern>, setup: Partial<Project['setup']> = {}) =>
  ({ id: 'p', patternId: p.id, createdAt: 0, updatedAt: 0, name: 't', status: 'active', size: '', setup: { yarn: '', colour: '', needle: '', gaugeSts: '', gaugeRows: '', bodyLength: '', sleeveLength: '', ...setup }, modifications: [], notes: [], counters: [], stitchCounters: [], trackers: {}, progress: { completed: [], expanded: [], pdfPage: 1 } }) as unknown as Project;

describe('gauge helpers (estimates only)', () => {
  it('rows and lengths from the row gauge', () => {
    expect(rowsFor(20, 30)).toBe(60);
    expect(cmFor(60, 30)).toBe(20);
    expect(rowsFor(20, undefined)).toBeUndefined();
  });
  it('spacing: whole rows or an alternating pattern', () => {
    expect(spacingRows(2, 30)).toBe('every 6 rows');
    expect(spacingRows(1.5, 30)).toMatch(/alternate 4 and 5/);
    expect(spacingRows(2, undefined)).toBeUndefined();
  });
  it('gauge check compares the swatch with the pattern', () => {
    const p = pattern();
    expect(gaugeCheck(p, project(p)).level).toBe('none');
    expect(gaugeCheck(p, project(p, { gaugeSts: '22', gaugeRows: '30' })).level).toBe('ok');
    expect(gaugeCheck(p, project(p, { gaugeSts: '18', gaugeRows: '30' })).level).toBe('warn');
  });
});

describe('timeline from lengths', () => {
  it('turns "repeat on every Y cm a total of T times" into T dated events', () => {
    const t = buildTimeline([{ id: 'a', text: 'When piece measures 6 cm dec 1 st each side and repeat the dec on every 4 cm a total of 3 times = 114 sts.' }], 120)!;
    expect(t.events.map((e) => e.cm)).toEqual([6, 10, 14]);
    expect(stitchesAfter(t, t.events.map((e) => e.id))).toBe(114);
  });
  it('merges AT THE SAME TIME rules in length order', () => {
    const t = buildTimeline(
      [
        { id: 'a', text: 'When piece measures 6 cm dec 1 st each side and repeat the dec on every 4 cm a total of 3 times.' },
        { id: 'b', text: 'AT THE SAME TIME when piece measures 8 cm inc 1 st each side and repeat the inc on every 3 cm a total of 2 times.' },
      ],
      120,
    )!;
    expect(t.events.map((e) => e.cm)).toEqual([6, 8, 10, 11, 14]);
    expect(t.usedIds).toEqual(['a', 'b']);
  });
  it('the guide shows one timeline for the body with no review cards', () => {
    const p = pattern();
    const m = buildModel(p, project(p));
    const tl = m.list.filter((g) => g.kind === 'timeline');
    expect(tl.length).toBe(1);
    expect(tl[0].timeline!.start).toBe(120);
    expect(tl[0].review).toBe(false);
    expect(m.list.filter((g) => g.review).length).toBe(0);
  });
});

describe('Sand Ripples (local fixture only, size M)', () => {
  const f = 'fixtures/drops-no-nonsense-cardigan.pdf';
  it.skipIf(!existsSync(f))('one merged body timeline with shaping, neckline, armhole and buttonholes', async () => {
    const { parsePdfFile } = await import('../parser/pdf-node');
    const p: any = await parsePdfFile(f);
    const m = buildModel(p, { ...project(p), size: 'M' });
    const body = m.list.find((g) => g.kind === 'timeline' && g.title === 'BODY PIECE')!;
    const ev = body.timeline!.events;
    expect(m.list.filter((g) => g.kind === 'timeline' && g.title === 'BODY PIECE').length).toBe(1);
    expect(ev.filter((e) => e.label === 'Decrease' && e.cm >= 9 && e.cm <= 18).length).toBe(7);
    expect(ev.filter((e) => e.label === 'Increase').length).toBe(5);
    expect(ev.filter((e) => e.label === 'Buttonhole').map((e) => e.cm)).toEqual([10, 18, 26, 34]);
    expect(ev.filter((e) => e.label === 'Neckline').length).toBe(21);
    expect(ev.some((e) => e.label === 'Bind off' && e.cm === 40)).toBe(true);
    expect(body.review).toBe(false);
  });
});
