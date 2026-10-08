import { useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/schemas/analysis.schema'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { formatDateTime, formatShortDateTime } from '../utils/format'
import { Icon } from './Icon'
import { NotePill } from './Pills'

/** Remarque du relecteur affichée dans le diff, avec sa modification et sa suppression. */
export function NoteCard({ note }: { note: Note }) {
  const updateNote = useAnalysisStore((state) => state.updateNote)
  const deleteNote = useAnalysisStore((state) => state.deleteNote)
  const saving = useAnalysisStore((state) => state.saving)
  const [editing, setEditing] = useState(false)
  const where = note.location?.line ? `ligne ${note.location.line}` : 'fichier entier'

  if (editing) {
    return (
      <NoteForm
        id={`note-edit-${note.id}`}
        label={`Modifier la remarque (${where})`}
        initialText={note.text}
        submitLabel="Enregistrer la modification"
        onSubmit={(text) => (text === note.text ? Promise.resolve(true) : updateNote(note.id, text))}
        onClose={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="note-card">
      <div className="note-head">
        <NotePill fixed={false} />
        <span className="note-meta" title={`${where} · ${formatDateTime(note.createdAt)}`}>
          {where} · {formatShortDateTime(note.createdAt)}
        </span>
        <button type="button" className="link-button muted" disabled={saving} onClick={() => setEditing(true)}>
          <Icon name="pencil" size={13} />
          Modifier
        </button>
        <button type="button" className="link-button muted" disabled={saving} onClick={() => void deleteNote(note.id)}>
          <Icon name="trash" size={13} />
          Supprimer
        </button>
      </div>
      <p className="note-text">{note.text}</p>
    </div>
  )
}

/**
 * Saisie d'une remarque sur une ligne (`line`) ou sur le fichier entier (`line` null),
 * liée au constat `findingId` quand elle y répond.
 */
export function NoteComposer({
  path,
  line,
  findingId,
  onClose,
}: {
  path: string
  line: number | null
  findingId: string | null
  onClose: () => void
}) {
  const addNote = useAnalysisStore((state) => state.addNote)

  return (
    <NoteForm
      id={`note-${line ?? 'file'}`}
      label={line === null ? 'Remarque sur le fichier' : `Remarque sur la ligne ${line}`}
      initialText=""
      submitLabel="Enregistrer la remarque"
      onSubmit={(text) => addNote(path, line, text, findingId)}
      onClose={onClose}
    />
  )
}

/**
 * Formulaire de texte d'une remarque : `onSubmit` reçoit le texte épuré et renvoie
 * true quand il est enregistré. Le champ reçoit le focus une fois la carte placée
 * dans la marge, pour que le navigateur fasse défiler jusqu'à sa position réelle.
 */
function NoteForm({
  id,
  label,
  initialText,
  submitLabel,
  onSubmit,
  onClose,
}: {
  id: string
  label: string
  initialText: string
  submitLabel: string
  onSubmit: (text: string) => Promise<boolean>
  onClose: () => void
}) {
  const saving = useAnalysisStore((state) => state.saving)
  const [text, setText] = useState(initialText)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => fieldRef.current?.focus(), [])

  const submit = async () => {
    if (text.trim() === '') return
    if (await onSubmit(text.trim())) onClose()
  }

  return (
    <form
      className="note-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="note-composer-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        ref={fieldRef}
        rows={3}
        value={text}
        placeholder="Ce que l'agent doit revoir…"
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
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
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
