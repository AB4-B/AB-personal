import { useState } from 'react';
import { BUILTIN, tokenizeAbbreviations, type TermInfo } from '../engine/explain';
import { splitBySizeGroups } from '../model/size';
import type { Abbreviation, Pattern } from '../model/types';
import { Sheet } from '../ui/common';

/**
 * Instruction text: designer's words with the selected size's numbers highlighted
 * (tap "Original" to see the untouched multi-size text) and tappable abbreviations.
 */
export function RichText({ text, pattern, sizeIndex, original, onTerm }: { text: string; pattern: Pattern; sizeIndex: number; original?: boolean; onTerm: (t: TermInfo) => void }) {
  const abbrs: Abbreviation[] = pattern.abbreviations;
  const terms = (s: string, key: string) =>
    tokenizeAbbreviations(s, abbrs).map((p, i) =>
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

  if (original) return <span className="pre">{terms(text, 'o')}</span>;
  const parts = splitBySizeGroups(text, pattern.sizes, sizeIndex);
  return (
    <span className="pre">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          terms(p.text, `t${i}`)
        ) : p.type === 'size' ? (
          <span key={i} className="size-val" title={`Original: ${p.raw}`} data-size-value>{p.value}</span>
        ) : (
          <span key={i} className="size-bad" title="Could not match this number list to the sizes">{p.raw}</span>
        ),
      )}
    </span>
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
