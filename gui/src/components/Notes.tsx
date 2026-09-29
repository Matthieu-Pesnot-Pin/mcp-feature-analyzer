import { useState } from 'react'
import type { Note } from '@shared/schemas/analysis.schema'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { formatDateTime } from '../utils/format'
import { Icon } from './Icon'
import { NotePill } from './Pills'

/** Remarque du relecteur affichée dans le diff, avec sa suppression. */
export function NoteCard({ note }: { note: Note }) {
  const deleteNote = useAnalysisStore((state) => state.deleteNote)
  const saving = useAnalysisStore((state) => state.saving)
  const where = note.location?.line ? `ligne ${note.location.line}` : 'fichier entier'

  return (
    <div className="note-card">
      <div className="note-head">
        <NotePill fixed={false} />
        <span className="note-meta">
          {where} · {formatDateTime(note.createdAt)}
        </span>
        <button type="button" className="link-button muted" disabled={saving} onClick={() => void deleteNote(note.id)}>
          <Icon name="trash" size={13} />
          Supprimer
        </button>
      </div>
      <p className="note-text">{note.text}</p>
    </div>
  )
}

/** Saisie d'une remarque sur une ligne (`line`) ou sur le fichier entier (`line` null). */
export function NoteComposer({ path, line, onClose }: { path: string; line: number | null; onClose: () => void }) {
  const addNote = useAnalysisStore((state) => state.addNote)
  const saving = useAnalysisStore((state) => state.saving)
  const [text, setText] = useState('')

  const submit = async () => {
    if (text.trim() === '') return
    if (await addNote(path, line, text.trim())) onClose()
  }

  return (
    <form
      className="note-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="note-composer-label" htmlFor={`note-${line ?? 'file'}`}>
        {line === null ? 'Remarque sur le fichier' : `Remarque sur la ligne ${line}`}
      </label>
      <textarea
        id={`note-${line ?? 'file'}`}
        autoFocus
        rows={3}
        value={text}
        placeholder="Ce que l'agent doit revoir…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div className="note-composer-actions">
        <span className="hint">Ctrl + Entrée pour enregistrer · Échap pour annuler</span>
        <button type="button" className="button button-ghost" onClick={onClose}>
          Annuler
        </button>
        <button type="submit" className="button button-primary button-small" disabled={saving || text.trim() === ''}>
          Enregistrer la remarque
        </button>
      </div>
    </form>
  )
}
