import type { AnalysisLinks, FeedbackPoint, PreviousReview } from '@shared/follow-ups'
import { DECISION_LABELS } from '@shared/labels'
import { lineRange } from '@shared/text'
import { formatDateTime, noteLocationLabel, processedTitle, splitPath } from '../utils/format'
import { hrefs } from '../utils/router'
import { AnalysisLinkButton } from './AnalysisLinkButton'
import { Icon } from './Icon'
import { NotePill, ReviewStateBadge, SeverityPill } from './Pills'

/** Chaîne des tours de revue : un lien par analyse, celle affichée mise en avant. */
function RoundChain({ chain, currentId }: { chain: AnalysisLinks['chain']; currentId: string }) {
  if (chain.length < 2) return null
  return (
    <nav className="round-chain" aria-label="Tours de revue">
      {chain.map((link, index) => (
        <span key={link.id} className="round-chain-step">
          {index > 0 && <Icon name="arrow-right" size={12} color="#646b7b" />}
          {link.id === currentId ? (
            <span className="round-chain-item is-current" title={link.title} aria-current="page">
              Tour {index + 1}
            </span>
          ) : (
            <a className="round-chain-item" href={hrefs.feature(link.id)} title={link.title}>
              Tour {index + 1}
            </a>
          )}
        </span>
      ))}
    </nav>
  )
}

/** Emplacement court d'un point du retour précédent. */
function pointLocation(point: FeedbackPoint): string {
  if (point.kind === 'note') return noteLocationLabel(point)
  if (!point.location) return 'exigence manquante'
  return `${splitPath(point.location.path).name}:${lineRange(point.location.startLine, point.location.endLine, '–')}`
}

/** Rappel du retour de l'analyse suivie : date, décision et traitement. */
function previousFeedbackLabel(previous: PreviousReview): string {
  const parts: string[] = []
  if (previous.submittedAt) parts.push(`Retour du ${formatDateTime(previous.submittedAt)}`)
  if (previous.decision) parts.push(DECISION_LABELS[previous.decision])
  if (previous.processed) parts.push(processedTitle(previous.processed))
  return parts.join(' · ')
}

/**
 * Bandeau de suivi de l'écran d'une analyse. Sur une revue de suivi : la revue
 * qu'elle prolonge, le rappel de son retour et les points qu'il retenait, à
 * vérifier. Sur une revue suivie : sa nouvelle revue et l'état de celle-ci. La
 * chaîne des tours accompagne la première ligne.
 */
export function FollowUpBanner({ analysisId, links }: { analysisId: string; links: AnalysisLinks }) {
  const { previous, next, chain } = links
  if (!previous && !next) return null

  return (
    <section className="follow-banner" aria-label="Revues de suivi">
      {next && (
        <div className="follow-banner-row">
          <span className="follow-banner-label">Nouvelle revue disponible :</span>
          <AnalysisLinkButton link={next} direction="next" />
          <ReviewStateBadge progress={next.progress} small />
          <span className="spacer" />
          {!previous && <RoundChain chain={chain} currentId={analysisId} />}
        </div>
      )}
      {previous && (
        <>
          <div className="follow-banner-row">
            <span className="follow-banner-label">Revue faisant suite à :</span>
            <AnalysisLinkButton link={previous} direction="previous" />
            <span className="spacer" />
            <RoundChain chain={chain} currentId={analysisId} />
          </div>
          <p className="follow-banner-meta">{previousFeedbackLabel(previous)}</p>
          <div className="follow-banner-points">
            <h2 className="follow-banner-points-title">
              Points du retour précédent à vérifier
              <span className="follow-banner-points-count">{previous.points.length}</span>
            </h2>
            {previous.points.length === 0 ? (
              <p className="follow-banner-empty">Le retour précédent ne retenait aucun point : seule sa décision était transmise.</p>
            ) : (
              <ul className="follow-banner-list">
                {previous.points.map((point) => (
                  <li key={`${point.kind}:${point.id}`} className="follow-banner-point">
                    {point.kind === 'note' ? (
                      <NotePill />
                    ) : point.severity ? (
                      <SeverityPill severity={point.severity} />
                    ) : (
                      <span className="pill pill-fixed">Constat</span>
                    )}
                    <span className="follow-banner-point-text">{point.kind === 'note' ? point.text : point.title}</span>
                    <span className="follow-banner-point-location mono">{pointLocation(point)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}
