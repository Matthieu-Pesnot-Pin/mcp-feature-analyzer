import { useEffect, useRef, useState } from 'react'
import type { Analysis, Note, NoteQuestion } from '@shared/schemas/analysis.schema'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { plural } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import { Icon } from './Icon'

type Question = Note & { question: NoteQuestion }

/** Rang d'affichage : réponses non lues, puis questions en attente, puis réponses lues. */
function rank(question: NoteQuestion): number {
  if (question.answer === null) return 1
  return question.answerSeenAt === null ? 0 : 2
}

function questionsOf(analysis: Analysis): Question[] {
  return analysis.notes
    .filter((note): note is Question => note.question !== null)
    .sort((a, b) => rank(a.question) - rank(b.question) || b.question.askedAt.localeCompare(a.question.askedAt))
}

function locationLabel(note: Note): string {
  if (!note.location) return 'Revue entière'
  const name = note.location.path.split('/').pop() ?? note.location.path
  return note.location.line === null ? name : `${name} · l. ${note.location.line}`
}

function StatusLabel({ question }: { question: NoteQuestion }) {
  if (question.answer === null) return <span className="questions-row-status is-waiting">Agent notifié</span>
  if (question.answerSeenAt === null) return <span className="questions-row-status is-answered">Réponse reçue</span>
  return <span className="questions-row-status is-read">Lue</span>
}

/** Indique si un veilleur de notifications de l'agent suit le projet de l'analyse. */
function AgentPresence({ listened }: { listened: boolean }) {
  return (
    <span
      className={`agent-presence${listened ? ' is-live' : ''}`}
      title={
        listened
          ? "Un agent a activé les notifications de ce projet : il reçoit vos questions et la fin de revue dès qu'elles sont envoyées."
          : "Aucun agent n'a activé les notifications de ce projet : vos questions l'attendront jusqu'à ce qu'il le fasse."
      }
    >
      <span className="agent-presence-dot" aria-hidden="true" />
      {listened ? "Agent à l'écoute" : "Aucun agent à l'écoute"}
    </span>
  )
}

/**
 * Suivi des échanges avec l'agent dans la barre supérieure : présence d'un agent à
 * l'écoute, et bouton « Questions » qui liste les questions de la revue avec leur
 * statut ; son compteur donne le nombre de réponses non lues. Choisir une question
 * ouvre la revue sur sa ligne.
 */
export function AgentQuestions({ analysis }: { analysis: Analysis }) {
  const listenedProjects = useAnalysisStore((state) => state.listenedProjects)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (listenedProjects === null) return null
  const listened = listenedProjects.has(analysis.project)
  const questions = questionsOf(analysis)
  const unread = questions.filter((note) => note.question.answer !== null && note.question.answerSeenAt === null).length

  return (
    <div className="agent-questions" ref={rootRef}>
      <AgentPresence listened={listened} />
      {questions.length > 0 && (
        <button
          type="button"
          className={`questions-button${open ? ' is-open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="messages-square" />
          Questions
          {unread > 0 && (
            <span className="questions-badge" title={plural(unread, 'nouvelle réponse', 'nouvelles réponses')}>
              {unread}
            </span>
          )}
        </button>
      )}
      {open && questions.length > 0 && (
        <div className="questions-menu" role="menu">
          <div className="questions-menu-head">
            <span className="questions-menu-title">Questions de la revue</span>
            {unread > 0 && <span className="questions-menu-unread">{plural(unread, 'nouvelle réponse', 'nouvelles réponses')}</span>}
          </div>
          {questions.map((note) => (
            <button
              type="button"
              role="menuitem"
              key={note.id}
              className={`questions-row${note.question.answer !== null && note.question.answerSeenAt === null ? ' is-unread' : ''}`}
              onClick={() => {
                setOpen(false)
                navigate(hrefs.review(analysis.id, note.location?.path ?? null, note.location?.line ?? null))
              }}
            >
              <span className="questions-row-text">{note.text}</span>
              <span className="questions-row-meta">
                <span className="mono">{locationLabel(note)}</span>
                <StatusLabel question={note.question} />
              </span>
            </button>
          ))}
          <div className="questions-menu-foot">
            <Icon name="bell" size={13} />
            {listened
              ? "L'agent est notifié de chaque question et de la fin de revue."
              : "Aucun agent à l'écoute : vos questions lui parviendront dès qu'il activera les notifications."}
          </div>
        </div>
      )}
    </div>
  )
}
