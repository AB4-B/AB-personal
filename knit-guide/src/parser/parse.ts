/**
 * Stage 2: raw lines -> structured Pattern.
 * Generic heuristics only (labels, headings, "Row n:" lists, size groups). Nothing here
 * knows about any specific pattern. Uncertainty is recorded as parse warnings.
 */
import { uid } from '../model/helpers';
import { findSizeGroups, parseSizeList } from '../model/size';
import {
  SCHEMA_VERSION,
  type Abbreviation,
  type Gauge,
  type Instruction,
  type Measurement,
  type ParseWarning,
  type Pattern,
  type PatternImage,
  type Section,
  type StitchPattern,
} from '../model/types';
import { detectTrackers, sizeMismatchReasons } from './detect';
import type { RawImage, RawLine, RawPage } from './extract';

export const PARSER_VERSION = '0.1.0';

interface Block {
  page: number;
  lines: RawLine[];
  text: string;
  emphasis: boolean;
}

const JUNK = [/^click image to enlarge$/i, /^download pdf$/i];
const CAPTION_RE = /\b(chart|diagram|schematic)\s*$/i;

/* ---------------------------------------------------------------- captions */

interface PairedImage {
  img: RawImage;
  caption?: RawLine;
}

function pairImages(pages: RawPage[]): { pairs: PairedImage[]; captionLines: Set<RawLine> } {
  type Obj = { kind: 'cap'; line: RawLine } | { kind: 'img'; img: RawImage };
  const objs: Obj[] = [];
  for (const p of pages) {
    for (const l of p.lines) {
      const words = l.text.split(/\s+/).length;
      if (CAPTION_RE.test(l.text) && words <= 6 && !/[.,;:]$/.test(l.text)) objs.push({ kind: 'cap', line: l });
    }
    for (const im of p.images) {
      if (im.w >= 60 && im.h >= 40) objs.push({ kind: 'img', img: im });
    }
  }
  const top = (o: Obj) => (o.kind === 'cap' ? o.line.y : o.img.y + o.img.h);
  const pg = (o: Obj) => (o.kind === 'cap' ? o.line.page : o.img.page);
  objs.sort((a, b) => pg(a) - pg(b) || top(b) - top(a));

  const pageH = new Map(pages.map((p) => [p.page, p.height]));
  const pairs: PairedImage[] = [];
  const captionLines = new Set<RawLine>();
  let pending: RawLine | undefined;
  for (const o of objs) {
    if (o.kind === 'cap') {
      pending = o.line;
      continue;
    }
    let caption: RawLine | undefined;
    if (pending) {
      const sameDist = pending.page === o.img.page ? pending.y - (o.img.y + o.img.h) : Infinity;
      const crossPage =
        pending.page === o.img.page - 1 &&
        pending.y < 220 &&
        o.img.y + o.img.h > (pageH.get(o.img.page) ?? 792) - 220;
      if ((sameDist > -5 && sameDist < 80) || crossPage) caption = pending;
    }
    if (caption) {
      captionLines.add(caption);
      pending = undefined;
    }
    pairs.push({ img: o.img, caption });
  }
  return { pairs, captionLines };
}

/* ------------------------------------------------------------------ blocks */

