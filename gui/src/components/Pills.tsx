import type { FindingKind, FindingStatus, Severity } from '@shared/schemas/analysis.schema'
import { FINDING_KIND_LABELS, FINDING_STATUS_LABELS, NOTE_STYLE, SEVERITY_STYLES } from '@shared/labels'

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

/** Pastille ronde de couleur de gravité suivie d'un nombre. */
export function SeverityDot({ severity, count }: { severity: Severity; count: number }) {
  const color = SEVERITY_STYLES[severity].color
  return (
    <span className="severity-dot" style={{ color }} title={`${count} constat(s) ${SEVERITY_STYLES[severity].label.toLowerCase()}(s) ouvert(s)`}>
      <span className="severity-dot-mark" style={{ background: color }} />
      {count}
    </span>
  )
}
