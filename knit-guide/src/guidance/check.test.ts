import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Pattern, Project } from '../model/types';
import { finalizePattern } from '../parser/edit';
import { parsePastedText } from '../parser/parse';
import { analyzePattern, needsAttention, unsupportedKind } from './check';

const load = (n: string): Pattern => finalizePattern(parsePastedText(readFileSync(`fixtures/synthetic-${n}.txt`, 'utf8'), {}));
const proj = (p: Pattern, size: string, extra: Partial<Project> = {}): Project => ({ id: 'p', patternId: p.id, createdAt: 0, updatedAt: 0, name: 't', status: 'active', size, sizeOverrides: {}, setup: { yarn: '', colour: '', needle: '', gaugeSts: '', gaugeRows: '', bodyLength: '', sleeveLength: '' }, modifications: [], notes: [], counters: [], stitchCounters: [], trackers: {}, progress: { completed: [], expanded: [], pdfPage: 1 }, ...extra }) as Project;

describe('pattern check', () => {
  it('counts a clean synthetic pattern as fully interpreted, with nothing to approve', () => {
    for (const [n, size] of [['scarf', 'One size'], ['blanket', 'One size'], ['hat', 'Adult S'], ['raglan-sweater', 'M'], ['jacket-cm', 'One size']] as const) {
      const p = load(n);
      const c = analyzePattern(p, proj(p, size));
      expect(c.total, n).toBeGreaterThan(2);
      expect(c.items.filter(needsAttention), n).toEqual([]);
      expect(c.interpreted).toBe(c.total);
    }
  });

  it('lists only the instruction it could not read, and names the technique', () => {
    const p = finalizePattern(parsePastedText(`Test Hat\nSIZE: One size.\nNEEDLES: 4 mm.\nGAUGE: 20 stitches and 28 rows = 10 x 10 cm.\nHAT:\nCast on 80 stitches.\nKnit 4 rows.\nWork Chart A for 20 rows.\nBind off all stitches.`, {}));
    const c = analyzePattern(p, proj(p, 'One size'));
    const flagged = c.items.filter(needsAttention);
    expect(flagged.length).toBe(1);
    expect(flagged[0].ins.text).toMatch(/Chart A/);
    expect(flagged[0].unsupported).toBe('chart');
    expect(c.unsupported).toBe(1);
    expect(c.interpreted).toBe(c.total - 1);
  });

  it('a correction counts the instruction as interpreted and survives in the project', () => {
    const p = finalizePattern(parsePastedText(`Test Hat\nSIZE: One size.\nNEEDLES: 4 mm.\nGAUGE: 20 stitches and 28 rows = 10 x 10 cm.\nHAT:\nCast on 80 stitches.\nWork Chart A for 20 rows.\nBind off all stitches.`, {}));
    const base = analyzePattern(p, proj(p, 'One size'));
    const ins = base.items[0].ins;
    const fixed = analyzePattern(p, proj(p, 'One size', { knit: { stepsDone: {}, checkpoints: {}, measured: {}, measurements: {}, guidanceOverrides: { [ins.id]: { steps: ['Work chart A for 20 rows.'], at: 1 } } } }));
    expect(fixed.items.filter(needsAttention)).toEqual([]);
    expect(fixed.corrected.map((i) => i.id)).toEqual([ins.id]);
  });

  it('classifies unsupported techniques', () => {
    expect(unsupportedKind('Short row 1 (RS): k20, w&t', false)).toBe('short rows');
    expect(unsupportedKind('Work Chart B', false)).toBe('chart');
    expect(unsupportedKind('C4F over next 4 sts', false)).toBe('cables');
    expect(unsupportedKind('Knit 4 rows', false)).toBeUndefined();
  });

  const LACE = 'fixtures/raglan-lace-cardigan.pdf';
  it.skipIf(!existsSync(LACE))('local lace pattern: charts are reported as charts, not hidden', async () => {
    const { parsePdfFile } = await import('../parser/pdf-node');
    const p: any = await parsePdfFile(LACE);
    const c = analyzePattern(p, proj(p, 'M'));
    expect(c.unsupported).toBeGreaterThan(3);
  });
});
