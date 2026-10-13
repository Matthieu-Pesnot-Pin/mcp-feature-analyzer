import { useEffect, useId, useRef, useState } from 'react'
import type { AnalysisSummary } from '@shared/schemas/analysis.schema'
import { PROCESSED_STYLE, REVIEW_PROGRESS_STYLES } from '@shared/labels'
import { Icon, type IconName } from '../components/Icon'
import { ReviewStateBadge, SeverityDot } from '../components/Pills'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { formatDateTime, openFindingsLabel, plural, processedByLabel, refsLabel, relativeTime } from '../utils/format'
import { hrefs } from '../utils/router'
import {
  applyHomeFilter,
  groupByProject,
  HOME_FILTERS,
  homeFilterCounts,
  openSeverityCounts,
  reviewedPercent,
  type HomeFilter,
  type ProjectGroup,
} from './home-model'

/** Libellé, icône et message de liste vide de chaque filtre de l'accueil. */
const FILTERS: Record<HomeFilter, { label: string; icon: IconName; empty: string }> = {
  to_review: { label: 'À relire', icon: 'eye', empty: 'Aucune revue à faire : toutes les analyses sont soumises.' },
  to_process: { label: "À traiter par l'agent", icon: 'hourglass', empty: "Aucun retour n'attend l'agent." },
  processed: { label: "Traitées par l'agent", icon: 'clipboard-check', empty: "Aucun retour traité par l'agent à vérifier." },
  approved: { label: 'Approuvées', icon: 'circle-check', empty: 'Aucune analyse approuvée.' },
  all: { label: 'Toutes', icon: 'list', empty: 'Aucune analyse.' },
}

/**
 * Colonne des filtres, chacun avec son icône et son nombre d'analyses.
 * « Traitées par l'agent » ressort tant qu'il en reste : le relecteur y a du nouveau.
 */
