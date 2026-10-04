/** Stitch counter maths: count in groups (default 10) plus loose stitches. */

export interface StitchView {
  total: number;
  groups: number;
  remainder: number;
  remaining: number;
  over: number;
  complete: boolean;
  /** "16 × 10 + 4 = 164" */
  formula: string;
}

export function stitchView(total: number, target: number, groupSize: number): StitchView {
  const g = Math.max(1, groupSize);
  const groups = Math.floor(total / g);
  const remainder = total % g;
  return {
    total,
    groups,
    remainder,
    remaining: Math.max(0, target - total),
    over: Math.max(0, total - target),
    complete: total >= target,
    formula: `${groups} × ${g} + ${remainder} = ${total}`,
  };
}

export const clampTotal = (n: number) => Math.max(0, Math.round(n));
