/**
 * Stage 3: heuristics that read knitting phrases out of instruction text.
 * Everything here is *suggestion* data. The designer's text is never changed, and
 * anything uncertain carries a review reason so the UI can show NEEDS REVIEW.
 */
import { groupKey, groupsFor, listSizesFor } from '../model/guide';
import { findSizeGroups, NUM_OR_GROUP_SRC, parseGroupValues, toNumber } from '../model/size';
import type {
  Instruction,
  Pattern,
  Section,
  StitchPattern,
  TrackerInterval,
  TrackerSpan,
  TrackerSpec,
} from '../model/types';

export type SuggestionKind = 'stitch' | 'rows' | 'rounds' | 'times';

export interface Suggestion {
  kind: SuggestionKind;
  label: string;
  /** one value per size when written as a size group, else a single value */
  values: string[];
  perSize: boolean;
  evidence: string;
  review?: string;
}

const NG = String.raw`(${NUM_OR_GROUP_SRC})`;

/** Turn a captured "50 [50, 54, 54, 54, 58]" / "11-11-13-13" / "12" into per-size raw values. */
export function valuesOf(captured: string): { values: string[]; perSize: boolean } {
  return parseGroupValues(captured);
}

function sizeReview(values: string[], perSize: boolean, sizeCount: number): string | undefined {
  if (perSize && sizeCount > 0 && values.length !== sizeCount) {
    return `Number list has ${values.length} values but the pattern has ${sizeCount} sizes - check the original.`;
  }
  return undefined;
}

