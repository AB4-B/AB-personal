/**
 * Stage 2: raw lines -> structured Pattern.
 * Generic heuristics only (labels, headings, "Row n:" lists, size groups). Nothing here
 * knows about any specific pattern. Uncertainty is recorded as parse warnings.
 */
import { needlesMm } from '../model/facts';
import { computeAppliesTo } from '../model/guide';
import { uid } from '../model/helpers';
import { splitAtSentences } from '../model/text';
import { findSizeGroups, parseSizeList } from '../model/size';
import {
  SCHEMA_VERSION,
  READER_VERSION,
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
import { cleanLines, dropPageFurniture, isCapsText, textToPages } from './clean';
import { applyScopes } from './scope';
import { parseSizeTable } from './sizetable';
import { detectTrackers, flagUnmodelledSimultaneous, sizeMismatchReasons } from './detect';
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
      if (l.breakBefore) newBlock = true;
      else if (l.page !== prev.page) {
        const cont = !/[.!?:]$/.test(prev.text) && /^[a-z]/.test(l.text);
        newBlock = !cont;
      } else {
        const pitch = pitchByPage.get(l.page) ?? 12;
        newBlock = prev.y - l.y > pitch * 1.45 || l.y > prev.y + 2 || l.emphasis !== prev.emphasis;
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

const ROW_LINE = /^(Rows?|Rounds?|Rnds?)\s*(\d+)\s*(?:\(([A-Za-z]{2})\))?\s*[:.]\s*(.*)$/i;
const LABEL_RE =
  /^(?<label>sizes?|sizing|suggested\s+needles|finished\s+measurements?|measurements?|materials?|yarn|needles?|gauge|tension|knitting\s+gauge|buttons?|notions|skills(?:\s+required)?(?:\s*\/\s*techniques\s+used)?|techniques(?:\s+used)?|abbreviations?|difficulty(?:\s+level)?)(?:\s*:\s*(?<rest>.*)|\s*$)/i;

export { splitAtSentences };

function splitSentences(text: string): string[] {
  const parts = splitAtSentences(text);
  return parts;
}

const INFO_START =
  /^(the|this|these|those|note|notes|please|you|there|all measurements|piece|jacket|cardigan|sweater|sleeves?|garment|body)\b[^:]*\b(is|are|will|can|should|may|measures?|worked)\b/i;
const INFO_DEFINITION = /^[A-Z][\w -]{0,40}\b(is|are) (worked|marked|used|made)\b/;

/** Prose that explains rather than instructs. Everything else is treated as an instruction. */
function classify(text: string): 'action' | 'info' {
  if (/^stitch count\b/i.test(text)) return 'info';
  if (isCapsText(text) && /[!.]$/.test(text)) return 'info';
  if (/^(row|round|rows|rounds|rnd|set-?up|next)\b/i.test(text)) return 'action';
  if (/^at the same time\b/i.test(text)) return 'action';
  if (INFO_START.test(text) && !/^(work|knit|purl|cast)\b/i.test(text)) return 'info';
  if (INFO_DEFINITION.test(text)) return 'info';
  if (/^(enjoy|have fun|good luck)/i.test(text)) return 'info';
  return 'action';
}

function isHeadingBlock(b: Block): { level: 1 | 2; title: string } | null {
  if (b.lines.length !== 1) return null;
  const t = b.text.replace(/:$/, '').trim();
  const words = t.split(/\s+/).length;
  const caps = isCapsText(t.replace(/\([^)]*\)/g, ''));
  if (words > (caps ? 16 : 7) || /[.!?,;]$/.test(b.text) || (!b.emphasis && t.includes(','))) return null;
  if (ROW_LINE.test(t) || /^(row|round)s?\b/i.test(t)) return null;
  if (/^[*\-•]/.test(t)) return null;
  if (b.emphasis) return { level: /^(all )?sizes?\b/i.test(t) ? 2 : 1, title: t };
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
  const m = raw.match(/(\d+(?:\.\d+)?)\s*(?:sts?|stitches)(?:\s+in\s+width)?\s*(?:x|×|and|by)\s*(\d+(?:\.\d+)?)\s*rows?/i);
  const over = raw.match(/(\d+(?:\.\d+)?)\s*(?:"|in\b|inch)/i);
  return {
    raw,
    stitches: m ? Number(m[1]) : undefined,
    rows: m ? Number(m[2]) : undefined,
    overInches: over ? Number(over[1]) : m ? 4 : undefined,
  };
}

/**
 * "EXPLANATIONS FOR THE PATTERN:" followed straight away by "GARTER STITCH:" has no text of its own:
 * it is a group title. Following headings become its level-2 children until the next group title.
 * Trailing empty headings are dropped. Shared with the review screen's re-derive step.
 */
export function groupHeadings(sections: Section[], instructions: Instruction[]) {
  const has = (s: Section) => instructions.some((i) => i.sectionId === s.id);
  // drop empty headings at the end
  while (sections.length && !has(sections[sections.length - 1])) sections.pop();
  let group: Section | undefined;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!has(s) && i < sections.length - 1 && s.level === 1) {
      group = s;
      continue;
    }
    if (group && s.level === 1) {
      s.level = 2;
      s.parentId = group.id;
    }
  }
  // never nest deeper than two levels
  for (const s of sections) {
    const p = sections.find((x) => x.id === s.parentId);
    if (p && p.level === 2) s.parentId = p.parentId;
    if (s.level === 2 && !s.parentId) s.level = 1;
  }
  // text under an "EXPLANATIONS" heading explains terms; it is reference, not a step to knit
  const isExplain = (sec?: Section): boolean => !!sec && (/^explanations?\b|explanations for/i.test(sec.title) || (sec.parentId ? isExplain(sections.find((x) => x.id === sec.parentId)) : false));
  for (const ins of instructions) {
    if (ins.kind === 'action' && isExplain(sections.find((x) => x.id === ins.sectionId))) ins.kind = 'info';
  }
  // an empty heading with no children is just noise
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i];
    if (!has(s) && !sections.some((c) => c.parentId === s.id)) sections.splice(i, 1);
  }
}