function buildBlocks(lines: RawLine[]): Block[] {
  const pitchByPage = new Map<number, number>();
  const byPage = new Map<number, RawLine[]>();
  for (const l of lines) byPage.set(l.page, [...(byPage.get(l.page) ?? []), l]);
  for (const [p, ls] of byPage) {
    const gaps: number[] = [];
    for (let i = 1; i < ls.length; i++) {
      const g = ls[i - 1].y - ls[i].y;
      if (g > 4 && g < 20) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    pitchByPage.set(p, gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12);
  }

  const blocks: Block[] = [];
  let cur: Block | undefined;
  let prev: RawLine | undefined;
  for (const l of lines) {
    let newBlock = !cur || !prev;
    if (cur && prev) {
      if (l.page !== prev.page) {
        const cont = !/[.!?:]$/.test(prev.text) && /^[a-z]/.test(l.text);
        newBlock = !cont;
      } else {
        const pitch = pitchByPage.get(l.page) ?? 12;
        newBlock = prev.y - l.y > pitch * 1.45 || l.emphasis !== prev.emphasis;
      }
    }
    if (newBlock) {
      cur = { page: l.page, lines: [], text: '', emphasis: true };
      blocks.push(cur);
    }
    cur!.lines.push(l);
    prev = l;
  }
  for (const b of blocks) {
    b.text = b.lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
    b.emphasis = b.lines.every((l) => l.emphasis);
  }
  return blocks;
}

/* ----------------------------------------------------------------- helpers */

const ROW_LINE = /^(Rows?|Rounds?|Rnds?)\s*(\d+)\s*[:.]\s*(.*)$/i;
const LABEL_RE =
  /^(?<label>sizes?|finished\s+measurements?|measurements?|materials?|yarn|needles?|gauge|tension|skills(?:\s+required)?(?:\s*\/\s*techniques\s+used)?|techniques(?:\s+used)?|abbreviations?|difficulty(?:\s+level)?)\s*:?\s*(?<rest>.*)$/i;

export function splitAtSentences(text: string): string[] {
  return text.replace(/([.!?])\s+(?=[A-Z*])/g, '$1\u0000').split('\u0000').map((s) => s.trim()).filter(Boolean);
}

function splitSentences(text: string): string[] {
  const parts = splitAtSentences(text);
  return parts;
}

const ACTION_VERBS =
  /^(work|knit|purl|cast|bind|pick|transfer|unravel|holding|hold|sew|continue|follow|repeat|increase|decrease|place|divide|join|set|provisional|slip|turn|rep|cut|weave|block|make|using|use|at the same time)\b/i;

function classify(text: string): 'action' | 'info' {
  if (ACTION_VERBS.test(text)) return 'action';
  if (/^(row|round|rows|rounds|rnd)\b/i.test(text)) return 'action';
  if (/^(set-up|setup|next)\b/i.test(text)) return 'action';
  if (/^to\s+shape\b/i.test(text)) return 'action';
  if (/^stitch count\b/i.test(text)) return 'info';
  return 'info';
}

function isHeadingBlock(b: Block): { level: 1 | 2; title: string } | null {
  if (b.lines.length !== 1) return null;
  const t = b.text.replace(/:$/, '').trim();
  const words = t.split(/\s+/).length;
  if (words > 7 || /[.!?,;]$/.test(b.text) || t.includes(',')) return null;
  if (ROW_LINE.test(t) || /^(row|round)s?\b/i.test(t)) return null;
  if (/^[*\-•]/.test(t)) return null;
  if (b.emphasis) return { level: 1, title: t };
  if (words <= 4 && /^[A-Z]/.test(t) && !/\d/.test(t) && !/^(enjoy|bind|cast|knit|purl)/i.test(t)) {
    return { level: 2, title: t };
  }
  return null;
}

function parseAbbreviations(lines: RawLine[], page: number): Abbreviation[] {
  const out: Abbreviation[] = [];
  const entry = /^(\S+?)(?:\s*\(([^)]*)\))?\s+[–—-]\s+(.+)$/;
  for (const l of lines) {
    const m = l.text.match(entry);
    if (m) {
      const def = m[2] ? `${m[2]}${m[3] ? ' - ' + m[3] : ''}` : m[3];
      out.push({ abbr: m[1], definition: def, page: l.page });
    } else if (out.length) {
      out[out.length - 1].definition += ' ' + l.text;
    }
  }
  void page;
  return out;
}

