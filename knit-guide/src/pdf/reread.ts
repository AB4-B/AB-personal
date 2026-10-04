/**
 * Re-read a project's pattern from the PDF stored on the device with the current reader. Used when the reader has
 * been improved (two-column pages, size lists) after a project was created. The PDF itself is never touched.
 */
import { READER_VERSION, type Pattern, type Project } from '../model/types';
import { parsePastedText } from '../parser/parse';
import { finalizePattern } from '../parser/edit';
import { repo, useStore } from '../store/store';
import { importPdf } from './importPdf';

export const isStale = (p: Pattern) => (p.readerVersion ?? 1) < READER_VERSION;

/** A project nobody has knitted on yet (notes, mods and size choices do not depend on the reader): safe to re-read. */
export const isUntouched = (project: Project) => {
  const k = project.knit;
  return (
    !project.progress.completed.length &&
    !project.counters.length &&
    !project.stitchCounters.length &&
    !Object.keys(project.trackers).length &&
    !(k && (Object.keys(k.stepsDone ?? {}).length || Object.keys(k.checkpoints ?? {}).length || Object.keys(k.measurements ?? {}).length))
  );
};

export async function rereadPattern(project: Project): Promise<boolean> {
  const old = useStore.getState().patterns[project.patternId];
  if (!old) return false;
  const blob = await repo.getFile(old.fileId);
  if (!blob) return false;
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
  for (const [id, b] of Object.entries(images)) await repo.putFile(id, b);
  await repo.putPattern(next);
  useStore.setState((s) => ({ patterns: { ...s.patterns, [next.id]: next } }));
  return true;
}
