import { useEffect, useRef, useState } from 'react'
import type { Note, NoteQuestion } from '@shared/schemas/analysis.schema'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { formatDateTime, formatShortDateTime } from '../utils/format'
import { Icon } from './Icon'
import { NotePill, QuestionPill } from './Pills'

/** Remarque du relecteur affichée dans le diff ; une question envoyée à l'agent a sa propre carte. */
export function NoteCard({ note }: { note: Note }) {
  if (note.question !== null) return <QuestionCard note={note} question={note.question} />
  return <RemarkCard note={note} />
}

function whereOf(note: Note): string {
  return note.location?.line ? `ligne ${note.location.line}` : 'fichier entier'
}

/** Remarque transmise en fin de revue, avec sa modification et sa suppression. */
function RemarkCard({ note }: { note: Note }) {
  const updateNote = useAnalysisStore((state) => state.updateNote)
  const deleteNote = useAnalysisStore((state) => state.deleteNote)
  const saving = useAnalysisStore((state) => state.saving)
  const [editing, setEditing] = useState(false)
  const where = whereOf(note)

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

/** Statut d'une question : en attente de l'agent, ou réponse reçue. */
function QuestionStatus({ question }: { question: NoteQuestion }) {
  if (question.answer === null) {
    return (
      <span className="question-status is-waiting" title={`Envoyée le ${formatDateTime(question.askedAt)}`}>
        <Icon name="loader-circle" size={13} />
        Agent notifié
      </span>
    )
  }
  return (
    <span className="question-status is-answered" title={`Réponse reçue le ${formatDateTime(question.answer.at)}`}>
      <span className="question-status-dot" aria-hidden="true" />
      Réponse reçue
    </span>
  )
}

/**
 * Question envoyée tout de suite à l'agent : son texte, son statut et, une fois
 * l'agent répondu, sa réponse dépliée par « Voir la réponse ». La première
 * ouverture enregistre la lecture de la réponse.
 */
function QuestionCard({ note, question }: { note: Note; question: NoteQuestion }) {
  const markAnswerSeen = useAnalysisStore((state) => state.markAnswerSeen)
  const [open, setOpen] = useState(false)
  const where = whereOf(note)
  const answer = question.answer

  const show = () => {
    setOpen(true)
    if (question.answerSeenAt === null) void markAnswerSeen(note.id)
  }

  return (
    <div className={`note-card is-question${open ? ' is-open' : ''}`}>
      <div className="note-head">
        <QuestionPill fixed={false} />
        <span className="note-meta" title={`${where} · ${formatDateTime(question.askedAt)}`}>
          {where} · {formatShortDateTime(question.askedAt)}
        </span>
        <QuestionStatus question={question} />
      </div>
      <p className="note-text">{note.text}</p>
      {answer !== null && !open && (
        <button type="button" className="answer-toggle" onClick={show}>
          <Icon name="messages-square" size={14} />
          Voir la réponse
        </button>
      )}
      {answer !== null && open && (
        <>
          <div className="answer-block">
            <div className="answer-head">
              <Icon name="bot" size={14} color="#b18cff" />
              Agent · {formatShortDateTime(answer.at)}
            </div>
            <p className="answer-text">{answer.text}</p>
          </div>
          <button type="button" className="link-button accent answer-hide" onClick={() => setOpen(false)}>
            <Icon name="chevron-up" size={14} />
            Masquer la réponse
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Saisie d'une remarque sur une ligne (`line`) ou sur le fichier entier (`line` null),
 * liée au constat `findingId` quand elle y répond. « Envoyer à l'agent » en fait une
 * question, transmise tout de suite au lieu d'attendre la fin de la revue.
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
      submitLabel="Enregistrer"
      onSubmit={(text) => addNote(path, line, text, findingId, false)}
      onAsk={(text) => addNote(path, line, text, findingId, true)}
      onClose={onClose}
    />
  )
}

/**
 * Formulaire de texte d'une remarque : `onSubmit` reçoit le texte épuré et renvoie
 * true quand il est enregistré ; `onAsk`, quand il est fourni, l'envoie à l'agent
 * comme une question. Le champ reçoit le focus une fois la carte placée dans la
 * marge, pour que le navigateur fasse défiler jusqu'à sa position réelle.
 */
function NoteForm({
  id,
  label,
  initialText,
  submitLabel,
  onSubmit,
  onAsk,
  onClose,
}: {
  id: string
  label: string
  initialText: string
  submitLabel: string
  onSubmit: (text: string) => Promise<boolean>
  onAsk?: (text: string) => Promise<boolean>
  onClose: () => void
}) {
  const saving = useAnalysisStore((state) => state.saving)
  const [text, setText] = useState(initialText)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => fieldRef.current?.focus(), [])

  const run = async (action: (text: string) => Promise<boolean>) => {
    if (text.trim() === '') return
    if (await action(text.trim())) onClose()
  }

  const empty = text.trim() === ''

  return (
    <form
      className="note-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void run(onSubmit)
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
            void run(event.shiftKey && onAsk ? onAsk : onSubmit)
          }
        }}
      />
      {onAsk ? (
        <>
          <span className="hint">Ctrl + Entrée : enregistrer · Ctrl + Maj + Entrée : envoyer</span>
          <div className="note-composer-actions">
            <button type="button" className="button button-ghost" onClick={onClose}>
              Annuler
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="button button-ask button-small"
              disabled={saving || empty}
              title="La question part tout de suite à l'agent et reste dans la revue avec sa réponse."
              onClick={() => void run(onAsk)}
            >
              <Icon name="send" size={13} />
              Envoyer à l'agent
            </button>
            <button type="submit" className="button button-primary button-small" disabled={saving || empty}>
              {submitLabel}
            </button>
          </div>
        </>
      ) : (
        <div className="note-composer-actions">
          <span className="hint">Ctrl + Entrée pour enregistrer · Échap pour annuler</span>
          <button type="button" className="button button-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="button button-primary button-small" disabled={saving || empty}>
            {submitLabel}
          </button>
        </div>
      )}
    </form>
  )
}
