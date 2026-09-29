import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MODE_LABELS } from '@shared/labels'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { headLabel, refLabel, relativeTime } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import { Icon } from './Icon'

/** Liste déroulante des analyses ; sa valeur affiche la ref de tête de l'analyse courante. */
function AnalysisSelector({ currentId }: { currentId: string | null }) {
  const analyses = useAnalysisStore((state) => state.analyses)
  const unreadable = useAnalysisStore((state) => state.unreadable)
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

  if (!analyses || (analyses.length === 0 && unreadable.length === 0)) return null
  const current = analyses.find((analysis) => analysis.id === currentId) ?? null

  return (
    <div className="selector" ref={rootRef}>
      <button
        type="button"
        className="selector-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current ? current.title : 'Choisir une analyse'}
        onClick={() => setOpen(!open)}
      >
        <Icon name="git-branch" color="#9aa1b1" />
        <span className="selector-value">{current ? headLabel(current) : 'Choisir une analyse'}</span>
        <Icon name="chevron-down" size={12} color="#646b7b" />
      </button>
      {open && (
        <div className="selector-menu" role="listbox">
          {analyses.map((analysis) => (
            <button
              type="button"
              role="option"
              aria-selected={analysis.id === currentId}
              key={analysis.id}
              className={`selector-item${analysis.id === currentId ? ' is-current' : ''}`}
              onClick={() => {
                setOpen(false)
                navigate(hrefs.feature(analysis.id))
              }}
            >
              <span className="selector-item-title">{analysis.title}</span>
              <span className="selector-item-meta">
                <span className="mono">
                  {analysis.mode === 'branch' ? `${headLabel(analysis)} → ${refLabel(analysis.base)}` : MODE_LABELS.working_tree}
                </span>
                <span>· {relativeTime(analysis.updatedAt)}</span>
                {analysis.reviewState === 'submitted' && <span className="selector-item-state">Revue enregistrée</span>}
              </span>
            </button>
          ))}
          {unreadable.map((entry) => (
            <div key={entry.id} className="selector-item is-unreadable" title={entry.error}>
              <span className="selector-item-title">{entry.id}</span>
              <span className="selector-item-meta">Analyse illisible : {entry.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Barre supérieure : marque, sélecteur d'analyse, état de la connexion et action contextuelle. */
export function TopBar({ currentId, action }: { currentId: string | null; action?: ReactNode }) {
  const connected = useAnalysisStore((state) => state.connected)
  const config = useAnalysisStore((state) => state.config)

  return (
    <header className="topbar">
      <a className="brand" href={hrefs.home()}>
        <span className="brand-mark">
          <Icon name="scan-search" color="#8b97ff" />
        </span>
        Feature Analyzer
      </a>
      <AnalysisSelector currentId={currentId} />
      <div className="topbar-spacer" />
      <div
        className="connection"
        title={connected ? `Connecté au serveur${config ? ` · v${config.version}` : ''}` : 'Connexion au serveur perdue : reconnexion en cours'}
      >
        <span className={`connection-dot${connected ? ' is-connected' : ''}`} />
        {connected ? 'Connecté' : 'Déconnecté'}
      </div>
      {action}
    </header>
  )
}