/* ------------------------------------------------------------------- parse */

export interface ParseOptions {
  fileId: string;
  fileName: string;
  id?: string;
  sourceType?: 'pdf' | 'text';
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
  const allLines = pages.flatMap((p) => p.lines);
  const lines = cleanLines(
    dropPageFurniture(pages)
      .flatMap((p) => p.lines)
      .filter((l) => !JUNK.some((r) => r.test(l.text)) && !captionLines.has(l)),
    // web pages repeat banners; a PDF repeats genuine pattern lines ("kfb, k1, SM] 4 times") and must keep them
    { dedupe: (opts.sourceType ?? 'pdf') === 'text' },
  );
  const blocks = buildBlocks(lines);

  // ---- front matter and labelled fields
  const p1 = pages[0];
  const BRAND = /\b(designs?|garnstudio)\s*$/i;
  const cands = (p1?.lines ?? [])
    .filter((l) => !/©|copyright/i.test(l.text) && !CAPTION_RE.test(l.text))
    .sort((a, b) => b.size - a.size || b.y - a.y);
  const brandLine = cands.find((l) => BRAND.test(l.text) && l.text.split(/\s+/).length <= 4);
  const titleLine = cands.find((l) => l !== brandLine) ?? cands[0];
  let title = titleLine?.text ?? opts.fileName.replace(/\.pdf$/i, '');
  let designer = brandLine?.text ?? '';
  const allText = allLines.map((l) => l.text).join(' ');
  if (!designer) {
    const cr = allText.match(/(?:copyright\s*©?|©)\s*([^.]+?)\.\s*All rights/i);
    if (cr) designer = cr[1].trim();
  }
  if (!designer) {
    const dm = allText.match(/\b([A-Z][\w]+ Design)\s*:/);
    if (dm) designer = dm[1];
  }
  if (!designer) {
    const by = allLines.slice(0, 40).find((l) => /^by\s+\S+/i.test(l.text));
    if (by) designer = by.text.replace(/^by\s+/i, '');
  }
  const suggestedSize = allText.match(/size\s+highlighted\s+below:\s*(\S+)/i)?.[1];