function parseGauge(raw: string): Gauge {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(?:sts?|stitches)\s*(?:x|×|and|by)\s*(\d+(?:\.\d+)?)\s*rows?/i);
  const over = raw.match(/(\d+(?:\.\d+)?)\s*(?:"|in\b|inch)/i);
  return {
    raw,
    stitches: m ? Number(m[1]) : undefined,
    rows: m ? Number(m[2]) : undefined,
    overInches: over ? Number(over[1]) : m ? 4 : undefined,
  };
}

/* ------------------------------------------------------------------- parse */

export interface ParseOptions {
  fileId: string;
  fileName: string;
  id?: string;
}

export function parsePattern(pages: RawPage[], opts: ParseOptions): Pattern {
  const warnings: ParseWarning[] = [];
  let wn = 0;
  const warn = (level: ParseWarning['level'], message: string, extra: Partial<ParseWarning> = {}) =>
    warnings.push({ id: `w${++wn}`, level, message, ...extra });

  // ---- images + captions
  const { pairs, captionLines } = pairImages(pages);
  const images: PatternImage[] = [];
  const imageForLine = new Map<RawLine, string>();
  let imgN = 0;
  const uncaptionedPerPage = new Map<number, number>();
  for (const { img, caption } of pairs) {
    const id = `img${++imgN}`;
    const bbox = { x: img.x, y: img.y, w: img.w, h: img.h };
    if (caption) {
      images.push({ id, kind: 'chart', title: caption.text.replace(/\bchart\b/i, 'Chart'), caption: caption.text, page: img.page, bbox });
      imageForLine.set(caption, id);
    } else {
      const n = (uncaptionedPerPage.get(img.page) ?? 0) + 1;
      uncaptionedPerPage.set(img.page, n);
      images.push({
        id,
        kind: img.page === 1 ? 'photo' : 'diagram',
        title: `Image, page ${img.page}${n > 1 || pairs.filter((p) => p.img.page === img.page && !p.caption).length > 1 ? ` (${n})` : ''}`,
        page: img.page,
        bbox,
      });
    }
  }
  if (images.some((i) => i.kind === 'chart')) {
    warn('info', 'Charts are images in the PDF. They are kept as pictures; the app does not redraw them.');
  }

  // ---- lines -> blocks
  const lines = pages
    .flatMap((p) => p.lines)
    .filter((l) => !JUNK.some((r) => r.test(l.text)) && !captionLines.has(l));
  const blocks = buildBlocks(lines);

  // ---- front matter and labelled fields
  const p1 = pages[0];
  const titleLine = p1?.lines
    .filter((l) => !/©|copyright/i.test(l.text))
    .sort((a, b) => b.size - a.size || b.y - a.y)[0];
  let title = titleLine?.text ?? opts.fileName.replace(/\.pdf$/i, '');
  let designer = '';
  const cr = lines.map((l) => l.text).join(' ').match(/(?:copyright\s*©?|©)\s*([^.]+?)\.\s*All rights/i);
  if (cr) designer = cr[1].trim();
  if (!designer) {
    const by = lines.slice(0, 40).find((l) => /^by\s+\S+/i.test(l.text));
    if (by) designer = by.text.replace(/^by\s+/i, '');
  }

  let sizes: string[] = [];
  const measurements: Measurement[] = [];
  let materials = '';
  let needles = '';
  let gaugeRaw = '';
  let difficulty: string | undefined;
  let description = '';
  const techniques: string[] = [];
  let abbreviations: Abbreviation[] = [];

  const sections: Section[] = [];
  const instructions: Instruction[] = [];
  const stitchPatterns: StitchPattern[] = [];
  let zone: 'front' | 'fields' | 'body' = 'front';
  let abbrMode = false;
  let curL1: Section | undefined;
  let curSection: Section | undefined;
  let secN = 0;
  let insN = 0;
  let spN = 0;

  const addSection = (title: string, level: 1 | 2, page: number) => {
    const s: Section = { id: `s${++secN}`, title, level, page, parentId: level === 2 ? curL1?.id : undefined };
    sections.push(s);
    if (level === 1) curL1 = s;
    curSection = s;
    return s;
  };
  const imageIdsFor = (text: string, page: number): string[] => {
    const ids: string[] = [];
    for (const im of images) {
      if (im.kind !== 'chart' || !im.caption) continue;
      const key = im.caption.replace(/\bchart\b/i, '').trim();
      if (key && new RegExp(String.raw`\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s+charts?\b`, 'i').test(text)) ids.push(im.id);
    }
    if (!ids.length && /\bfrom\s+the\s+charts\b|\bcharts?\s+(?:as|are)\b/i.test(text)) {
      ids.push(...images.filter((i) => i.kind === 'chart').map((i) => i.id));
    }
    void page;
    return ids;
  };
  const addInstruction = (text: string, b: { page: number; lines: string[] }, forceKind?: Instruction['kind']) => {
    const sec = curSection ?? addSection('Pattern', 1, b.page);
    const ins: Instruction = {
      id: `i${++insN}`,
      sectionId: sec.id,
      kind: forceKind ?? classify(text),
      text,
      source: { page: b.page, lines: b.lines, imageIds: imageIdsFor(text, b.page) },
    };
    instructions.push(ins);
    return ins;
  };

  let pendingLabel: string | undefined;
  const applyField = (label: string, restAll: string[], page: number) => {
    abbrMode = false;
    if (/^sizes?$/.test(label)) {
      sizes = parseSizeList(restAll.join(' '));
    } else if (/finished|measurements?/.test(label)) {
      for (const line of restAll) {
        const mm = line.match(/^([^:]+):\s*(.+)$/);
        if (!mm) continue;
        const groups = findSizeGroups(mm[2], sizes.length);
        measurements.push({
          id: `m${measurements.length + 1}`,
          label: mm[1].trim(),
          raw: line,
          inches: groups[0]?.values,
          cm: groups[1]?.values,
          page,
        });
      }
    } else if (/^(materials?|yarn)$/.test(label)) {
      materials = restAll.join(' ');
    } else if (/^needles?$/.test(label)) {
      needles = restAll.join(' ');
    } else if (/^(gauge|tension)$/.test(label)) {
      gaugeRaw = restAll.join(' ');
    } else if (/^difficulty/.test(label)) {
      difficulty = restAll.join(' ');
    } else if (/^(skills|techniques)/.test(label)) {
      for (const t of restAll) {
        const clean = t.replace(/^[-•*]\s*/, '').trim();
        if (clean) techniques.push(clean);
      }
    } else if (/^abbreviations?$/.test(label)) {
      abbrMode = true;
      abbreviations = parseAbbreviations(
        restAll.map((t) => ({ page, y: 0, x: 0, size: 0, text: t, emphasis: false })),
        page,
      );
    }
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const first = b.lines[0].text;

    // ---------- front matter
    if (zone === 'front') {
      if (/©|copyright/i.test(b.text)) continue;
      const lm = first.match(LABEL_RE);
      if (!lm) {
        if (b.lines.some((l) => l === titleLine)) {
          title = titleLine!.text;
          continue;
        }
        if (b.text.length > 160) description += (description ? ' ' : '') + b.text;
        continue;
      }
      zone = 'fields';
    }

    // ---------- body starts at "Pattern notes" or at the first heading after fields
    if (zone === 'fields') {
      if (/^pattern\s+notes?:?$/i.test(first) && b.lines.length === 1) {
        zone = 'body';
        abbrMode = false;
        addSection('Pattern notes', 1, b.page);
        continue;
      }
      if (b.text.length > 160 && !LABEL_RE.test(first) && !abbrMode) {
        description += (description ? ' ' : '') + b.text;
        continue;
      }
      const lm = first.match(LABEL_RE);
      if (lm?.groups) {
        const label = lm.groups.label.toLowerCase().replace(/\s+/g, ' ');
        const restFirst = lm.groups.rest.trim();
        const restAll = [restFirst, ...b.lines.slice(1).map((l) => l.text)].filter(Boolean);
        pendingLabel = restAll.length ? undefined : label;
        applyField(label, restAll, b.page);
        continue;
      }
      if (pendingLabel) {
        applyField(pendingLabel, b.lines.map((l) => l.text), b.page);
        pendingLabel = undefined;
        continue;
      }
      if (abbrMode) {
        abbreviations.push(...parseAbbreviations(b.lines, b.page));
        continue;
      }
      // unknown block between fields and notes: a heading starts the body, anything else is intro text
      const hh = isHeadingBlock(b);
      if (!hh || hh.level !== 1) {
        if (b.text.length > 60) description += (description ? ' ' : '') + b.text;
        continue;
      }
      zone = 'body';
    }

    // ---------- body
    // "1x1 Ribbing: multiple of 2" + following text block -> text stitch pattern
    if (b.lines.length === 1 && /multiple\s+of\s+\d+/i.test(b.text) && !ROW_LINE.test(b.text) && blocks[bi + 1]) {
      const next = blocks[bi + 1];
      const nm = b.text.match(/^(.*?)\s*[:\-]\s*multiple\s+of\s+(\d+)/i);
      const sp: StitchPattern = {
        id: `sp${++spN}`,
        name: nm ? nm[1].trim() : b.text,
        unit: 'text',
        rows: [],
        text: next.text,
        length: 1,
        multipleOf: nm ? Number(nm[2]) : undefined,
        page: b.page,
      };
      stitchPatterns.push(sp);
      const ins = addInstruction(`${b.text}\n${next.text}`, { page: b.page, lines: [...b.lines, ...next.lines].map((l) => l.text) }, 'stitch-pattern');
      ins.stitchPatternId = sp.id;
      bi++;
      continue;
    }

    // "Row 1: ... Row 4: ... Repeat from row 1." -> row-based stitch pattern
    const rowLines = b.lines.filter((l) => ROW_LINE.test(l.text));
    if (rowLines.length >= 2 && rowLines.every((l, i) => Number(l.text.match(ROW_LINE)![2]) === i + 1)) {
      const firstRowIdx = b.lines.indexOf(rowLines[0]);
      const head = b.lines.slice(0, firstRowIdx).map((l) => l.text).join(' ');
      const nm = head.match(/^(.*?)\s*(?::\s*multiple\s+of\s+(\d+))?\s*$/i);
      const unit = /^rou?nd/i.test(rowLines[0].text) ? 'round' : 'row';
      const repLine = b.lines.map((l) => l.text).find((t) => /repeat\s+from\s+(?:row|round|rnd)\s+\d+/i.test(t));
      const sp: StitchPattern = {
        id: `sp${++spN}`,
        name: (nm?.[1] || (unit === 'row' ? 'Stitch pattern (rows)' : 'Stitch pattern (rounds)')).replace(/[:\s]+$/, '').trim(),
        unit,
        rows: rowLines.map((l) => {
          const m = l.text.match(ROW_LINE)!;
          return { n: Number(m[2]), text: m[3].trim() };
        }),
        repeatFrom: repLine ? Number(repLine.match(/repeat\s+from\s+(?:row|round|rnd)\s+(\d+)/i)![1]) : undefined,
        length: rowLines.length,
        multipleOf: nm?.[2] ? Number(nm[2]) : undefined,
        page: b.page,
      };
      stitchPatterns.push(sp);
      if (!curSection) addSection('Pattern notes', 1, b.page);
      const ins = addInstruction(b.lines.map((l) => l.text).join('\n'), { page: b.page, lines: b.lines.map((l) => l.text) }, 'stitch-pattern');
      ins.stitchPatternId = sp.id;
      continue;
    }

    // a short Title Case first line followed by prose is a sub-heading with no blank gap after it
    if (b.lines.length >= 2 && !b.lines[0].emphasis) {
      const t0 = b.lines[0].text;
      const w0 = t0.split(/\s+/);
      if (w0.length <= 3 && w0.every((w) => /^[A-Z]/.test(w)) && !/[\d.,:;!?*]/.test(t0) && !/^(row|round)/i.test(t0)) {
        addSection(t0, curL1 ? 2 : 1, b.page);
        blocks[bi] = { ...b, lines: b.lines.slice(1), text: b.lines.slice(1).map((l) => l.text).join(' ') };
        bi--;
        continue;
      }
    }

    const h = isHeadingBlock(b);
    if (h && !(h.level === 2 && !curL1)) {
      addSection(h.title, h.level, b.page);
      continue;
    }
    if (/^(enjoy!?|pattern was updated.*)$/i.test(b.text)) continue;

    // paragraph -> one or more instructions
    const sentences = splitSentences(b.text);
    const split = sentences.length >= 3 || b.text.length > 220;
    const units = split ? sentences : [b.text];
    for (const u of units) {
      addInstruction(u, { page: b.page, lines: split ? [u] : b.lines.map((l) => l.text) });
    }
  }

  // ---- derived fields
  const sizeCount = sizes.length;
  if (!sizeCount) warn('needs-review', 'No size list found. Add sizes in the review screen.');
  if (!gaugeRaw) warn('needs-review', 'No gauge found.');

  for (const ins of instructions) {
    const reasons = sizeMismatchReasons(ins.text, sizeCount);
    if (reasons.length) {
      ins.review = [...(ins.review ?? []), ...reasons];
      warn('needs-review', reasons.join(' '), { instructionId: ins.id, page: ins.source.page });
    }
  }

  const { trackers } = detectTrackers(sections, instructions, stitchPatterns, sizeCount);
  for (const t of trackers) {
    for (const r of t.review) warn('needs-review', `${t.title}: ${r}`, { page: instructions.find((i) => i.trackerId === t.id)?.source.page });
  }

  const weight = materials.match(/\b(lace|fingering|sock|sport|DK|light worsted|worsted|aran|bulky|super bulky|chunky)\b/i)?.[1];

  const now = Date.now();
  return {
    id: opts.id ?? uid(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    fileId: opts.fileId,
    fileName: opts.fileName,
    pageCount: pages.length,
    title,
    designer,
    difficulty,
    description: description || undefined,
    sizes,
    measurements,
    yarn: { description: materials, weight, requirements: materials },
    needles,
    gauge: parseGauge(gaugeRaw),
    techniques,
    abbreviations,
    stitchPatterns,
    images,
    sections,
    instructions,
    trackers,
    parse: { parserVersion: PARSER_VERSION, extractedAt: now, warnings },
  };
}

/** Prefill helpers for project setup (suggestions only; user edits freely). */
export function suggestSetup(p: Pattern) {
  const yarn = p.yarn.description.split(/[(,]/)[0].trim();
  const colour = p.yarn.description.match(/colou?r\s+([^-–,]+?)(?:\s+[-–]|,|$)/i)?.[1]?.trim() ?? '';
  const needle = p.needles.match(/US\s*[\d.]+\s*\([\d.]+\s*mm\)/i)?.[0] ?? p.needles;
  return { yarn, colour, needle };
}
