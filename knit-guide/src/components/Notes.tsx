import { useState } from 'react';
import { findInstruction, formatWhen, sectionTitle } from '../model/helpers';
import type { Note, NoteScope, Pattern, Project } from '../model/types';
import { addNote, deleteNote, editNote } from '../store/store';
import { ConfirmButton } from '../ui/common';

export function scopeLabel(n: Note, pattern: Pattern): string {
  switch (n.scope.type) {
    case 'project':
      return 'Project';
    case 'stop':
      return 'Stopping point';
    case 'section':
      return `Section: ${sectionTitle(pattern, n.scope.sectionId)}`;
    case 'instruction': {
      const ins = findInstruction(pattern, n.scope.instructionId);
      return `Instruction: ${ins ? ins.text.slice(0, 36) + (ins.text.length > 36 ? '…' : '') : ''}`;
    }
  }
}

export function NoteCard({ project, pattern, note, showScope = true }: { project: Project; pattern: Pattern; note: Note; showScope?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  if (editing) {
    return (
      <div className="note stack" style={{ flexDirection: 'column' }}>
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Edit note" />
        <div className="row">
          <button
            className="btn primary small"
            onClick={() => {
              if (text.trim()) editNote(project.id, note.id, text.trim());
              setEditing(false);
            }}
          >
            Save
          </button>
          <button className="btn ghost small" onClick={() => { setText(note.text); setEditing(false); }}>Cancel</button>
          <span className="grow" />
          <ConfirmButton label="Delete" onConfirm={() => deleteNote(project.id, note.id)} />
        </div>
      </div>
    );
  }
  return (
    <div className="note" data-testid="note">
      <div className="grow">
        {showScope && <div className="scope">{scopeLabel(note, pattern)}</div>}
        <div>{note.text}</div>
        <div className="when">{formatWhen(note.createdAt)}{note.updatedAt > note.createdAt + 1000 ? ' (edited)' : ''}</div>
      </div>
      <button className="btn small ghost" onClick={() => setEditing(true)}>Edit</button>
    </div>
  );
}

export function NoteComposer({ projectId, scope, placeholder = 'Write a note…', onSaved }: { projectId: string; scope: NoteScope; placeholder?: string; onSaved?: () => void }) {
  const [text, setText] = useState('');
  return (
    <div className="stack">
      <textarea className="textarea" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} aria-label="New note" />
      <button
        className="btn primary"
        disabled={!text.trim()}
        onClick={() => {
          addNote(projectId, scope, text.trim());
          setText('');
          onSaved?.();
        }}
      >
        SAVE NOTE
      </button>
    </div>
  );
}
