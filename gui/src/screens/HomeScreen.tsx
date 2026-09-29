import type { AnalysisSummary } from '@shared/schemas/analysis.schema'
import { REVIEW_PROGRESS_STYLES } from '@shared/labels'
import { Icon } from '../components/Icon'
import { ReviewStateBadge, SeverityDot } from '../components/Pills'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { plural, refsLabel, relativeTime } from '../utils/format'
import { hrefs } from '../utils/router'
import {
  applyHomeFilter,
  groupByProject,
  openSeverityCounts,
  reviewedPercent,
  type HomeFilter,
  type ProjectGroup,
} from './home-model'

const FILTER_LABELS: Record<HomeFilter, string> = {
  to_review: 'À relire',
  all: 'Toutes',
}

/** Ligne d'une analyse : titre, refs, date, progression des fichiers, constats ouverts et état de revue. */
function AnalysisRow({ analysis }: { analysis: AnalysisSummary }) {
  const { reviewedFiles, totalFiles } = analysis.progress
  const findings = openSeverityCounts(analysis)
  return (
    <a className="home-row" href={hrefs.feature(analysis.id)}>
      <span className="home-row-text">
        <span className="home-row-title">{analysis.title}</span>
        <span className="home-row-meta">
          <span className="mono">
            {refsLabel(analysis)}
          </span>
          <span>· {relativeTime(analysis.updatedAt)}</span>
        </span>
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
          findings.map(({ severity, count }) => <SeverityDot key={severity} severity={severity} count={count} />)
        )}
      </span>
      <span className="home-row-state">
        <ReviewStateBadge progress={analysis.progress} />
      </span>
      <Icon name="chevron-right" color="#646b7b" />
    </a>
  )
}

/** Section repliable d'un projet, avec le nombre d'analyses de chaque état en tête. */
function ProjectSection({ group }: { group: ProjectGroup }) {
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
        <div className="card list-card home-project-list">
          {group.analyses.map((analysis) => (
            <AnalysisRow key={analysis.id} analysis={analysis} />
          ))}
        </div>
      )}
    </section>
  )
}

/** Accueil : analyses rangées par projet, filtrables sur celles qui restent à relire. */
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
  const toReview = applyHomeFilter(analyses, 'to_review').length

  return (
    <div className="page">
      <div className="home-head">
        <div className="page-head-text">
          <h1 className="page-title">Analyses</h1>
          <p className="page-meta">
            {plural(analyses.length, 'analyse')} · {plural(projectCount, 'projet')} · {toReview} à relire
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Filtrer les analyses">
          {(Object.keys(FILTER_LABELS) as HomeFilter[]).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`segmented-item${entry === filter ? ' is-active' : ''}`}
              aria-pressed={entry === filter}
              onClick={() => setHomeFilter(entry)}
            >
              {FILTER_LABELS[entry]}
            </button>
          ))}
        </div>
      </div>

      <div className="home-projects">
        {groups.length === 0 && analyses.length > 0 && (
          <div className="card home-empty">
            <p>Toutes les revues sont soumises : aucune analyse ne reste à relire.</p>
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
            <div className="card list-card home-project-list">
              {unreadable.map((entry) => (
                <div key={entry.id} className="home-row is-unreadable">
                  <span className="home-row-text">
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
  )
}
