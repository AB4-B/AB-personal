import { useState } from 'react';
import { guideCtxOf } from '../model/helpers';
import { analyzeResolution, groupKey, groupsFor, guideInstruction, type ReviewValue } from '../model/guide';
import type { Instruction, Pattern, Project } from '../model/types';
import { setOverride } from '../store/store';
import { Sheet } from '../ui/common';
import { ResolveSheet } from './RichText';

/** Opens the "choose my value" sheet for an uncertain size value and saves the answer as a project override. */
export function useResolver(project: Project, pattern: Pattern) {
  const [t, setT] = useState<{ ins: Instruction; review: ReviewValue }>();
  const open = (ins: Instruction, review: ReviewValue) => setT({ ins, review });
  const openKey = (key: string) => {
    const insId = key.split('#')[0];
    const ins = pattern.instructions.find((i) => i.id === insId);
    if (!ins) return;
    const g = guideInstruction(ins, guideCtxOf(pattern, project));
    let review = g.review.find((r) => r.key === key);
    if (!review) {
      const idx = Number(key.split('#')[1]);
      const grp = groupsFor(pattern, ins)[idx];
      if (!grp) return;
      review = { key: groupKey(ins.id, idx), raw: grp.raw, values: grp.values, reason: 'You confirmed this value by hand earlier.' };
    }
    setT({ ins, review });
  };
  const sheet = t ? (
    <ResolveSheet
      ins={t.ins}
      review={t.review}
      size={project.size}
      current={project.sizeOverrides?.[t.review.key]}
      onSave={(k, v) => setOverride(project.id, k, v)}
      onClose={() => setT(undefined)}
    />
  ) : null;
  return { open, openKey, sheet };
}

/** Guide banner: how many size values still need the knitter's confirmation. */
export function ResolutionBanner({ project, pattern }: { project: Project; pattern: Pattern }) {
  const [list, setList] = useState(false);
  const resolver = useResolver(project, pattern);
  const r = analyzeResolution(pattern, project.size, project.sizeOverrides ?? {});
  if (!r.needsReview.length) return null;
  return (
    <>
      <button className="warnbox review-box" style={{ width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => setList(true)} data-testid="resolution-banner">
        <b>⚠ {r.needsReview.length} size value{r.needsReview.length === 1 ? '' : 's'} need{r.needsReview.length === 1 ? 's' : ''} review</b>
        <span style={{ display: 'block' }}>Not guessed. Tap to choose your value for size {project.size}.</span>
      </button>
      {list && (
        <Sheet title="Size values to review" onClose={() => setList(false)}>
          <div className="stack">
            {r.needsReview.map(({ ins, review }) => (
              <button key={review.key} className="card" style={{ textAlign: 'left', font: 'inherit' }} onClick={() => { setList(false); resolver.open(ins, review); }}>
                <span className="pat-label">Original</span>
                <span className="pre">{ins.text}</span>
                <span className="badge review" style={{ marginTop: 6 }}>CHOOSE MY VALUE</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {resolver.sheet}
    </>
  );
}
