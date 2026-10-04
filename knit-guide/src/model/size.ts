/**
 * Multi-size resolution: "50 [50, 54, 54, 54, 58]" -> the number for the selected size.
 * The original text is never changed; callers render the resolved value on top of it.
 */

export interface SizeGroup {
  /** offsets in the source text covering e.g. `50 [50, 54, 54, 54, 58]` */
  start: number;
  end: number;
  raw: string;
  values: string[];
  /** false when the count does not equal the number of sizes -> NEEDS REVIEW */
  matchesSizes: boolean;
}

const FRAC = '[¼½¾⅛⅜⅝⅞]';
/** one number as printed: 12, 3.5, 6¾ */
export const TOK = String.raw`(?:\d+(?:\.\d+)?${FRAC}?|${FRAC})`;
const Q = String.raw`(?:\s?["”″])?`;
const BRACKET_SRC = String.raw`${TOK}\s*[\[(]\s*${TOK}(?:\s*,\s*${TOK})+\s*[\])]`;
/** DROPS style: 102-110-116-128-140-152 (spaces and inch marks tolerated) */
const DASH_SRC = String.raw`${TOK}${Q}(?:\s?[-–]\s?${TOK}${Q}){2,}`;
/** two-number lists ("2-1") are only size lists inside a section written for exactly two sizes */
const DASH2_SRC = String.raw`${TOK}${Q}\s?[-–]\s?${TOK}${Q}`;
/** a per-size number list, either `50 [50, 54, 58]` / `50 (50, 54)` or `50-50-54-58` */
export const GROUP_SRC = String.raw`(?:${BRACKET_SRC}|${DASH_SRC})`;
/** a single number or a size group */
export const NUM_OR_GROUP_SRC = String.raw`(?:${GROUP_SRC}|${TOK})`;

// no regex lookbehind (older iOS Safari): group 1 is the one character before the list
const GROUP_RE = new RegExp(String.raw`(^|[^\d.\-–])(${BRACKET_SRC}|${DASH_SRC}|${DASH2_SRC})`, 'g');

/** "50 [50, 54]" / "11-11-13" -> ["50","50","54"] ; a plain number -> [number] */
export function parseGroupValues(raw: string): { values: string[]; perSize: boolean } {
  const t = raw.trim();
  if (/[\[(]/.test(t)) {
    const m = t.match(/^([^\s\[(]+)\s*[\[(]\s*([^\])]+?)\s*[\])]$/);
    if (m) return { values: [m[1], ...m[2].split(',').map((x) => x.trim())], perSize: true };
  }
  const parts = t.split(/\s?[-–]\s?/).map((x) => x.replace(/["”″\s]/g, ''));
  if (parts.length >= 2 && parts.every((x) => /^\d+(?:\.\d+)?[¼½¾⅛⅜⅝⅞]?$/.test(x))) return { values: parts, perSize: true };
  return { values: [t], perSize: false };
}

export function findSizeGroups(text: string, sizeCount: number, sectionListLen?: number): SizeGroup[] {
  const groups: SizeGroup[] = [];
  for (const m of text.matchAll(GROUP_RE)) {
    const lead = m[1].length;
    const raw = m[2];
    const { values } = parseGroupValues(raw);
    const isBracket = /[\[(]/.test(raw);
    // short dash lists (under 4 numbers) are never treated as size lists; 4-12 numbers that do not
    // match the number of sizes are kept and flagged, because guessing would be worse
    const sectionList = sectionListLen !== undefined && sectionListLen !== sizeCount && values.length === sectionListLen;
    if (!isBracket && values.length === 2 && !sectionList) continue;
    if (!isBracket && values.length !== sizeCount && !sectionList && (values.length < 4 || values.length > 12)) continue;
    groups.push({
      start: m.index! + lead,
      end: m.index! + m[0].length,
      raw,
      values,
      matchesSizes: sizeCount > 0 && (values.length === sizeCount || sectionList),
    });
  }
  return groups;
}

export function resolveGroup(g: SizeGroup, sizeIndex: number): string | undefined {
  if (!g.matchesSizes || sizeIndex < 0) return undefined;
  return g.values[sizeIndex];
}

export type TextPart =
  | { type: 'text'; text: string }
  | { type: 'size'; value: string; raw: string; group: SizeGroup }
  | { type: 'size-unresolved'; raw: string; group: SizeGroup };

/** Split text into plain parts and size groups (resolved if possible). */
export function splitBySizeGroups(text: string, sizes: string[], sizeIndex: number): TextPart[] {
  const groups = findSizeGroups(text, sizes.length);
  const parts: TextPart[] = [];
  let pos = 0;
  for (const g of groups) {
    if (g.start > pos) parts.push({ type: 'text', text: text.slice(pos, g.start) });
    const v = resolveGroup(g, sizeIndex);
    parts.push(
      v === undefined
        ? { type: 'size-unresolved', raw: g.raw, group: g }
        : { type: 'size', value: v, raw: g.raw, group: g },
    );
    pos = g.end;
  }
  if (pos < text.length) parts.push({ type: 'text', text: text.slice(pos) });
  return parts;
}

/** Text with size groups replaced by the selected size's value (for search / explain). */
export function resolveText(text: string, sizes: string[], sizeIndex: number): string {
  return splitBySizeGroups(text, sizes, sizeIndex)
    .map((p) => (p.type === 'size' ? p.value : p.type === 'size-unresolved' ? p.raw : p.text))
    .join('');
}

/**
 * "S [M, L, XL, 2X, 3X]" -> ["S","M","L","XL","2X","3X"]
 * "0-6 mo (6-12 mo, 1-2 yrs, Adult XS, S, M). Sizes listed in this order." -> names that contain spaces and hyphens
 */
export function parseSizeList(s: string): string[] {
  let t = s.replace(/^[:\s]+/, '');
  if (t.includes(',')) {
    // a comma list: names may contain spaces and hyphens; anything after the closing bracket's full stop is prose
    const cut = t.match(/^[^.]*?[)\]]\s*\.(?:\s|$)/) ?? t.match(/^[^.]*?\.(?:\s|$)/);
    if (cut) t = cut[0].replace(/\.\s*$/, '');
    return t
      .replace(/[\[(]/g, ',')
      .replace(/[\])]/g, '')
      .split(',')
      .map((x) => x.replace(/^\s*(?:adult|child|kids?|women'?s|men'?s)\s+/i, '').replace(/\s+/g, ' ').trim())
      .filter((x) => x && !/^and$/i.test(x));
  }
  return t
    .split(/\s+[-–—]\s+|[\s,\[\]()]+/)
    .map((x) => x.trim())
    .filter((x) => x && !/^[-–—&]$|^and$/i.test(x));
}

export function toNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
