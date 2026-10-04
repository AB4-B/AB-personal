/**
 * Size scopes inside a section: "Sizes XL (XXL, 3XL) only:", "XXL (3XL, 4XL): k0 (0, 2) …", "All sizes: …".
 * The text of an instruction is never rewritten; a scoped piece records which sizes it is written for,
 * so its own number lists ("k0 (0, 0, 2, 0)" = 5 numbers for 5 sizes) resolve against that shorter list.
 */
import { parseSizeList } from '../model/size';
import type { Instruction } from '../model/types';

const MARKER =
  /(^|\s)(All sizes\s*:|Sizes?\s+[^:.]{1,90}?\s*:|[A-Za-z0-9]+(?:-\d+)?(?: mo| yrs?)?\s*\([^)]{1,90}\)\s*:)/g;

type Scope = string[] | undefined | 'all';

function sizesIn(spec: string, sizes: string[]): string[] | undefined {
  const upper = sizes.map((s) => s.toUpperCase());
  const idx = (t: string) => upper.indexOf(t.trim().toUpperCase());
  const range = spec.match(/^(.+?)\s+(?:to|through)\s+(.+)$/i);
  if (range) {
    const a = idx(range[1]);
    const b = idx(range[2]);
    return a >= 0 && b >= a ? sizes.slice(a, b + 1) : undefined;
  }
  const toks = parseSizeList(spec);
  if (!toks.length || !toks.every((t) => idx(t) >= 0)) return undefined;
  const set = new Set(toks.map((t) => idx(t)));
  return sizes.filter((_, i) => set.has(i));
}

function parseMarker(m: string, sizes: string[]): Scope | null {
  const t = m.trim().replace(/\s*:$/, '');
  if (/^all sizes$/i.test(t)) return 'all';
  const sz = t.match(/^sizes?\s+(.+?)(?:\s+only)?$/i);
  if (sz) return sizesIn(sz[1], sizes) ?? null;
  const tok = t.match(/^(\S+(?: mo| yrs?)?)\s*\(([^)]+)\)$/i);
  if (tok) return sizesIn(`${tok[1]}, ${tok[2]}`, sizes) ?? null;
  return null;
}

export function applyScopes(instructions: Instruction[], sizes: string[]): Instruction[] {
  if (sizes.length < 2) return instructions;
  const out: Instruction[] = [];
  let block: string[] | undefined;
  let section = '';
  // a size note printed right after a stitch pattern ("Sizes 0-6 mo to L: proceed …") is its own instruction
  const expanded: Instruction[] = [];
  for (const ins of instructions) {
    if (ins.kind === 'stitch-pattern') {
      const m = [...ins.text.matchAll(MARKER)].find((x) => parseMarker(x[2], sizes) !== null);
      if (m) {
        const at = m.index! + m[1].length;
        const head = ins.text.slice(0, at).trim();
        const tail = ins.text.slice(at).trim();
        expanded.push({ ...ins, text: head, source: { ...ins.source, lines: ins.source.lines.slice(0, Math.max(1, ins.source.lines.length - 1)) } });
        expanded.push({ ...ins, id: `${ins.id}.t`, kind: 'action', text: tail, stitchPatternId: undefined, source: { ...ins.source, lines: [tail], imageIds: [] } });
        continue;
      }
    }
    expanded.push(ins);
  }
  for (const ins of expanded) {
    if (ins.sectionId !== section) {
      section = ins.sectionId;
      block = undefined;
    }
    if (ins.kind === 'stitch-pattern' || ins.kind === 'tracker') {
      out.push(block ? { ...ins, appliesTo: block } : ins);
      continue;
    }
    const marks: { start: number; end: number; scope: Scope }[] = [];
    for (const m of ins.text.matchAll(MARKER)) {
      const sc = parseMarker(m[2], sizes);
      if (sc === null) continue;
      const start = m.index! + m[1].length;
      marks.push({ start, end: m.index! + m[0].length, scope: sc });
    }
    if (!marks.length) {
      out.push(block ? { ...ins, appliesTo: block } : ins);
      continue;
    }
    const pieces: { text: string; marker?: string; scope: Scope }[] = [];
    const head = ins.text.slice(0, marks[0].start).trim();
    if (head) pieces.push({ text: head, scope: block ?? undefined });
    marks.forEach((mk, i) => {
      let rest = ins.text.slice(mk.end, marks[i + 1]?.start ?? ins.text.length).trim();
      const marker = ins.text.slice(mk.start, mk.end).trim();
      // a scoped sentence ends at its closing bracket when a new capitalised sentence follows without a full stop
      const cut = mk.scope === 'all' ? null : rest.match(/\]\s+(?=[A-Z][a-z]+\s)/);
      if (cut && cut.index !== undefined && i === marks.length - 1) {
        pieces.push({ text: rest.slice(0, cut.index + 1).trim(), marker, scope: mk.scope });
        rest = rest.slice(cut.index + cut[0].length).trim();
        pieces.push({ text: rest, scope: block });
        return;
      }
      pieces.push({ text: rest, marker, scope: mk.scope });
    });
    pieces.forEach((pc, k) => {
      const id = k === 0 ? ins.id : `${ins.id}.${k}`;
      if (pc.marker && !pc.text) {
        // a bare marker: sets the scope for what follows
        block = pc.scope === 'all' ? undefined : pc.scope;
        out.push({ ...ins, id, kind: 'info', text: pc.marker, appliesTo: undefined, scopeMarker: true, source: { ...ins.source, lines: [pc.marker] } });
        return;
      }
      let scope: string[] | undefined;
      if (pc.marker) {
        if (pc.scope === 'all') block = undefined;
        scope = pc.scope === 'all' ? undefined : pc.scope;
      } else scope = block;
      const lines = pc.marker ? [`${pc.marker} ${pc.text}`] : [pc.text];
      out.push({ ...ins, id, text: pc.text, appliesTo: scope, source: { ...ins.source, lines, imageIds: k === 0 ? ins.source.imageIds : [] } });
    });
  }
  return out;
}
