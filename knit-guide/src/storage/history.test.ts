import { describe, expect, it } from 'vitest';
import type { Project } from '../model/types';
import { chooseKeep, createCheckpointService, DAY, hashPattern, MemoryHistory, type Checkpoint } from './history';

const cp = (id: string, at: number, reason: Checkpoint['reason'] = 'automatic'): Checkpoint => ({ id, projectId: 'p', createdAt: at, reason, rev: 1, patternHash: 'h', project: {} as Project });

describe('thinning recovery points', () => {
  const now = 100 * DAY;
  it('keeps everything from the last day and the newest 40', () => {
    const many = Array.from({ length: 60 }, (_, i) => cp(`a${i}`, now - i * 60_000));
    const keep = chooseKeep(many, now);
    expect(keep.size).toBe(60); // all within 24h
  });
  it('keeps the first of each recent day and every manual point, thins other old automatic ones', () => {
    const old = Array.from({ length: 100 }, (_, i) => cp(`o${i}`, now - 10 * DAY - i * 60_000));
    const manual = cp('m', now - 10 * DAY - 500 * 60_000, 'manual');
    const keep = chooseKeep([...old, manual], now);
    expect(keep.has('m')).toBe(true);
    expect(keep.size).toBeLessThan(101);
    expect(keep.size).toBeGreaterThanOrEqual(41 - 1); // newest 40 plus a day's first
  });
  it('never keeps nothing', () => {
    expect(chooseKeep([cp('x', 0)], now).has('x')).toBe(true);
  });
});

describe('pattern hash', () => {
  it('ignores timestamps and ids, changes with the content', () => {
    const base: any = { id: 'a', createdAt: 1, updatedAt: 2, parse: { extractedAt: 5 }, instructions: [{ text: 'x' }] };
    const same = { ...base, id: 'b', createdAt: 9, updatedAt: 9, parse: { extractedAt: 99 } };
    expect(hashPattern(same)).toBe(hashPattern(base));
    expect(hashPattern({ ...base, instructions: [{ text: 'y' }] })).not.toBe(hashPattern(base));
  });
});

describe('checkpoint service', () => {
  it('adds, respects the minimum gap and unchanged revisions', async () => {
    let t = 1_000_000;
    const svc = createCheckpointService(new MemoryHistory(), () => t);
    const pat: any = { id: 'pat', instructions: [] };
    const proj: any = { id: 'p', rev: 1 };
    expect(await svc.maybe(proj, pat, 'first', 0)).toBe(true);
    expect(await svc.maybe(proj, pat, 'automatic', 0)).toBe(false); // nothing changed
    proj.rev = 2;
    t += 1000;
    expect(await svc.maybe(proj, pat, 'automatic', 15 * 60_000)).toBe(false); // too soon
    t += 16 * 60_000;
    expect(await svc.maybe(proj, pat, 'automatic', 15 * 60_000)).toBe(true);
    expect((await svc.list('p')).length).toBe(2);
  });
  it('does not write without a pattern', async () => {
    const svc = createCheckpointService(new MemoryHistory());
    expect(await svc.add({ id: 'p' } as any, undefined, 'manual')).toBe(false);
  });
});
