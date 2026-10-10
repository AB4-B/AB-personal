/**
 * Re-read a project's pattern from the PDF stored on the device with the current reader. Used when the reader has
 * been improved (two-column pages, size lists) after a project was created. The PDF itself is never touched.
 *
 * Progress is stored against instruction ids, and ids are positions (i1, i2, ...). So a project that has been knitted
 * on is only re-read when the new reading has the same instructions in the same order (the text may be repaired);
 * otherwise the old pattern is kept. A recovery point of the project and its old pattern is saved first.
 */
import { READER_VERSION, type Pattern, type Project } from '../model/types';
import { parsePastedText } from '../parser/parse';
import { finalizePattern } from '../parser/edit';
import { checkpointNow, repo, useStore } from '../store/store';
import { importPdf } from './importPdf';

export const isStale = (p: Pattern) => (p.readerVersion ?? 1) < READER_VERSION;

/** A project nobody has knitted on yet (notes, mods and size choices do not depend on the reader): safe to re-read. */
export const isUntouched = (project: Project) => {
  const k = project.knit;
  return (
    !project.progress.completed.length &&
    !project.progress.currentInstructionId &&
    !project.progress.lastStop &&
    !project.counters.length &&
    !project.stitchCounters.length &&
    !Object.keys(project.trackers).length &&
    !(k && (Object.keys(k.stepsDone ?? {}).length || Object.keys(k.checkpoints ?? {}).length || Object.keys(k.measurements ?? {}).length || Object.keys(k.phase ?? {}).length || Object.keys(k.eventsDone ?? {}).length || Object.keys(k.measured ?? {}).length))
  );
};

/** The same instructions, in the same order and of the same kind: ids still mean the same places. */
export function sameStructure(a: Pattern, b: Pattern): boolean {
  if (a.instructions.length !== b.instructions.length) return false;
  return a.instructions.every((x, i) => x.id === b.instructions[i].id && x.kind === b.instructions[i].kind && x.sectionId === b.instructions[i].sectionId);
}

export interface RereadResult {
  ok: boolean;
  message: string;
}

export async function rereadPattern(project: Project): Promise<RereadResult> {
  const old = useStore.getState().patterns[project.patternId];
  if (!old) return { ok: false, message: 'The pattern is missing, so nothing was changed.' };
  const blob = await repo.getFile(old.fileId);
  if (!blob) return { ok: false, message: 'The saved PDF is not on this phone, so nothing was changed.' };
  let next: Pattern;
  const images: Record<string, Blob> = {};
  if (old.sourceType === 'text') {
    next = parsePastedText(await blob.text(), { title: old.title, fileId: old.fileId });
  } else {
    const r = await importPdf(new File([blob], old.fileName, { type: 'application/pdf' }));
    next = r.pattern;
    Object.assign(images, r.imageBlobs);
  }
  next = finalizePattern({ ...next, id: old.id, fileId: old.fileId, fileName: old.fileName, createdAt: old.createdAt });
  const untouched = isUntouched(project);
  if (!untouched && !sameStructure(old, next)) {
    return { ok: false, message: 'Not re-read. Your knitting is in progress and the new reading has different instructions, so your place could move. The pattern was left exactly as it was.' };
  }
  if (!untouched) {
    const saved = await checkpointNow(project.id, 'before re-read');
    if (!saved) return { ok: false, message: 'Not re-read: a recovery point could not be saved first, so nothing was changed.' };
  }
  for (const [id, b] of Object.entries(images)) await repo.putFile(id, b);
  await repo.putPattern(next);
  useStore.setState((s) => ({ patterns: { ...s.patterns, [next.id]: next } }));
  return { ok: true, message: untouched ? '✓ Pattern re-read with the latest reader.' : '✓ Pattern text re-read. Your place and progress are unchanged. A recovery point of the old version was saved.' };
}