function FilterColumn({ counts }: { counts: Record<HomeFilter, number> }) {
  const filter = useAnalysisStore((state) => state.homeFilter)
  const setHomeFilter = useAnalysisStore((state) => state.setHomeFilter)

  return (
    <nav className="home-filters" aria-label="Filtrer les analyses">
      {HOME_FILTERS.map((entry) => {
        const active = entry === filter
        const highlighted = entry === 'processed' && counts.processed > 0
        return (
          <button
            key={entry}
            type="button"
            className={`home-filter${active ? ' is-active' : ''}${highlighted ? ' is-highlighted' : ''}${entry === 'all' ? ' is-all' : ''}`}
            aria-pressed={active}
            onClick={() => setHomeFilter(entry)}
          >
            <Icon name={FILTERS[entry].icon} size={16} color={highlighted ? PROCESSED_STYLE.color : '#9aa1b1'} />
            <span className="home-filter-label">{FILTERS[entry].label}</span>
            <span className="home-filter-count">{counts[entry]}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** Ligne de traitement d'une revue marquée traitée : note, auteur du marquage et date. */
function ProcessingLine({ analysis }: { analysis: AnalysisSummary }) {
  const processed = analysis.progress.processed
  if (!processed) return null
  const author = processed.by === 'user' ? 'du relecteur' : "de l'agent"
  return (
    <span className="home-row-processing">
      <Icon name="corner-down-right" size={12} color={PROCESSED_STYLE.color} />
      {processed.note === null ? processedByLabel(processed) : `Note ${author} : ${processed.note}`} · le {formatDateTime(processed.at)}
    </span>
  )
}

/**
 * Bouton « Marquer comme traité » d'une carte et sa fenêtre : note facultative,
 * puis confirmation. Entrée confirme ; Échap ou un clic dehors referment la fenêtre.
 */
function MarkProcessedButton({ analysis }: { analysis: AnalysisSummary }) {
  const markProcessed = useAnalysisStore((state) => state.markProcessed)
  const saving = useAnalysisStore((state) => state.saving)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const noteId = useId()

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

  const confirm = async () => {
    const trimmed = note.trim()
    if (await markProcessed(analysis, trimmed === '' ? null : trimmed)) {
      setOpen(false)
      setNote('')
    }
  }

  return (
    <div className={`mark-processed${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="button button-secondary mark-processed-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Icon name="check" size={14} color={PROCESSED_STYLE.color} />
        Marquer comme traité
      </button>
      {open && (
        <div className="mark-processed-panel" role="dialog" aria-label="Marquer le retour comme traité">
          <p className="mark-processed-title">Marquer le retour comme traité</p>
          <label className="mark-processed-label" htmlFor={noteId}>
            Note pour l'historique (facultative)
          </label>
          <input
            id={noteId}
            className="mark-processed-input"
            autoFocus
            value={note}
            placeholder="ex. corrigé par 12785d6e3 et 1ff5baaad"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void confirm()
            }}
          />
          <div className="mark-processed-actions">
            <button type="button" className="link-button muted" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button type="button" className="button mark-processed-confirm" disabled={saving} onClick={() => void confirm()}>
              Marquer comme traité
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Carte d'une analyse : le titre en entier, puis refs, date, progression des
 * fichiers, constats ouverts et état de revue sur une seconde ligne, et la note
 * du traitement quand le retour est marqué traité. Toute la carte mène à
 * l'analyse ; `markable` ajoute le bouton « Marquer comme traité » à droite du titre.
 */
function AnalysisRow({ analysis, markable }: { analysis: AnalysisSummary; markable: boolean }) {
  const { reviewedFiles, totalFiles } = analysis.progress
  const findings = openSeverityCounts(analysis)
  return (
    <div className="home-row">
      <span className="home-row-body">
        <span className="home-row-head">
          <a className="home-row-title home-row-link" href={hrefs.feature(analysis.id)}>
            {analysis.title}
          </a>
          {markable && <MarkProcessedButton analysis={analysis} />}
        </span>
        <span className="home-row-details">
          <span className="home-row-meta">
            <span className="mono">
              {refsLabel(analysis)}
            </span>
            <span>· {relativeTime(analysis.updatedAt)}</span>
          </span>
          <span className="home-row-progress" title={`${reviewedFiles} fichier(s) revu(s) sur ${totalFiles}`}>
            <span className="home-row-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={totalFiles} aria-valuenow={reviewedFiles}>
              <span className="progress-fill" style={{ width: `${reviewedPercent(analysis)}%` }} />
            </span>
            <span className="home-row-progress-label mono">
              {reviewedFiles}/{totalFiles}
            </span>
          </span>
          <span className="home-row-findings">
            {findings.length === 0 ? (
              <span className="home-row-none">Aucun constat ouvert</span>
            ) : (
              findings.map(({ severity, count }) => (
                <SeverityDot
                  key={severity}
                  severity={severity}
                  count={count}
                  title={`${openFindingsLabel(severity, count)}, exigences manquantes comprises`}
                />
              ))
            )}
          </span>
          <span className="home-row-state">
            <ReviewStateBadge progress={analysis.progress} />
          </span>
        </span>
        <ProcessingLine analysis={analysis} />
      </span>
      <Icon name="chevron-right" color="#646b7b" />
    </div>
  )
}

/**
 * Section repliable d'un projet, avec le nombre d'analyses de chaque état en tête.
 * Dans le filtre « À traiter par l'agent », chaque carte porte « Marquer comme traité ».
 */
function ProjectSection({ group }: { group: ProjectGroup }) {
  const filter = useAnalysisStore((state) => state.homeFilter)
  const collapsed = useAnalysisStore((state) => state.collapsedProjects.has(group.project))
  const toggleProject = useAnalysisStore((state) => state.toggleProject)

  return (
    <section className="home-project">
      <button type="button" className="home-project-head" aria-expanded={!collapsed} onClick={() => toggleProject(group.project)}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} color="#646b7b" />
        <Icon name="folder" color="#8b97ff" />
        <span className="home-project-name">{group.project}</span>
        <span className="home-project-total">{plural(group.analyses.length, 'analyse')}</span>
        <span className="spacer" />
        <span className="home-project-counts">
          {group.counts.map(({ state, count }) => (
            <span
              key={state}
              className="pill pill-small"
              style={{ color: REVIEW_PROGRESS_STYLES[state].color, background: REVIEW_PROGRESS_STYLES[state].background }}
            >
              {REVIEW_PROGRESS_STYLES[state].label} · {count}
            </span>
          ))}
        </span>
      </button>
      {!collapsed && (
        <div className="home-project-list">
          {group.analyses.map((analysis) => (
            <AnalysisRow key={analysis.id} analysis={analysis} markable={filter === 'to_process' && analysis.progress.toProcess} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Accueil : analyses rangées par projet, filtrées par étape de la revue depuis une colonne à gauche. */
export function HomeScreen() {
  const analyses = useAnalysisStore((state) => state.analyses)
  const unreadable = useAnalysisStore((state) => state.unreadable)
  const listError = useAnalysisStore((state) => state.listError)
  const filter = useAnalysisStore((state) => state.homeFilter)
  const setHomeFilter = useAnalysisStore((state) => state.setHomeFilter)

  if (listError) {
    return (
      <div className="empty-state">
        <div className="empty-card">
          <p className="error-text">{listError}</p>
        </div>
      </div>
    )
  }
  if (analyses === null) {
    return (
      <div className="empty-state">
        <div className="empty-card">
          <p>Chargement des analyses…</p>
        </div>
      </div>
    )
  }
  if (analyses.length === 0 && unreadable.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-card">
          <h1 className="empty-title">Aucune analyse à revoir</h1>
          <p>
            L'agent crée une analyse avec l'outil <code>create_analysis</code> une fois la feature développée. Elle apparaîtra
            ici automatiquement.
          </p>
        </div>
      </div>
    )
  }

  const visible = applyHomeFilter(analyses, filter)
  const groups = groupByProject(visible)
  const projectCount = new Set(analyses.map((analysis) => analysis.project)).size
  const counts = homeFilterCounts(analyses)

  return (
    <div className="page page-home">
      <div className="home-head">
        <div className="page-head-text">
          <h1 className="page-title">Analyses</h1>
          <p className="page-meta">
            {plural(analyses.length, 'analyse')} · {plural(projectCount, 'projet')} · {counts.to_review} à relire
          </p>
        </div>
      </div>

      <div className="home-layout">
        <FilterColumn counts={counts} />
        <div className="home-projects">
          {groups.length === 0 && analyses.length > 0 && (
            <div className="card home-empty">
              <p>{FILTERS[filter].empty}</p>
              <button type="button" className="link-button accent" onClick={() => setHomeFilter('all')}>
                Afficher toutes les analyses
              </button>
            </div>
          )}
          {groups.map((group) => (
            <ProjectSection key={group.project} group={group} />
          ))}
          {unreadable.length > 0 && (
            <section className="home-project">
              <h2 className="home-project-head is-static">
                <Icon name="triangle-alert" color="#f0625a" />
                <span className="home-project-name">Analyses illisibles</span>
              </h2>
              <div className="home-project-list">
                {unreadable.map((entry) => (
                  <div key={entry.id} className="home-row is-unreadable">
                    <span className="home-row-body">
                      <span className="home-row-title mono">{entry.id}</span>
                      <span className="home-row-meta error-text">{entry.error}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
