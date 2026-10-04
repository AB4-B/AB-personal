/**
 * Metric-only guide. The designer's original wording is never touched; this only builds the
 * guided text. Rules, in order:
 *   1. both units given -> keep the designer's METRIC value and drop the imperial companion
 *   2. imperial only    -> convert (inches -> cm, US needle -> mm, yards -> m, oz -> g)
 *   3. metric and imperial disagree materially -> report it (MEASUREMENT NEEDS REVIEW), never pick silently
 */

const FR: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const FRAC = '[¼½¾⅛⅜⅝⅞]';
const NUMF = String.raw`\d+(?:\.\d+)?${FRAC}?`;
const INCH = String.raw`(?:["”″]|\s?inch(?:es)?\b)`;
const IMP = String.raw`${NUMF}\s?${INCH}`;
const IMPSEQ = String.raw`${IMP}(?:\s*(?:[x×]|,|and|-|–|to)\s*${IMP})*`;
const METRIC_ONE = String.raw`\d+(?:\.\d+)?\s?(?:cm|mm)\b`;

export const US_NEEDLE_MM: Record<string, number> = {
  '0': 2, '1': 2.25, '2': 2.75, '3': 3.25, '4': 3.5, '5': 3.75, '6': 4, '7': 4.5, '8': 5, '9': 5.5,
  '10': 6, '10.5': 6.5, '11': 8, '13': 9, '15': 10, '17': 12, '19': 15, '35': 19, '50': 25,
};

export function parseNumF(s: string): number {
  const m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)(${FRAC})?$`));
  if (!m) return NaN;
  return Number(m[1]) + (m[2] ? FR[m[2]] : 0);
}

/** "4.0" -> "4", "30.5" -> "30.5" */
export const fmt = (n: number) => String(Number(n.toFixed(2)));

/** Sensible knitting rounding: 0.1 cm under 10 cm, otherwise nearest 0.5 cm. */
export function inchesToCm(inches: number): number {
  const cm = inches * 2.54;
  return cm < 10 ? Math.round(cm * 10) / 10 : Math.round(cm * 2) / 2;
}

export interface MetricResult {
  text: string;
  /** material disagreements between the designer's metric and imperial values */
  flags: string[];
}

export const disagrees = (impInches: number, cm: number) => {
  const conv = impInches * 2.54;
  const diff = Math.abs(conv - cm);
  return diff > 1.5 && diff / Math.max(cm, 1) > 0.04;
};

export function toMetric(input: string): MetricResult {
  let t = input;
  const flags: string[] = [];

  // unit case / spelling
  t = t.replace(/(\d)\s*(MM|CM)\b/g, (_m, d, u) => `${d} ${u.toLowerCase()}`);
  t = t.replace(/(\d)\s*(?:meters?|metres?)\b/gi, '$1 m');
  t = t.replace(/(\d)\s*gr\b/gi, '$1 g');

  // 1a. yards then metres: "219 yards (200 meters)" -> "200 m"
  t = t.replace(/\d+(?:\.\d+)?\s*(?:yards?|yds?)\s*\(\s*(\d+(?:\.\d+)?)\s*m\s*\)/gi, '$1 m');
  // 1b. imperial then metric in brackets: `44 inches (110 cm)`, `4" x 4" (10 cm x 10 cm)`
  t = t.replace(
    new RegExp(String.raw`(${IMPSEQ})\s*\(\s*(${METRIC_ONE}(?:\s*[x×]\s*${METRIC_ONE})?)\s*\)`, 'gi'),
    (m, imp: string, metric: string) => {
      const toks = imp.match(new RegExp(NUMF, 'g')) ?? [];
      const cms = metric.match(/\d+(?:\.\d+)?/g) ?? [];
      if (toks.length === 1 && cms.length === 1 && disagrees(parseNumF(toks[0]), Number(cms[0]))) {
        flags.push(`"${m.trim()}": metric and imperial values differ`);
      }
      return metric;
    },
  );
  // 1c. metric followed by imperial companions: `110 cm = 44"`, `32 cm / 3", 6¼"`, `10 x 10 cm / 4" x 4"`
  t = t.replace(
    new RegExp(String.raw`(\d+(?:\.\d+)?\s?(?:cm|mm))\s*[/=(]\s*(${IMPSEQ})\)?`, 'gi'),
    (m, metric: string, imp: string) => {
      const toks = imp.match(new RegExp(NUMF, 'g')) ?? [];
      const cm = Number(metric.match(/\d+(?:\.\d+)?/)![0]);
      if (/cm/i.test(metric) && toks.length === 1 && !/[x×,]|and/.test(imp) && disagrees(parseNumF(toks[0]), cm)) {
        flags.push(`"${m.trim()}": metric and imperial values differ`);
      }
      return metric;
    },
  );

  // 2. needles: designer's mm wins, otherwise convert the US size
  t = t.replace(/\bUS\s*[\d.]+\s*\(\s*(\d+(?:\.\d+)?)\s*mm\s*\)/gi, '$1 mm');
  t = t.replace(/(\d+(?:\.\d+)?)\s*mm\s*(?:\/|=|\()\s*US\s*[\d.]+\)?/gi, '$1 mm');
  t = t.replace(/\bUS\s*[\d.]+\s*(?:\/|=)\s*(\d+(?:\.\d+)?)\s*mm/gi, '$1 mm');
  t = t.replace(/\bUS\s*(\d+(?:\.\d+)?)\b/g, (m, n: string) => (US_NEEDLE_MM[n] ? `${fmt(US_NEEDLE_MM[n])} mm` : m));

  // 3. leftovers: imperial only -> convert
  t = t.replace(new RegExp(String.raw`(${NUMF})\s?${INCH}`, 'g'), (_m, n: string) => `${fmt(inchesToCm(parseNumF(n)))} cm`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:yards?|yds?)\b/gi, (_m, n: string) => `${Math.round(Number(n) * 0.9144)} m`);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:ounces?|oz)\b/gi, (_m, n: string) => `${Math.round(Number(n) * 28.35)} g`);

  t = t.replace(/(\d+)\.0(\s?(?:mm|cm|m|g)\b)/g, '$1$2').replace(/\s+([.,;:])/g, '$1').replace(/ {2,}/g, ' ');
  return { text: t, flags };
}

export const hasImperial = (s: string) =>
  new RegExp(`${NUMF}\\s?${INCH}|\\bUS\\s*\\d|\\b(?:yards?|yds?|oz)\\b`, 'i').test(s);
