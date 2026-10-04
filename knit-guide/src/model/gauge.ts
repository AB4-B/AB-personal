/**
 * Gauge in centimetres only: stitches and rows over 10 cm. The knitter's swatch values (project.setup) are
 * the ones used for ESTIMATES; the pattern's own gauge is used only to compare. An estimate never replaces
 * measuring the piece, and the app says so wherever it shows one.
 */
import type { Pattern, Project } from './types';

export interface Gauge10 {
  sts?: number;
  rows?: number;
}

const num = (s: string | undefined) => {
  const n = Number(String(s ?? '').replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const myGauge = (project: Pick<Project, 'setup'>): Gauge10 => ({ sts: num(project.setup.gaugeSts), rows: num(project.setup.gaugeRows) });

/** The pattern's gauge over 10 cm (converted when it is printed over 4 inches). */
export function patternGauge(p: Pick<Pattern, 'gauge'>): Gauge10 {
  const g = p.gauge;
  if (!g?.stitches || !g.rows) return {};
  const inCm = /\b10\s*[x×]\s*10\s*cm|\b10\s*cm/i.test(g.raw);
  const f = inCm ? 1 : 10 / ((g.overInches ?? 4) * 2.54);
  const r = (x: number) => Math.round(x * f * 2) / 2;
  return { sts: r(g.stitches), rows: r(g.rows) };
}

/** Rows (or rounds) for a length at the given row gauge. Whole rows. */
export const rowsFor = (cm: number, rows10: number | undefined) => (rows10 ? Math.round((cm * rows10) / 10) : undefined);
export const cmFor = (rows: number, rows10: number | undefined) => (rows10 ? Math.round(((rows * 10) / rows10) * 10) / 10 : undefined);

/** "every 1.5 cm" at 30 rows / 10 cm is every 4.5 rows: alternate 4 and 5. */
export function spacingRows(everyCm: number, rows10: number | undefined): string | undefined {
  if (!rows10) return undefined;
  const exact = (everyCm * rows10) / 10;
  const lo = Math.floor(exact);
  if (Math.abs(exact - lo) < 0.15 || lo === 0) return `every ${Math.max(1, Math.round(exact))} rows`;
  if (exact - lo > 0.85) return `every ${lo + 1} rows`;
  return `every ${exact.toFixed(1)} rows (alternate ${lo} and ${lo + 1})`;
}

export interface GaugeCheck {
  level: 'ok' | 'warn' | 'none';
  lines: string[];
}

/** Compare the swatch with the pattern. A difference of 4% or more changes the finished size. */
export function gaugeCheck(p: Pattern, project: Project): GaugeCheck {
  const mine = myGauge(project);
  const pat = patternGauge(p);
  if (!mine.sts && !mine.rows) return { level: 'none', lines: ['Enter your swatch (stitches and rows over 10 cm) in Edit details to get row estimates.'] };
  const lines: string[] = [];
  let warn = false;
  const cmp = (label: string, m?: number, q?: number) => {
    if (!m || !q) return;
    const pct = ((m - q) / q) * 100;
    if (Math.abs(pct) >= 4) {
      warn = true;
      lines.push(
        `${label}: you have ${m}, the pattern has ${q} over 10 cm (${pct > 0 ? 'tighter' : 'looser'} by ${Math.abs(Math.round(pct))}%). ${
          label === 'Stitches'
            ? `Your piece will come out about ${Math.abs(Math.round(pct))}% ${pct > 0 ? 'narrower' : 'wider'} than the pattern unless you change needle size${pct > 0 ? ' (try one size larger)' : ' (try one size smaller)'}.`
            : 'Lengths will be off the same way: measure the piece rather than counting rows.'
        }`,
      );
    }
  };
  cmp('Stitches', mine.sts, pat.sts);
  cmp('Rows', mine.rows, pat.rows);
  if (!warn) lines.push('Your swatch matches the pattern gauge closely.');
  return { level: warn ? 'warn' : 'ok', lines };
}