export function detectSuggestions(text: string, sizeCount: number): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (kind: SuggestionKind, label: string, captured: string, evidence: string) => {
    const { values, perSize } = valuesOf(captured);
    out.push({ kind, label, values, perSize, evidence, review: sizeReview(values, perSize, sizeCount) });
  };

  const stitchRes: [RegExp, (n: string) => string][] = [
    [new RegExp(String.raw`\bcast(?:ing)?\s+on\s+${NG}\s*(?:sts?|stitches)?`, 'gi'), () => 'Cast on'],
    [new RegExp(String.raw`\bpick(?:ing)?\s+up(?:\s+and\s+knit)?\s+${NG}\s*(?:sts?|stitches)`, 'gi'), () => 'Pick up'],
    [new RegExp(String.raw`\b(?:increase|decrease)\s+to\s+${NG}\s*(?:sts?|stitches)`, 'gi'), () => 'Reach target'],
    [new RegExp(String.raw`\b(?:knit|work|purl)\s+the\s+next\s+${NG}\s*(?:sts?|stitches)`, 'gi'), () => 'Work next'],
  ];
  for (const [re, label] of stitchRes) {
    for (const m of text.matchAll(re)) {
      add('stitch', label(m[1]), m[1], m[0]);
    }
  }

  // rows / rounds: "for 44 (..) rows", "Work 3 rows", "Work 8 rounds"
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:for|work)\s+${NG}\s+(rows?|rounds?)\b`, 'gi'))) {
    const unit = m[2].toLowerCase().startsWith('round') ? 'rounds' : 'rows';
    add(unit, `${unit === 'rows' ? 'Rows' : 'Rounds'}`, m[1], m[0]);
  }
  // ranges: "Work 8-12 rows": target = upper bound, flagged
  for (const m of text.matchAll(/\bwork\s+(\d+)\s*[-–]\s*(\d+)\s+(rows?|rounds?)\b/gi)) {
    const unit = m[3].toLowerCase().startsWith('round') ? 'rounds' : 'rows';
    out.push({
      kind: unit,
      label: `${unit === 'rows' ? 'Rows' : 'Rounds'} (${m[1]}-${m[2]})`,
      values: [m[2]],
      perSize: false,
      evidence: m[0],
      review: `Pattern gives a range (${m[1]}-${m[2]}); target set to ${m[2]}. Adjust to taste.`,
    });
  }
  // repeats: "every 4th row 11 (..) times", "rep from * 5 times", "pattern repeat 2 (..) more times"
  for (const m of text.matchAll(new RegExp(String.raw`\bevery\s+\d+(?:st|nd|rd|th)\s+(?:row|round)\s+${NG}\s+times`, 'gi'))) {
    add('times', 'Repeats', m[1], m[0]);
  }
  for (const m of text.matchAll(new RegExp(String.raw`\brep(?:eat)?\s+from\s+\*\s+${NG}\s+times`, 'gi'))) {
    add('times', 'Repeats', m[1], m[0]);
  }
  for (const m of text.matchAll(new RegExp(String.raw`\brepeat\s+${NG}\s+(?:more\s+)?times`, 'gi'))) {
    add('times', 'Repeats', m[1], m[0]);
  }

  // de-duplicate identical labels by numbering them
  const seen = new Map<string, number>();
  for (const s of out) {
    const k = s.label;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
  }
  const counts = new Map<string, number>();
  for (const s of out) {
    if ((seen.get(s.label) ?? 0) > 1) {
      const n = (counts.get(s.label) ?? 0) + 1;
      counts.set(s.label, n);
      s.label = `${s.label} (${n})`;
    }
  }
  return out;
}

/** Size-group mismatches inside one instruction text -> review reasons. */
export function sizeMismatchReasons(text: string, sizeCount: number, scopeLen?: number): string[] {
  if (sizeCount === 0) return [];
  return findSizeGroups(text, sizeCount, scopeLen)
    .filter((g) => !g.matchesSizes)
    .map(
      (g) =>
        `"${g.raw}" lists ${g.values.length} numbers but the pattern has ${sizeCount} sizes - showing original only.`,
    );
}

/* ---------------------------------------------------------------- trackers */

const GROUP_STR = NUM_OR_GROUP_SRC;

/** Per-size values of a captured list + the override key of that list in its instruction. */
function listValues(ins: Instruction, captured: string, sizes: string[], sections: Section[]) {
  const { values: raw, perSize } = valuesOf(captured);
  if (!perSize) return { values: raw };
  const groups = groupsFor({ sections, sizes } as never, ins);
  const i = groups.findIndex((g) => g.raw === captured.trim());
  const key = i >= 0 ? groupKey(ins.id, i) : undefined;
  const list = listSizesFor({ sections, sizes } as never, ins);
  let values = raw;
  // a list written for a subset of sizes ("SIZES S, M, XL: 2-1-1-1-5") is spread over the full size list
  if (list.length !== sizes.length && raw.length === list.length) {
    values = sizes.map((sz) => {
      const j = list.indexOf(sz);
      return j >= 0 ? raw[j] : '';
    });
  }
  return { values, key };
}

function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function labelCase(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface Found {
  spans: TrackerSpan[];
  intervals: TrackerInterval[];
  spanKeyword?: string;
  parity?: TrackerSpec['parity'];
  lace: boolean;
  sources: string[];
  unit: 'row' | 'round';
}

function scanSection(
  instrs: Instruction[],
  idPrefix: string,
  titleOf: (ins: Instruction) => string,
  sizes: string[],
  sections: Section[],
): Found {
  const f: Found = { spans: [], intervals: [], lace: false, sources: [], unit: 'row' };
  let k = 0;
  let unitSet = false;
  for (const ins of instrs) {
    if (ins.kind !== 'action' && ins.kind !== 'info') continue;
    const t = ins.text;
    let used = false;

    if (/at the same time/i.test(t)) used = true;
    if (/lace\s+pattern/i.test(t)) {
      f.lace = true;
      used = true;
    }
    const kw = t.match(/\b([A-Za-z-]+)\s+(?:increases?|decreases?)\b/i);
    if (kw && /raglan|armhole|neck|waist|sleeve|body/i.test(kw[1]) && !f.spanKeyword) {
      f.spanKeyword = labelCase(kw[1]);
    }

    // chart spans: "Follow the Back Chart for 44 (..) rows"
    const spanRe = new RegExp(
      String.raw`(?:follow|continue\s+to\s+follow|continue\s+with)\s+the\s+(.+?)\s+for\s+(${GROUP_STR})\s+(rows?|rounds?)`,
      'i',
    );
    const sm = t.match(spanRe);
    if (sm) {
      const lv = listValues(ins, sm[2], sizes, sections);
      f.spans.push({
        id: `${idPrefix}-span${++k}`,
        name: sm[1].replace(/\s+/g, ' ').trim(),
        rows: lv.values,
        rowsKey: lv.key,
        sourceInstructionId: ins.id,
        stopsAfter: /then\s+continue\s+as\s+established,?\s+without/i.test(t),
      });
      if (!unitSet) { f.unit = /round/i.test(sm[3]) ? 'round' : 'row'; unitSet = true; }
      used = true;
    }

    // every Nth row/round [X times]; "(note)" may sit between the row and the count
    const ir = new RegExp(
      String.raw`every\s+(\d+)(?:st|nd|rd|th)\s+(row|round)(?:\s*\([^)]*\))?(?:\s+(${GROUP_STR})\s+times)?`,
      'i',
    );
    const im = t.match(ir);
    if (im) {
      const everyCount = (t.match(/every\s+\d+(?:st|nd|rd|th)\s+(?:row|round)/gi) ?? []).length;
      const complex = everyCount > 1 || /\bbut\b/i.test(t);
      const shape = t.match(/to\s+shape\s+the\s+([A-Za-z][A-Za-z -]*?)(?:[,.]|\s+(?:work|decrease|increase)\b)/i);
      const fromTitle = labelCase(titleOf(ins).toLowerCase().replace(/[:.]$/, ''));
      const label = shape
        ? /shaping$/i.test(shape[1])
          ? labelCase(shape[1])
          : `${labelCase(shape[1])} shaping`
        : fromTitle || 'Shaping';
      const explicit = t.match(/(?:starting|beginning|begin)\s+(?:on|at|with|from)?\s*(?:the\s+)?(?:row|round)\s+(\d+)/i);
      const tv = !complex && im[3] ? listValues(ins, im[3], sizes, sections) : undefined;
      f.intervals.push({
        id: `${idPrefix}-int${++k}`,
        label,
        every: Number(im[1]),
        times: tv?.values,
        timesKey: tv?.key,
        first: explicit ? Number(explicit[1]) : 1,
        firstAssumed: !explicit,
        excerpt: t,
        sourceInstructionId: ins.id,
        complex: complex || undefined,
      });
      if (!unitSet) { f.unit = /round/i.test(im[2]) ? 'round' : 'row'; unitSet = true; }
      used = true;
    }

    const par = t.match(/^(?:Row|Round)\s+2\s+and\s+all\s+even\s+(?:rows?|rounds?)\s*(?:\((RS|WS)\))?\s*:?\s*(.*)$/i);
    if (par) {
      f.parity = {
        evenSide: par[1] ? (par[1].toUpperCase() as 'WS' | 'RS') : undefined,
        text: t,
        sourceInstructionId: ins.id,
      };
      used = true;
    }
    if (used) f.sources.push(ins.id);
  }
  return f;
}

export function detectTrackers(
  sections: Section[],
  instructions: Instruction[],
  stitchPatterns: StitchPattern[],
  sizes: string[],
): { trackers: TrackerSpec[]; generated: Instruction[] } {
  const sizeCount = sizes.length;
  const trackers: TrackerSpec[] = [];
  const generated: Instruction[] = [];

  const consumed = new Set<string>();
  const insertAfter = new Map<string, string>();
  const titleOf = (ins: Instruction) => sections.find((x) => x.id === ins.sectionId)?.title ?? '';

  sections.forEach((sec, si) => {
    if (consumed.has(sec.id) || sec.appliesTo) return;
    // "Read the next 2 sections before continuing" -> those sections belong to this guide
    const own = instructions.filter((i) => i.sectionId === sec.id);
    const rn = own.map((i) => i.text.match(/read\s+the\s+next\s+(\d+)\s+sections?/i)).find(Boolean);
    const group = [sec, ...sections.slice(si + 1, si + 1 + (rn ? Number(rn[1]) : 0))];
    group.slice(1).forEach((g) => consumed.add(g.id));
    const ids = new Set(group.map((g) => g.id));
    const inSec = instructions.filter((i) => ids.has(i.sectionId));
    if (!inSec.length) return;
    const f = scanSection(inSec, `t${si}`, titleOf, sizes, sections);
    const shaping = f.spans.length > 0 || f.intervals.length > 0;
    if (!shaping) return;

    const lacePat = f.lace
      ? stitchPatterns.find((p) => p.unit === f.unit && p.rows.length > 1)
      : undefined;

    // where does this section end? "Row 45 (51, ..) (RS): ..." in a later instruction
    const lastSource = inSec.findIndex((i) => i.id === f.sources[f.sources.length - 1]);
    let endRows: string[] | undefined;
    const idx = instructions.indexOf(inSec[lastSource]);
    for (const later of instructions.slice(idx + 1)) {
      const dm = later.text.match(new RegExp(String.raw`^(?:Row|Round)\s+(${GROUP_STR})\s*(?:\((?:RS|WS)\))?\s*:`, 'i'));
      if (dm) {
        const { values } = valuesOf(dm[1]);
        endRows = values.map((v) => String((toNumber(v) ?? 1) - 1));
        break;
      }
    }
    if (!endRows && f.spans.length) {
      const sizes = Math.max(...f.spans.map((s) => s.rows.length));
      endRows = Array.from({ length: sizes }, (_, i) =>
        String(Math.max(...f.spans.map((s) => toNumber(s.rows[i]) ?? 0))),
      );
    }

    const review: string[] = [];
    for (const iv of f.intervals) {
      if (iv.complex) {
        review.push(`${iv.label}: this sentence combines several "every Nth ${f.unit}" rules. The app does not calculate it. Read the original.`);
        continue;
      }
      if (iv.firstAssumed) {
        review.push(
          `${iv.label}: the designer says "every ${ordinal(iv.every)} ${f.unit}" but not which ${f.unit} is first. Assumed ${f.unit} ${iv.first}. Check the chart and adjust below.`,
        );
      }
    }
    if (lacePat) {
      review.push(`Lace alignment assumed: ${f.unit} 1 = ${lacePat.name} ${f.unit} 1. Adjust below if your chart starts elsewhere.`);
    }
    if (f.spans.length) {
      review.push('Charts are pictures: the app cannot read stitch-by-stitch chart rows. Follow the original chart for those.');
    }
    for (const s of f.spans) {
      if (sizeCount && s.rows.length !== sizeCount) {
        review.push(`"${s.name}" row list has ${s.rows.length} values, expected ${sizeCount}.`);
      }
    }

    const id = `tracker-${sec.id}`;
    const spec: TrackerSpec = {
      id,
      title: `${sec.title}: ${f.unit}-by-${f.unit} guide`,
      unit: f.unit,
      sectionId: sec.id,
      firstRow: 1,
      lace: lacePat ? { stitchPatternId: lacePat.id, offset: 0 } : undefined,
      parity: f.parity,
      spans: f.spans,
      spanLabel: f.spanKeyword ? `${f.spanKeyword} increases` : 'Chart shaping',
      intervals: f.intervals,
      endRows,
      sourceInstructionIds: f.sources,
      review,
    };
    trackers.push(spec);
    const ownSrc = f.sources.filter((sid) => own.some((o) => o.id === sid));
    insertAfter.set(`ins-${id}`, ownSrc[ownSrc.length - 1] ?? own[own.length - 1].id);
    generated.push({
      id: `ins-${id}`,
      sectionId: sec.id,
      kind: 'tracker',
      text: spec.title,
      trackerId: id,
      generated: true,
      source: { page: inSec[lastSource]?.source.page ?? 1, lines: [], imageIds: [] },
      review,
    });
  });

  // insert each generated tracker after its last source instruction
  const all = [...instructions];
  for (const g of generated) {
    const spec = trackers.find((t) => t.id === g.trackerId)!;
    void spec;
    const lastId = insertAfter.get(g.id)!;
    const at = all.findIndex((i) => i.id === lastId);
    all.splice(at + 1, 0, g);
  }
  instructions.length = 0;
  instructions.push(...all);
  return { trackers, generated };
}

export type { Pattern };

/** "AT THE SAME TIME" instructions the row engine could not model: say so instead of guessing. */
export function flagUnmodelledSimultaneous(
  instructions: Instruction[],
  trackers: TrackerSpec[],
): { id: string; page: number; message: string }[] {
  const modelled = new Set(trackers.flatMap((t) => t.sourceInstructionIds));
  const out: { id: string; page: number; message: string }[] = [];
  for (const ins of instructions) {
    if (ins.kind === 'tracker' || modelled.has(ins.id) || !/at the same time/i.test(ins.text)) continue;
    const msg = 'Simultaneous instruction ("AT THE SAME TIME"): the app cannot track this one automatically. Read it together with the shaping it applies to.';
    ins.review = [...new Set([...(ins.review ?? []), msg])];
    out.push({ id: ins.id, page: ins.source.page, message: msg });
  }
  return out;
}
