/**
 * Simultaneous-instruction engine.
 *
 * ONE row number drives everything: the lace repeat position, "increase on every Nth row"
 * events and chart spans. Nothing is stored separately, so the counters cannot drift apart.
 * The engine only does arithmetic on numbers the designer printed; it never rewrites text.
 * Anything it had to assume is reported via `review` so the UI can show NEEDS REVIEW.
 */
import { toNumber } from '../model/size';
import type { StitchPattern, TrackerSpec, TrackerState } from '../model/types';

export interface TrackerContext {
  sizeIndex: number;
  sizeCount: number;
  state: Pick<TrackerState, 'firstOverrides' | 'laceOffset'>;
  stitchPatterns: StitchPattern[];
}

export interface ShapingLine {
  id: string;
  label: string;
  status: 'do' | 'none' | 'finished' | 'review';
  headline: string;
  detail?: string;
  /** designer's sentence, verbatim */
  excerpt?: string;
  sourceInstructionId: string;
  progress?: { done: number; total?: number };
  parts?: { name: string; active: boolean }[];
}

export interface RowReport {
  row: number;
  unit: 'row' | 'round';
  side?: 'RS' | 'WS';
  end?: number;
  beyondEnd: boolean;
  lace?: { n: number; of: number; text: string; patternName: string };
  plain?: { text: string; sourceInstructionId: string };
  shaping: ShapingLine[];
}

export function pick(values: string[] | undefined, sizeIndex: number, sizeCount: number): number | undefined {
  if (!values) return undefined;
  if (values.length === 1) return toNumber(values[0]);
  if (values.length !== sizeCount || sizeIndex < 0) return undefined;
  return toNumber(values[sizeIndex]);
}

const short = (name: string) => name.replace(/\bcharts?\b/gi, '').replace(/\s+/g, ' ').trim();

