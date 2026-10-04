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

const NUM = String.raw`\d+(?:\.\d+)?`;
const GROUP_RE = new RegExp(
  String.raw`(^|[^\d.])(${NUM})\s*[\[(]\s*(${NUM}(?:\s*,\s*${NUM})+)\s*[\])]`,
  'g',
);

export function findSizeGroups(text: string, sizeCount: number): SizeGroup[] {
  const groups: SizeGroup[] = [];
  for (const m of text.matchAll(GROUP_RE)) {
    // no regex lookbehind (older iOS Safari): m[1] is the one character before the number
    const lead = m[1].length;
    const inner = m[3].split(',').map((s) => s.trim());
    const values = [m[2], ...inner];
    groups.push({
      start: m.index! + lead,
      end: m.index! + m[0].length,
      raw: m[0].slice(lead),
      values,
      matchesSizes: sizeCount > 0 && values.length === sizeCount,
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

/** "S [M, L, XL, 2X, 3X]" -> ["S","M","L","XL","2X","3X"] */
export function parseSizeList(s: string): string[] {
  return s
    .replace(/^[:\s]+/, '')
    .split(/[\s,\[\]()]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function toNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
