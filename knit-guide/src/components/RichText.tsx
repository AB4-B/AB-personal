import { useMemo, useState } from 'react';
import { BUILTIN, tokenizeAbbreviations, type TermInfo } from '../engine/explain';
import { guideInstruction, type GuideCtx, type ReviewValue } from '../model/guide';
import type { Abbreviation, Instruction, Pattern } from '../model/types';
import { Sheet } from '../ui/common';

/** Plain text with tappable abbreviations (no size logic). */
export function RichText({ text, pattern, onTerm }: { text: string; pattern: Pattern; onTerm: (t: TermInfo) => void }) {
  return <span className="pre">{terms(text, pattern.abbreviations, onTerm, 'r')}</span>;
}

function terms(s: string, abbrs: Abbreviation[], onTerm: (t: TermInfo) => void, key: string) {
  return tokenizeAbbreviations(s, abbrs).map((p, i) =>
    p.type === 'text' ? (
      <span key={`${key}-${i}`}>{p.text}</span>
    ) : (
      <button
        key={`${key}-${i}`}
        className="abbr"
        onClick={(e) => {
          e.stopPropagation();
          onTerm(p.info);
        }}
      >
        {p.text}
      </button>
    ),
  );
}

/**
 * The GUIDED instruction: one size only, metric only. Values that cannot be mapped safely show
 * ⚠ SIZE VALUE NEEDS REVIEW with the exact original instruction underneath and a way to resolve them.
 */
export function GuidedText({ ins, ctx, onTerm, onResolve, hideReviewBox }: { ins: Instruction; ctx: GuideCtx; onTerm: (t: TermInfo) => void; onResolve: (ins: Instruction, v: ReviewValue) => void; hideReviewBox?: boolean }) {
  const g = useMemo(() => guideInstruction(ins, ctx), [ins, ctx.pattern, ctx.size, ctx.overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  if (g.hidden) return null;
  return (
    <span data-testid="guided-text">
      <span className="pre">
        {g.parts.map((p, i) =>
          p.type === 'text' ? (
            terms(p.text, ctx.pattern.abbreviations, onTerm, `g${i}`)
          ) : (
            <button
              key={i}
              className="review-chip"
              data-testid="size-review-chip"
              onClick={(e) => {
                e.stopPropagation();
                const v = g.review.find((r) => r.key === p.key);
                if (v) onResolve(ins, v);
              }}
            >
              ⚠ SIZE VALUE NEEDS REVIEW
            </button>
          ),
        )}
      </span>
      {g.review.length > 0 && !hideReviewBox && (
        <span className="warnbox review-box" style={{ display: 'block', marginTop: 8 }} data-testid="size-review-box">
          <b>⚠ SIZE VALUE NEEDS REVIEW</b>
          <span style={{ display: 'block', margin: '4px 0' }}>{g.review[0].reason}</span>
          <span className="pat-label">Original</span>
          <span className="pre" style={{ display: 'block', marginBottom: 8 }}>{ins.text}</span>
          <button className="btn small" data-testid="choose-value" onClick={(e) => { e.stopPropagation(); onResolve(ins, g.review[0]); }}>CHOOSE MY VALUE</button>
        </span>
      )}
      {g.measurementFlags.length > 0 && (
        <span className="warnbox" style={{ display: 'block', marginTop: 8 }} data-testid="measurement-review">
          <b>⚠ MEASUREMENT NEEDS REVIEW</b>
          {g.measurementFlags.map((f, i) => <span key={i} style={{ display: 'block' }}>{f}</span>)}
          <span className="tiny">Original: {ins.text}</span>
        </span>
      )}
    </span>
  );
}

/** Pick or type the value for a list that could not be mapped to the size. Saved as a project override only. */
export function ResolveSheet({ ins, review, size, current, onSave, onClose }: { ins: Instruction; review: ReviewValue; size: string; current?: string; onSave: (key: string, value: string | null) => void; onClose: () => void }) {
  const [manual, setManual] = useState(current ?? '');
  const distinct = [...new Set(review.values)];
  return (
    <Sheet title="Size value needs review" onClose={onClose}>
      <div className="stack" data-testid="resolve-sheet">
        <div className="warnbox"><b>⚠ SIZE VALUE NEEDS REVIEW</b><br />{review.reason} Nothing was chosen automatically.</div>
        <div className="card">
          <span className="pat-label">Original</span>
          <div className="pre">{ins.text}</div>
        </div>
        {review.values.length > 0 && (
          <div className="field">
            <label>The numbers in the original</label>
            <div className="chips" style={{ marginTop: 0 }}>
              {review.values.map((v, i) => (
                <span key={i} className="chip" style={{ cursor: 'default' }}>{v}</span>
              ))}
            </div>
            <span className="tiny muted">Pick the one that is right for size {size}, or type it below.</span>
            <div className="chips" style={{ marginTop: 6 }}>
              {distinct.map((v) => (
                <button key={v} className="chip suggest" onClick={() => setManual(v)} data-testid={`pick-${v}`}>Use {v}</button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="ov">My value for size {size}</label>
          <input id="ov" className="input" value={manual} onChange={(e) => setManual(e.target.value)} inputMode="text" data-testid="override-input" />
        </div>
        <button className="btn primary" disabled={!manual.trim()} onClick={() => { onSave(review.key, manual.trim()); onClose(); }} data-testid="override-save">CONFIRM MY VALUE</button>
        {current !== undefined && <button className="btn ghost" onClick={() => { onSave(review.key, null); onClose(); }}>Remove my value</button>}
        <p className="muted small-text" style={{ margin: 0 }}>Saved for this project only. The pattern itself is never changed.</p>
      </div>
    </Sheet>
  );
}

export function AbbrSheet({ info, onClose }: { info: TermInfo; onClose: () => void }) {
  const b = BUILTIN[info.key];
  return (
    <Sheet title={info.display} onClose={onClose}>
      <div data-testid="abbr-sheet" className="stack">
        {b && <div className="formula" style={{ fontSize: 28, textTransform: 'uppercase' }}>{b.name}</div>}
        {info.fromPattern && (
          <div className="card">
            <span className="pat-label">From the pattern</span>
            {info.fromPattern}
          </div>
        )}
        {b && (
          <div className="card flat">
            <span className="pat-label guide">Guidance (not from the designer)</span>
            {b.plain}
          </div>
        )}
        {!info.fromPattern && <p className="muted small-text">This pattern's abbreviation list does not define this term.</p>}
      </div>
    </Sheet>
  );
}

export function useAbbrSheet() {
  const [term, setTerm] = useState<TermInfo>();
  return { term, setTerm, sheet: term ? <AbbrSheet info={term} onClose={() => setTerm(undefined)} /> : null };
}