export function describeRow(spec: TrackerSpec, row: number, ctx: TrackerContext): RowReport {
  const { sizeIndex, sizeCount } = ctx;
  const end = pick(spec.endRows, sizeIndex, sizeCount);
  const side: RowReport['side'] =
    spec.unit === 'row' && spec.parity?.evenSide
      ? row % 2 === 0
        ? spec.parity.evenSide
        : spec.parity.evenSide === 'WS'
          ? 'RS'
          : 'WS'
      : undefined;
  const isEven = row % 2 === 0;
  const plainRow = !!spec.parity && isEven;

  let lace: RowReport['lace'];
  if (spec.lace) {
    const sp = ctx.stitchPatterns.find((p) => p.id === spec.lace!.stitchPatternId);
    if (sp && sp.rows.length) {
      const L = sp.rows.length;
      const off = ctx.state.laceOffset ?? spec.lace.offset;
      const n = ((((row - spec.firstRow + off) % L) + L) % L) + 1;
      lace = { n, of: L, text: sp.rows[n - 1].text, patternName: sp.name };
    }
  }

  const shaping: ShapingLine[] = [];

  // chart spans (e.g. raglan): one grouped line
  if (spec.spans.length) {
    const parts = spec.spans.map((s) => {
      const n = pick(s.rows, sizeIndex, sizeCount);
      return { name: short(s.name), n, active: n !== undefined && row <= n };
    });
    const unknown = parts.some((p) => p.n === undefined);
    const anyActive = parts.some((p) => p.active);
    const allActive = parts.every((p) => p.active);
    const first = spec.spans[0];
    if (unknown) {
      shaping.push({
        id: 'spans',
        label: spec.spanLabel,
        status: 'review',
        headline: 'NEEDS REVIEW',
        detail: 'The row counts for this size could not be resolved. Read the original instruction.',
        sourceInstructionId: first.sourceInstructionId,
      });
    } else {
      const status: ShapingLine['status'] = !anyActive ? 'finished' : plainRow ? 'none' : 'do';
      shaping.push({
        id: 'spans',
        label: spec.spanLabel,
        status,
        headline:
          status === 'finished'
            ? 'Finished - no more increases'
            : status === 'none'
              ? 'No increase (plain row)'
              : allActive
                ? 'Increase on every chart'
                : 'Increase on active charts only',
        detail: !allActive && anyActive ? 'Some charts have finished their rows.' : undefined,
        sourceInstructionId: first.sourceInstructionId,
        parts: parts.map((p) => ({ name: p.name, active: p.active })),
      });
    }
  }

  // "every Nth row X times"
  for (const iv of spec.intervals) {
    if (iv.complex) {
      shaping.push({
        id: iv.id,
        label: iv.label,
        status: 'review',
        headline: 'NEEDS REVIEW',
        detail: 'Several overlapping repeat rules. The app does not calculate this: read the original.',
        excerpt: iv.excerpt,
        sourceInstructionId: iv.sourceInstructionId,
      });
      continue;
    }
    const first = ctx.state.firstOverrides[iv.id] ?? iv.first;
    const total = iv.times ? pick(iv.times, sizeIndex, sizeCount) : undefined;
    if (iv.times && total === undefined) {
      shaping.push({
        id: iv.id,
        label: iv.label,
        status: 'review',
        headline: 'NEEDS REVIEW',
        detail: 'The repeat count for this size could not be resolved. Read the original instruction.',
        excerpt: iv.excerpt,
        sourceInstructionId: iv.sourceInstructionId,
      });
      continue;
    }
    const sinceFirst = row - first;
    const onCycle = sinceFirst >= 0 && sinceFirst % iv.every === 0;
    const eventNo = sinceFirst >= 0 ? Math.floor(sinceFirst / iv.every) + 1 : 0;
    const completedBefore = sinceFirst <= 0 ? 0 : Math.min(total ?? Infinity, Math.ceil(sinceFirst / iv.every));
    const finished = total !== undefined && onCycle && eventNo > total;
    const allDone = total !== undefined && completedBefore >= total && !(onCycle && eventNo <= total);
    if (onCycle && (total === undefined || eventNo <= total)) {
      shaping.push({
        id: iv.id,
        label: iv.label,
        status: 'do',
        headline: total !== undefined ? `Shaping row ${eventNo} of ${total}` : `Shaping row ${eventNo}`,
        detail: 'Do the designer\'s shaping on this row (see original below).',
        excerpt: iv.excerpt,
        sourceInstructionId: iv.sourceInstructionId,
        progress: { done: eventNo - 1, total },
      });
    } else if (finished || allDone) {
      shaping.push({
        id: iv.id,
        label: iv.label,
        status: 'finished',
        headline: `Complete (${total} of ${total})`,
        excerpt: iv.excerpt,
        sourceInstructionId: iv.sourceInstructionId,
        progress: { done: total!, total },
      });
    } else {
      const next = sinceFirst < 0 ? first : first + Math.ceil(sinceFirst / iv.every) * iv.every;
      shaping.push({
        id: iv.id,
        label: iv.label,
        status: 'none',
        headline: 'No shaping',
        detail: `Next on ${spec.unit} ${next}.`,
        excerpt: iv.excerpt,
        sourceInstructionId: iv.sourceInstructionId,
        progress: { done: completedBefore, total },
      });
    }
  }

  return {
    row,
    unit: spec.unit,
    side,
    end,
    beyondEnd: end !== undefined && row > end,
    lace,
    plain: plainRow && spec.parity ? { text: spec.parity.text, sourceInstructionId: spec.parity.sourceInstructionId } : undefined,
    shaping,
  };
}

/** Number of shaping events that have been completed once `row` has been worked (inclusive). */
export function eventsDone(every: number, first: number, row: number, total?: number): number {
  if (row < first) return 0;
  const n = Math.floor((row - first) / every) + 1;
  return total === undefined ? n : Math.min(n, total);
}
