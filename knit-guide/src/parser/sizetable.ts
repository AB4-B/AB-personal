/**
 * A printed sizing table ("Size a b1 b2 … / 0-6 mo 18” 2” …") with a letter legend ("a - chest circumference")
 * becomes per-size measurements, so PROJECT DATA can show the selected size in metric.
 * Nothing is guessed: a row is used only when it has exactly one value per column.
 */
import type { Instruction, Measurement } from '../model/types';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface SizeTableResult {
  measurements: Measurement[];
  /** instruction ids that only hold the table / legend (not knitting instructions) */
  tableInstructionIds: string[];
}

export function parseSizeTable(text: string, instructions: Instruction[], sizes: string[], page: number): SizeTableResult {
  const none: SizeTableResult = { measurements: [], tableInstructionIds: [] };
  if (sizes.length < 3) return none;
  const all = text;
  const head = all.match(/\bSize((?:\s+[a-z]\d?){5,})(?=\s+\S)/);
  if (!head) return none;
  const cols = head[1].trim().split(/\s+/);
  const n = cols.length;

  const rows = new Map<string, string[]>();
  for (const size of sizes) {
    const m = all.match(new RegExp(`(?:^|\\s)${esc(size)}\\s+((?:\\d+(?:\\.\\d+)?[”"]?(?:\\s+|$)){${n}})`));
    if (m) rows.set(size, m[1].trim().split(/\s+/).map((v) => v.replace(/[”"]/g, '')));
  }
  // a table that does not cover every size would silently give wrong values to some sizes
  if (rows.size !== sizes.length) return none;

  const label = (id: string) => {
    const m = all.match(new RegExp(`(?:^|\\s)${id} - (.+?)(?=\\s+[a-e]\\d? - |\\s+yardage|\\s+Lengths|\\s+The sizing|\\s+Choose|\\s+plus|\\s+Size\\s|$)`));
    const t = m?.[1].trim() ?? id;
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  const seen = new Set<string>();
  const out: Measurement[] = [];
  cols.forEach((id, i) => {
    const values = sizes.map((s) => rows.get(s)![i]);
    if (!seen.has(id)) {
      seen.add(id);
      out.push({ id: `t-${id}`, label: label(id), raw: `${id}: ${values.join(', ')}`, inches: values, page });
    } else {
      // a repeated letter after the lengths is the yardage block (yards in the source, metres here)
      const m = values.map((v) => String(Math.round((Number(v) * 0.9144) / 5) * 5));
      out.push({ id: `t-${id}-yd`, label: `Yarn for ${/cropped/i.test(label(id)) ? 'cropped' : /regular/i.test(label(id)) ? 'regular' : id} length (long sleeves)`, raw: `${id}: ${values.join(', ')} yards`, m, page });
    }
  });

  const ids = instructions
    .filter((i) => /^Size(?:\s+[a-z]\d?){5,}/.test(i.text) || new RegExp(`^(?:${sizes.map(esc).join('|')})\\s+\\d+(?:\\.\\d+)?[”"]?\\s`).test(i.text) || /^[a-e]\d? - /.test(i.text))
    .map((i) => i.id);
  return { measurements: out, tableInstructionIds: ids };
}