  let sizes: string[] = [];
  const measurements: Measurement[] = [];
  let materials = '';
  let needles = '';
  let gaugeRaw = '';
  let difficulty: string | undefined;
  let notions = '';
  const loose: string[] = [];
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
  let stickyPending = false;
  const applyField = (label: string, restAll: string[], page: number, append = false) => {
    abbrMode = false;
    const join = (prev: string) => (append && prev ? `${prev} ${restAll.join(' ')}` : restAll.join(' '));
    if (/^(sizes?|size)$/.test(label)) {
      sizes = parseSizeList(restAll.join(' '));
    } else if (/finished|measurements?/.test(label)) {
      for (const line of restAll) {
        const mm = line.match(/^([^:]+):\s*(.+)$/);
        if (!mm) continue;
        const groups = findSizeGroups(mm[2], sizes.length);
        // which list is inches and which is cm? decided by the unit printed next to it
        const isIn = (g: (typeof groups)[number]) => /["”″]/.test(g.raw) || /^\s*(in\b|inch)/i.test(mm[2].slice(g.end));
        const isCm = (g: (typeof groups)[number]) => /^\s*cm\b/i.test(mm[2].slice(g.end));
        const inG = groups.find(isIn) ?? groups.find((g) => !isCm(g));
        const cmG = groups.find((g) => g !== inG && (isCm(g) || !isIn(g))) ?? groups.find(isCm);
        measurements.push({
          id: `m${measurements.length + 1}`,
          label: mm[1].trim(),
          raw: line,
          inches: inG?.values,
          cm: cmG?.values,
          page,
        });
      }
    } else if (/^(materials?|yarn)$/.test(label)) {
      materials = join(materials);
    } else if (/^needles?$/.test(label)) {
      needles = join(needles);
    } else if (/^(buttons?|notions)$/.test(label)) {
      notions = join(notions);
    } else if (/^(gauge|tension|knitting gauge)$/.test(label)) {
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
        if (b.lines.some((l) => l.text === titleLine?.text || l.text === brandLine?.text)) continue;
        if (b.text.length > 80) description += (description ? ' ' : '') + b.text;
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
      const lm = first.match(LABEL_RE);
      if (lm?.groups) {
        const label = lm.groups.label.toLowerCase().replace(/\s+/g, ' ').replace(/^suggested /, '').replace(/^sizing$/, 'size');
        const restFirst = (lm.groups.rest ?? '').trim();
        const restAll = [restFirst, ...b.lines.slice(1).map((l) => l.text)].filter(Boolean);
        // a label alone on its line ("YARN:") takes the following blocks too, for list-like fields
        pendingLabel = restAll.length === 0 ? label : undefined;
        stickyPending = restAll.length === 0 && /^(materials?|yarn|needles?|buttons?|notions|finished|measurements?|skills|techniques)/.test(label);
        applyField(label, restAll, b.page);
        continue;
      }
      const hh = isHeadingBlock(b);
      // no heading at all? the first "Cast on / Work / Row 1" line starts the instructions
      const instrStart = /^(cast on|provisional cast on|work|knit|row\s*\d|round\s*\d|set-?up row)\b/i.test(first);
      const plainHeading = abbrMode && b.lines.length === 1 && /^[A-Z][A-Za-z ]{2,30}:?$/.test(first) && !/[–—-]/.test(first);
      const startsBody = (hh && hh.level === 1) || (!pendingLabel && (instrStart || plainHeading));
      if (startsBody) {
        pendingLabel = undefined;
        abbrMode = false;
        zone = 'body';
      } else {
        if (pendingLabel) {
          applyField(pendingLabel, b.lines.map((l) => l.text), b.page, true);
          if (!stickyPending) pendingLabel = undefined;
          continue;
        }
        if (abbrMode) {
          abbreviations.push(...parseAbbreviations(b.lines, b.page));
          continue;
        }
        loose.push(b.text);
        continue;
      }
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

    // "Row 1: ... Row 4: ... Repeat from row 1." -> row-based stitch pattern (rows may wrap over lines)
    const rowLines = b.lines.filter((l) => ROW_LINE.test(l.text));
    if (rowLines.length >= 2 && rowLines.every((l, i) => Number(l.text.match(ROW_LINE)![2]) === i + 1)) {
      const head: string[] = [];
      const rows: { n: number; text: string; side?: string; src: string[] }[] = [];
      let repeat = '';
      let cur: (typeof rows)[number] | undefined;
      for (const l of b.lines) {
        const m = l.text.match(ROW_LINE);
        if (m) {
          cur = { n: Number(m[2]), side: m[3]?.toUpperCase(), text: m[4].trim(), src: [l.text] };
          rows.push(cur);
        } else if (/^repeat\b/i.test(l.text) && rows.length) {
          repeat = l.text;
          cur = undefined;
        } else if (cur) {
          cur.text += ' ' + l.text;
          cur.src.push(l.text);
        } else head.push(l.text);
      }
      const nm = head.join(' ').match(/^(.*?)\s*(?::\s*multiple\s+of\s+(\d+))?\s*$/i);
      const unit = /^rou?nd|^rnd/i.test(rowLines[0].text) ? 'round' : 'row';
      const rep = repeat.match(/repeat\s+(?:from\s+)?(?:rows?|rounds?|rnds?)\s+(\d+)/i);
      const sp: StitchPattern = {
        id: `sp${++spN}`,
        name: (nm?.[1] || curSection?.title || (unit === 'row' ? 'Stitch pattern (rows)' : 'Stitch pattern (rounds)')).replace(/[:\s]+$/, '').trim(),
        unit,
        rows: rows.map((r) => ({ n: r.n, text: r.text, side: r.side })),
        repeatFrom: rep ? Number(rep[1]) : undefined,
        length: rows.length,
        multipleOf: nm?.[2] ? Number(nm[2]) : undefined,
        page: b.page,
      };
      stitchPatterns.push(sp);
      if (!curSection) addSection('Pattern notes', 1, b.page);
      const text = [...head, ...rows.map((r) => r.src.join(' ')), ...(repeat ? [repeat] : [])].join('\n');
      const ins = addInstruction(text, { page: b.page, lines: b.lines.map((l) => l.text) }, 'stitch-pattern');
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
    if (h) {
      // a sub-heading with no main heading above it becomes a main heading
      addSection(h.title, h.level === 2 && !curL1 ? 1 : h.level, b.page);
      continue;
    }
    if (/^(enjoy!?|pattern was updated.*)$/i.test(b.text)) continue;

    // "Make buttonholes when piece measures: / SIZE S: ... / SIZE M: ..." stays ONE instruction
    const sizeLines = b.lines.filter((l) => /^sizes?\s+\S+\s*:/i.test(l.text));
    if (sizeLines.length >= 3) {
      const intro = b.lines.slice(0, b.lines.indexOf(sizeLines[0])).map((l) => l.text).join(' ');
      const sents = splitAtSentences(intro);
      const lead = sents.pop() ?? '';
      for (const sx of sents) addInstruction(sx, { page: b.page, lines: [sx] });
      const text = [lead, ...sizeLines.map((l) => l.text)].filter(Boolean).join('\n');
      addInstruction(text, { page: b.page, lines: b.lines.map((l) => l.text) }, lead ? classify(lead) : 'info');
      continue;
    }

    // paragraph -> one or more instructions
    const sentences = splitSentences(b.text);
    const split = sentences.length >= 3 || b.text.length > 220;
    const units = split ? sentences : [b.text];
    for (const u of units) {
      addInstruction(u, { page: b.page, lines: split ? [u] : b.lines.map((l) => l.text) });
    }
  }

  // ---- fields printed without a label (needles + gauge in one sentence, button line, ...)
  if (!needles) {
    const n = loose.find((t) => /needles?\b/i.test(t) && /\d\s*mm|US\s*\d/i.test(t));
    if (n) needles = n.split(/\s+[–—-]\s+or\b/i)[0].replace(/\s+(?:or\s+)?size needed.*$/i, '').trim();
  }
  if (!gaugeRaw) {
    for (const t of loose) {
      const g = t.match(/\d+(?:\.\d+)?\s*(?:sts?|stitches)(?:\s+in\s+width)?\s*(?:x|×|and|by)\s*\d+(?:\.\d+)?\s*rows?.*/i);
      if (g) { gaugeRaw = g[0].replace(/\.$/, ''); break; }
    }
  }
  if (!notions) notions = loose.find((t) => /\bbuttons?\b/i.test(t)) ?? '';

  // ---- structure: headings with nothing under them group the headings that follow
  groupHeadings(sections, instructions);

  // ---- derived fields
  const sizeCount = sizes.length;
  if (!sizeCount) warn('needs-review', 'No size list found. Add sizes in the review screen.');
  if (!gaugeRaw) warn('needs-review', 'No gauge found.');

  {
    const scoped = applyScopes(instructions, sizes);
    instructions.splice(0, instructions.length, ...scoped);
  }
  if (!measurements.length) {
    const tbl = parseSizeTable(allLines.map((l) => l.text).join(' '), instructions, sizes, allLines[0]?.page ?? 1);
    measurements.push(...tbl.measurements);
    if (tbl.measurements.length) {
      // the printed table now lives in Project Data: drop its lines and the headings made of table rows
      const drop = new Set(tbl.tableInstructionIds);
      for (let k = instructions.length - 1; k >= 0; k--) if (drop.has(instructions[k].id)) instructions.splice(k, 1);
      const isTableTitle = (t: string) => /^(child sizes|adult sizes|yardage\*?|sizing table:?)$/i.test(t.trim()) || new RegExp(`^(?:${sizes.map((z) => z.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s+\\d+(?:\\.\\d+)?[”"]?\\s`).test(t.trim());
      for (let k = sections.length - 1; k >= 0; k--) {
        if (isTableTitle(sections[k].title) && !instructions.some((i) => i.sectionId === sections[k].id)) sections.splice(k, 1);
      }
    }
  }
  for (const ins of instructions) {
    if (ins.tableRow) continue;
    const reasons = sizeMismatchReasons(ins.text, sizeCount, ins.appliesTo?.length);
    if (reasons.length) {
      ins.review = [...(ins.review ?? []), ...reasons];
      warn('needs-review', reasons.join(' '), { instructionId: ins.id, page: ins.source.page });
    }
  }

  computeAppliesTo(sections, sizes);
  const { trackers } = detectTrackers(sections, instructions, stitchPatterns, sizes);
  for (const w of flagUnmodelledSimultaneous(instructions, trackers)) warn('needs-review', w.message, { instructionId: w.id, page: w.page });
  for (const t of trackers) {
    for (const r of t.review) warn('needs-review', `${t.title}: ${r}`, { page: instructions.find((i) => i.trackerId === t.id)?.source.page });
  }

  const weight = materials.match(/\b(lace|fingering|sock|sport|DK|light worsted|worsted|aran|bulky|super bulky|chunky)\b/i)?.[1];

  const now = Date.now();
  return {
    id: opts.id ?? uid(),
    schemaVersion: SCHEMA_VERSION,
    readerVersion: READER_VERSION,
    createdAt: now,
    updatedAt: now,
    fileId: opts.fileId,
    fileName: opts.fileName,
    pageCount: pages.length,
    sourceType: opts.sourceType ?? 'pdf',
    suggestedSize: suggestedSize && sizes.includes(suggestedSize.toUpperCase()) ? suggestedSize.toUpperCase() : undefined,
    notions: notions || undefined,
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
  const colour = p.yarn.description.match(/colou?r\s+(?:no\.?\s*)?(.+?)(?:\s+[-–]\s+\d|\s+\d[\d\s-]*\s?g\b|$)/i)?.[1]?.trim() ?? '';
  const needle = needlesMm(p.needles)?.split(', ')[0] ?? '';
  return { yarn, colour, needle };
}


/** Copy-and-paste import: same parser, layout inferred from the text. The pasted text is the source of truth. */
export function parsePastedText(text: string, opts: { title?: string; id?: string; fileId?: string }): Pattern {
  const pat = parsePattern(textToPages(text), {
    fileId: opts.fileId ?? `text-${uid()}`,
    fileName: 'Pasted text',
    id: opts.id,
    sourceType: 'text',
  });
  if (opts.title?.trim()) pat.title = opts.title.trim();
  pat.pageCount = 1;
  return pat;
}
