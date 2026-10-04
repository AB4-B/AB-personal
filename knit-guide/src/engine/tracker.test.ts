import { describe, expect, it } from 'vitest';
import { describeRow, eventsDone } from './tracker';
import type { StitchPattern, TrackerSpec } from '../model/types';

const lace: StitchPattern = {
  id: 'sp1', name: 'Lace', unit: 'row', length: 4, page: 1,
  rows: [{ n: 1, text: 'k2, yo, ssk' }, { n: 2, text: 'purl' }, { n: 3, text: 'k2, k2tog, yo' }, { n: 4, text: 'purl' }],
};
const spec: TrackerSpec = {
  id: 't', title: 'T', unit: 'row', sectionId: 's', firstRow: 1,
  lace: { stitchPatternId: 'sp1', offset: 0 },
  parity: { evenSide: 'WS', text: 'Row 2 and all even rows (WS): sl1, purl to end.', sourceInstructionId: 'i1' },
  spans: [
    { id: 'a', name: 'Back Chart', rows: ['44', '50', '52', '58', '64', '66'], sourceInstructionId: 'i2', stopsAfter: false },
    { id: 'b', name: 'Sleeve Chart', rows: ['32', '34', '40', '46', '48', '50'], sourceInstructionId: 'i3', stopsAfter: true },
  ],
  spanLabel: 'Raglan increases',
  intervals: [{ id: 'v', label: 'V-neck shaping', every: 4, times: ['11', '11', '13', '13', '12', '14'], first: 1, firstAssumed: true, excerpt: 'orig', sourceInstructionId: 'i4' }],
  endRows: ['44', '50', '52', '58', '64', '66'], sourceInstructionIds: [], review: [],
};
const ctx = (sizeIndex = 0, firstOverrides = {}) => ({ sizeIndex, sizeCount: 6, state: { firstOverrides }, stitchPatterns: [lace] });

describe('simultaneous tracker', () => {
  it('row 17 (S): lace row 1, raglan increase, V-neck increase', () => {
    const r = describeRow(spec, 17, ctx());
    expect(r.side).toBe('RS');
    expect(r.lace?.n).toBe(1);
    expect(r.shaping.find((s) => s.id === 'spans')?.status).toBe('do');
    expect(r.shaping.find((s) => s.id === 'v')?.status).toBe('do');
    expect(r.shaping.find((s) => s.id === 'v')?.progress).toEqual({ done: 4, total: 11 });
  });
  it('row 18 (S): lace row 2, WS, nothing to increase', () => {
    const r = describeRow(spec, 18, ctx());
    expect(r.side).toBe('WS');
    expect(r.lace?.n).toBe(2);
    expect(r.shaping.find((s) => s.id === 'spans')?.status).toBe('none');
    expect(r.shaping.find((s) => s.id === 'v')?.status).toBe('none');
    expect(r.plain?.text).toContain('sl1, purl to end');
  });
  it('sleeve chart finishes at row 32 but back chart continues', () => {
    const r = describeRow(spec, 35, ctx());
    const parts = r.shaping.find((s) => s.id === 'spans')!.parts!;
    expect(parts.find((p) => p.name === 'Sleeve')?.active).toBe(false);
    expect(parts.find((p) => p.name === 'Back')?.active).toBe(true);
  });
  it('V-neck is complete after N times and lace keeps cycling', () => {
    const r = describeRow(spec, 45, ctx()); // beyond 11 events for S
    expect(r.shaping.find((s) => s.id === 'v')?.status).toBe('finished');
    expect(r.lace?.n).toBe(1);
  });
  it('user can move the first V-neck row', () => {
    expect(describeRow(spec, 17, ctx(0, { v: 3 })).shaping.find((s) => s.id === 'v')?.status).toBe('none');
    expect(describeRow(spec, 19, ctx(0, { v: 3 })).shaping.find((s) => s.id === 'v')?.status).toBe('do');
  });
  it('lace row stays in step with garment row over 100 rows', () => {
    for (let row = 1; row <= 100; row++) expect(describeRow(spec, row, ctx()).lace!.n).toBe(((row - 1) % 4) + 1);
  });
  it('flags NEEDS REVIEW when size-count does not match', () => {
    const bad = { ...spec, intervals: [{ ...spec.intervals[0], times: ['2', '2', '2', '3', '3', '3', '4'] }] };
    expect(describeRow(bad, 1, ctx()).shaping.find((s) => s.id === 'v')?.status).toBe('review');
  });
  it('eventsDone counts events inclusively', () => {
    expect(eventsDone(4, 1, 1)).toBe(1);
    expect(eventsDone(4, 1, 4)).toBe(1);
    expect(eventsDone(4, 1, 5)).toBe(2);
    expect(eventsDone(4, 1, 100, 11)).toBe(11);
  });
});
