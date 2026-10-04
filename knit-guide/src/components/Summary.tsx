import { resolveText } from '../model/size';
import type { Pattern, Project } from '../model/types';
import { findInstruction, sectionTitle, formatWhen, relevantNote, sizeIndexOf } from '../model/helpers';
import { positionSummary } from '../store/store';

/** Content for the CONTINUE KNITTING card. */
export function resumeInfo(project: Project, pattern: Pattern) {
  const ins = findInstruction(pattern, project.progress.currentInstructionId);
  if (!ins) return undefined;
  const idx = sizeIndexOf(pattern, project);
  const snippet = resolveText(ins.text, pattern.sizes, idx).replace(/\s+/g, ' ');
  const note = relevantNote(project, pattern);
  return {
    section: sectionTitle(pattern, ins.sectionId),
    snippet: snippet.length > 70 ? snippet.slice(0, 68) + '…' : snippet,
    position: positionSummary(project, pattern),
    when: formatWhen(project.progress.lastStop?.at ?? project.lastWorkedAt),
    note: note?.text,
  };
}
