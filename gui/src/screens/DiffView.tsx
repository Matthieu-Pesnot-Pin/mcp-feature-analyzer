import type { CSSProperties } from 'react'
import type { FileEntry } from '@shared/schemas/analysis.schema'
import type { DiffLine } from '@shared/schemas/diff.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { splitLines } from '@shared/text'
import { Icon } from '../components/Icon'
import { FindingNumber } from '../components/MarginFindingCard'
import { replacedLinesLabel, type HunkRows, type NumberedFinding, type RowBar } from './review-diff-model'

/** Ligne où s'ouvre la saisie d'une remarque ; `line` null vise le fichier entier. */
export type ComposerTarget = { line: number | null } | null

interface DiffViewProps {
  file: FileEntry
  hunks: HunkRows[]
  /** Lignes portant au moins une remarque. */
  notedLines: ReadonlySet<number>
  /** Ligne mise en évidence (paramètre `?line=N`). */
  targetLine: number | null
  onLineNote: (line: number) => void
  onHideFix: (findingId: string) => void
}

const MARKERS: Record<DiffLine['type'], string> = { context: ' ', add: '+', del: '−' }

function barStyle(bar: RowBar | null): CSSProperties | undefined {
  return bar ? ({ '--mark': SEVERITY_STYLES[bar.severity].color } as CSSProperties) : undefined
}

function barClasses(bar: RowBar | null): string {
  if (!bar) return ''
  return bar.muted ? ' has-bar is-bar-muted' : ' has-bar'
}

/** Bandeau d'un correctif affiché dans le diff, avant les lignes qu'il remplace. */
function FixStrip({ entry, bar, onHide }: { entry: NumberedFinding; bar: RowBar; onHide: () => void }) {
  const removes = splitLines(entry.finding.suggestion ?? '').length === 0
  const target = replacedLinesLabel(entry.startLine, entry.endLine)
  return (
    <div className={`fix-strip${barClasses(bar)}`} style={barStyle(bar)} data-fix={entry.finding.id}>
      <FindingNumber entry={entry} small />
      <Icon name="sparkles" color="#8b97ff" />
      <span className="fix-strip-text">
        Correctif proposé par l'agent — {removes ? `supprime ${target}` : `remplace ${target}`}
      </span>
      <button type="button" className="fix-strip-hide" onClick={onHide}>
        Masquer le correctif
      </button>
    </div>
  )
}

/**
 * Diff d'un fichier : en-têtes de bloc, numéros de ligne du côté « nouveau »,
 * correctifs affichés à leur place, repère de gravité le long des lignes visées
 * et pastille numérotée des constats dont le correctif n'est pas affiché. Un
 * clic sur un numéro ouvre la saisie d'une remarque sur cette ligne.
 */
export function DiffView({ file, hunks, notedLines, targetLine, onLineNote, onHideFix }: DiffViewProps) {
  const canNote = file.contentAvailable

  return (
    <div className="diff">
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} className="hunk">
          <div className="hunk-header mono">{hunk.header}</div>
          {hunk.rows.map((row, rowIndex) => {
            if (row.kind === 'fix-strip') {
              return <FixStrip key={rowIndex} entry={row.entry} bar={row.bar} onHide={() => onHideFix(row.entry.finding.id)} />
            }
            if (row.kind === 'fix-line') {
              return (
                <div key={rowIndex} className={`diff-line is-proposed${barClasses(row.bar)}`} style={barStyle(row.bar)}>
                  <span className="diff-num" />
                  <span className="diff-marker">›</span>
                  <span className="diff-code">{row.text}</span>
                </div>
              )
            }

            const { line } = row
            const lineNo = line.newNo
            const classes = [
              'diff-line',
              `is-${line.type}`,
              row.replaced ? 'is-replaced' : '',
              barClasses(row.bar).trim(),
              lineNo !== null && lineNo === targetLine ? 'is-target' : '',
            ]
            return (
              <div key={rowIndex} className={classes.filter(Boolean).join(' ')} style={barStyle(row.bar)} data-line={lineNo ?? undefined}>
                {lineNo !== null && notedLines.has(lineNo) && <span className="diff-note-dot" title="Remarque sur cette ligne" />}
                {lineNo !== null && canNote ? (
                  <button type="button" className="diff-num" title={`Ajouter une remarque sur la ligne ${lineNo}`} onClick={() => onLineNote(lineNo)}>
                    {lineNo}
                  </button>
                ) : (
                  <span className="diff-num">{lineNo ?? ''}</span>
                )}
                <span className="diff-marker">{MARKERS[line.type]}</span>
                <span className="diff-code">{line.text}</span>
                {row.pills.length > 0 && (
                  <span className="diff-pills">
                    {row.pills.map((entry) => (
                      <span key={entry.finding.id} className={entry.finding.status === 'open' ? undefined : 'is-muted'} title={entry.finding.title}>
                        <FindingNumber entry={entry} small />
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <div className="diff-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#11201a', borderColor: '#2c6b3a' }} />
          Ajouté par la feature
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#2a1618', borderColor: '#6b2a2d' }} />
          Lignes remplacées par le correctif
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#1a1c35', borderColor: '#36407a' }} />
          Correctif proposé
        </span>
      </div>
    </div>
  )
}
