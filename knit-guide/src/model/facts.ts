/** PROJECT DATA for one selected size, metric only. No "110 cm / 44 inches" clutter. */
import { findSizeGroups } from './size';
import { disagrees, fmt, inchesToCm, parseNumF, toMetric } from './units';
import type { Pattern } from './types';

export interface Facts {
  size: string;
  measurements: { label: string; value: string; flag?: string }[];
  needles?: string;
  gauge?: string;
  yarn?: string;
  /** MEASUREMENT NEEDS REVIEW reasons */
  flags: string[];
}

export function needlesMm(raw: string): string | undefined {
  const t = toMetric(raw).text;
  const mm = [...t.matchAll(/(\d+(?:\.\d+)?)\s?mm\b/g)].map((m) => fmt(Number(m[1])));
  const uniq = [...new Set(mm)];
  return uniq.length ? uniq.map((x) => `${x} mm`).join(', ') : undefined;
}

export function gaugeMetric(p: Pattern): string | undefined {
  const g = p.gauge;
  if (!g.stitches || !g.rows) return g.raw ? toMetric(g.raw).text : undefined;
  const cm = /\b10\s*[x×]\s*10\s*cm/i.test(g.raw) ? 10 : Math.round(((g.overInches ?? 4) * 2.54) / 5) * 5 || 10;
  return `${fmt(g.stitches)} sts × ${fmt(g.rows)} rows = ${cm} × ${cm} cm`;
}

export function yarnRequirement(p: Pattern, sizeIdx: number): string | undefined {
  const desc = p.yarn.description;
  if (!desc || sizeIdx < 0) return undefined;
  const metric = toMetric(desc).text;
  const mPer = metric.match(/(\d+(?:\.\d+)?)\s?m\s*\/\s*\d+\s?g\b/);
  const groups = findSizeGroups(desc, p.sizes.length).filter((g) => g.matchesSizes);
  const after = (g: (typeof groups)[number]) => desc.slice(g.end, g.end + 14).toLowerCase();
  const skeins = groups.find((g) => /^\s*(skeins?|balls?|hanks?)/.test(after(g)));
  if (skeins && mPer) {
    const n = Number(skeins.values[sizeIdx]);
    if (Number.isFinite(n)) return `${fmt(n * Number(mPer[1]))} m`;
  }
  const grams = groups.find((g) => /^\s*(g|gr|grams?)\b/.test(after(g)));
  if (grams) return `${grams.values[sizeIdx]} g`;
  return undefined;
}

export function projectFacts(p: Pattern, size: string): Facts {
  const idx = p.sizes.indexOf(size);
  const flags: string[] = [];
  const measurements = p.measurements.map((m) => {
    let value: string | undefined;
    let flag: string | undefined;
    if (m.m?.[idx]) return { label: m.label, value: `${m.m[idx]} m`, flag: undefined };
    const cm = m.cm?.[idx];
    const inch = m.inches?.[idx];
    if (cm && /^\d/.test(cm)) {
      value = `${cm} cm`;
      const n = inch ? parseNumF(inch) : NaN;
      if (Number.isFinite(n) && disagrees(n, Number(cm))) {
        flag = `${m.label}: the source gives ${cm} cm and ${inch} in, which do not match.`;
        flags.push(flag);
      }
    } else if (inch) {
      const n = parseNumF(inch);
      if (Number.isFinite(n)) value = `${fmt(inchesToCm(n))} cm`;
    }
    return { label: m.label, value: value ?? '', flag };
  }).filter((m) => m.value);
  return {
    size,
    measurements,
    needles: needlesMm(p.needles),
    gauge: gaugeMetric(p),
    yarn: yarnRequirement(p, idx),
    flags,
  };
}
