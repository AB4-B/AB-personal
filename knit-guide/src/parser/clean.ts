/**
 * Stage 1.5: layout-independent cleanup shared by PDF and pasted text.
 *  - drops web chrome (menus, ads, "Have you finished this pattern?" outro)
 *  - drops repeating page furniture (URL/date footers, "Page 2 of 4")
 *  - turns divider lines into paragraph breaks
 *  - splits "ALL CAPS HEADING:" (alone or glued to its first sentence) into a heading line
 * Nothing is rewritten: lines are only removed, split at the heading colon, or flagged.
 */
import type { RawLine, RawPage } from './extract';

const NOISE: RegExp[] = [
  /^(pattern|videos|lessons|faq|comments( \(\d+\))?)$/i,
  /^change language:?$/i,
  /^english( \(.*\))?$/i,
  /^highlight size:?$/i,
  /^what size should i knit\??$/i,
  /^related pattern$/i,
  /^(united states|canada)$/i,
  /^alternative yarn\b/i,
  /^yarn groups? [a-f]\b/i,
  /^yarn usage using an alternative/i,
  /^you might also like\.*$/i,
  /^product image\b/i,
  /^drops (air|button no\.? ?\d+|needles & hooks)$/i,
  /^charred \(/i,
  /^\d+% [a-z]+.*\d+% /i,
  /^from [\d.,]+ ?\$ ?\/ ?\d+ ?g$/i,
  /^get the yarn to make this pattern/i,
  /^keep the screen on while knitting$/i,
  /^pattern instructions\s*$/i,
  /^diagram( for .*)?$/i,
  /^page \d+ of \d+$/i,
  /^https?:\/\/\S+(\s.*)?$/i,
  /^(skip to|menu|search|log ?in|sign ?up|share|print|save|pin it|tweet)$/i,
];

/** Everything from the first of these lines onward is website outro, not pattern. */
const OUTRO: RegExp[] = [/^have you finished this pattern\??$/i, /^do you need help with this pattern\??$/i, /^©\s*\d{4}/];

const DIVIDER = /^[-–—_=*~•·\s]{4,}$/;

export const isCapsText = (s: string) => {
  // lowercase connector words are allowed inside a caps heading ("SIZES S, M and XL")
  const letters = s.replace(/\([^)]*\)/g, '').replace(/\b(and|or|for|the|of|to)\b/g, '').replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 && letters === letters.toUpperCase();
};

/** Known field labels are left alone so the field parser sees them. */
const LABEL_PREFIX =
  /^(sizes?|finished measurements?|measurements?|materials?|yarn|needles?|gauge|tension|knitting gauge|buttons?|notions|skills|techniques|abbreviations?|difficulty)$/i;

function splitCapsHeading(l: RawLine): RawLine[] {
  const m = l.text.match(/^([A-Z0-9][A-Za-z0-9 ,.&/()'–—-]{1,90}?):\s*(.*)$/);
  if (!m) return [l];
  const prefix = m[1];
  const rest = m[2];
  if (!isCapsText(prefix) || LABEL_PREFIX.test(prefix.trim())) return [l];
  // "SIZE S: 8, 16, 24 ..." is a data row, not a heading
  if (/^SIZES?\b/.test(prefix) && rest) return [l];
  // "NOTE: …", "TIP: …" and "DROPS BUTTONS NO. 537: 4 items" are text, not headings
  if (/^(NOTES?|TIPS?|REMEMBER|IMPORTANT|WARNING)$/.test(prefix.trim()) || /^\d/.test(rest)) return [l];
  const head: RawLine = { ...l, text: prefix.trim(), emphasis: true, breakBefore: true };
  return rest ? [head, { ...l, text: rest, emphasis: false, breakBefore: true }] : [head];
}

export function dropPageFurniture(pages: RawPage[]): RawPage[] {
  const norm = (t: string) => t.replace(/\d+/g, '#').toLowerCase();
  const seen = new Map<string, Set<number>>();
  for (const p of pages) for (const l of p.lines) {
    const k = norm(l.text);
    (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(p.page);
  }
  const need = Math.max(2, Math.ceil(pages.length * 0.6));
  return pages.map((p) => ({
    ...p,
    lines: p.lines.filter((l) => {
      const pagesWith = seen.get(norm(l.text))?.size ?? 0;
      return !(pages.length >= 3 && pagesWith >= need && l.text.length < 140 && (l.y < 60 || l.y > p.height - 60 || /page|https?:/i.test(l.text)));
    }),
  }));
}

export function cleanLines(input: RawLine[]): RawLine[] {
  const out: RawLine[] = [];
  const seenLong = new Set<string>();
  let breakNext = false;
  for (const l of input) {
    const t = l.text.trim();
    if (!t) { breakNext = true; continue; }
    if (OUTRO.some((r) => r.test(t))) break;
    if (DIVIDER.test(t)) { breakNext = true; continue; }
    if (NOISE.some((r) => r.test(t))) { breakNext = true; continue; }
    // web pages repeat the same long banner line many times
    const key = t.toLowerCase();
    if (t.length > 40) {
      if (seenLong.has(key)) continue;
      seenLong.add(key);
    }
    // labels glued to the line above ("Size: …", "Finished measurements:") start their own block
    const isLabel = /^(sizes?\s*:|(finished measurements?|measurements?|materials?|yarn|needles?|gauge|tension|knitting gauge|buttons?|notions|skills|techniques|abbreviations?|difficulty)[^:]{0,30}:)/i.test(t);
    const line = breakNext || isLabel ? { ...l, breakBefore: true } : l;
    breakNext = false;
    out.push(...splitCapsHeading(line));
  }
  return out;
}

/* ------------------------------------------------------------ pasted text */

const ROWISH = /^(rows?|rounds?|rnds?)\s*\d+/i;
const SIZE_LINE = /^sizes?\s+\S+\s*:/i;

/**
 * Pasted text has no layout, so layout is inferred:
 *  - hard-wrapped text (copied out of a PDF): paragraphs are separated by blank lines
 *  - web text (one paragraph per line): every line is its own paragraph, except
 *    consecutive "Row n:" lines and "SIZE x:" lines which stay together
 */
export function textToPages(text: string): RawPage[] {
  const raw = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const nonBlank = raw.filter(Boolean);
  let wrapped = 0;
  for (let i = 0; i < raw.length - 1; i++) {
    if (raw[i] && raw[i + 1] && !/[.:!?)"”]$/.test(raw[i]) && /^[a-z(]/.test(raw[i + 1])) wrapped++;
  }
  const hardWrapped = nonBlank.length > 5 && wrapped / nonBlank.length > 0.15;

  const lines: RawLine[] = [];
  let y = 100000;
  let prev = '';
  let first = true;
  for (const t of raw) {
    if (!t) { y -= 12; prev = ''; continue; }
    let gap = 12;
    if (!hardWrapped && prev) {
      const keep =
        ((ROWISH.test(t) || /^repeat\b/i.test(t)) && (ROWISH.test(prev) || /multiple of|:$/.test(prev))) ||
        (SIZE_LINE.test(t) && (SIZE_LINE.test(prev) || /:$/.test(prev)));
      gap = keep ? 12 : 24;
    } else if (!prev) gap = 12;
    y -= gap;
    lines.push({ page: 1, y, x: 0, size: first ? 20 : 10, text: t, emphasis: false });
    first = false;
    prev = t;
  }
  return [{ page: 1, width: 612, height: 100000, lines, images: [] }];
}
