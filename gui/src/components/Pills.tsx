import type { FindingKind, FindingStatus, ReviewProgress, Severity } from '@shared/schemas/analysis.schema'
import {
  DECISION_STYLES,
  FINDING_KIND_LABELS,
  FINDING_STATUS_LABELS,
  NOTE_STYLE,
  REVIEW_PROGRESS_STYLES,
  SEVERITY_STYLES,
  type BadgeStyle,
} from '@shared/labels'

/** Pastille de gravité ; `fixed` lui donne la largeur constante des listes. */
export function SeverityPill({ severity, fixed = true }: { severity: Severity; fixed?: boolean }) {
  const style = SEVERITY_STYLES[severity]
  return (
    <span className={`pill${fixed ? ' pill-fixed' : ''}`} style={{ color: style.color, background: style.background }}>
      {style.label}
    </span>
  )
}

/** Pastille des remarques du relecteur. */
export function NotePill({ fixed = true }: { fixed?: boolean }) {
  return (
    <span className={`pill${fixed ? ' pill-fixed' : ''}`} style={{ color: NOTE_STYLE.color, background: NOTE_STYLE.background }}>
      {NOTE_STYLE.label}
    </span>
  )
}

/** Étiquette d'un constat qui n'est pas ouvert : ignoré ou obsolète. */
export function StatusTag({ status }: { status: FindingStatus }) {
  if (status === 'open') return null
  return <span className={`tag tag-${status}`}>{FINDING_STATUS_LABELS[status]}</span>
}

/** Étiquette d'une exigence manquante. */
export function KindTag({ kind }: { kind: FindingKind }) {
  if (kind !== 'requirement_gap') return null
  return <span className="tag tag-gap">{FINDING_KIND_LABELS[kind]}</span>
}

/**
 * Pastille ronde de couleur de gravité suivie d'un nombre, avec son libellé en
 * infobulle ; `href` en fait un lien.
 */
export function SeverityDot({ severity, count, title, href }: { severity: Severity; count: number; title: string; href?: string }) {
  const color = SEVERITY_STYLES[severity].color
  const content = (
    <>
      <span className="severity-dot-mark" style={{ background: color }} />
      {count}
    </>
  )
  if (href) {
    return (
      <a className="severity-dot is-link" href={href} style={{ color }} title={title} aria-label={title}>
        {content}
      </a>
    )
  }
  return (
    <span className="severity-dot" style={{ color }} title={title}>
      {content}
    </span>
  )
}

function Badge({ style, small }: { style: BadgeStyle; small?: boolean }) {
  return (
    <span className={`pill${small ? ' pill-small' : ''}`} style={{ color: style.color, background: style.background }}>
      {style.label}
    </span>
  )
}

/** État de revue d'une analyse ; une revue soumise affiche aussi sa décision. */
export function ReviewStateBadge({ progress, small }: { progress: ReviewProgress; small?: boolean }) {
  return (
    <span className="review-badges">
      <Badge style={REVIEW_PROGRESS_STYLES[progress.state]} small={small} />
      {progress.decision && <Badge style={DECISION_STYLES[progress.decision]} small={small} />}
    </span>
  )
}
