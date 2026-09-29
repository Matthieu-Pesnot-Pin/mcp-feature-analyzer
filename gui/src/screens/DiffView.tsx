import type { CSSProperties } from 'react'
import type { FileEntry } from '@shared/schemas/analysis.schema'
import type { DiffLine } from '@shared/schemas/diff.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { splitLines } from '@shared/text'
import { Icon } from '../components/Icon'
import { FindingNumber } from '../components/MarginFindingCard'
import {
  FIX_MODE_LABELS,
  replacedLinesLabel,
  sameAnchor,
  type DiffAnchor,
  type FixMode,
  type HunkRows,
  type NumberedFinding,
  type RowBar,
} from './review-diff-model'

/** Ligne où s'ouvre la saisie d'une remarque ; `line` null vise le fichier entier. */
export type ComposerTarget = { line: number | null } | null

interface DiffViewProps {
  file: FileEntry
  hunks: HunkRows[]
  /** Lignes portant au moins une remarque. */
  notedLines: ReadonlySet<number>
  mode: FixMode
  onModeChange: (mode: FixMode) => void
  /** Élément mis en évidence (paramètre `?line=N`). */
  target: DiffAnchor | null
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

/** Pastilles numérotées des constats dont le correctif n'est pas dans le diff. */
function DiffPills({ entries }: { entries: NumberedFinding[] }) {
  return (
    <span className="diff-pills">
      {entries.map((entry) => (
        <span key={entry.finding.id} className={entry.finding.status === 'open' ? undefined : 'is-muted'} title={entry.finding.title}>
          <FindingNumber entry={entry} small />
        </span>
      ))}
    </span>
  )
}

interface FixStripProps {
  entry: NumberedFinding
  bar: RowBar
  pills: NumberedFinding[]
  applied: boolean
  isTarget: boolean
  onHide: () => void
}

/**
 * Bandeau d'un correctif dans le diff : avant les lignes qu'il remplace, ou,
 * correctif appliqué, avant les lignes proposées qui en tiennent lieu.
 */
function FixStrip({ entry, bar, pills, applied, isTarget, onHide }: FixStripProps) {
  const removes = splitLines(entry.finding.suggestion ?? '').length === 0
  const lines = replacedLinesLabel(entry.startLine, entry.endLine)
  const action = removes ? `supprime ${lines}` : `remplace ${lines}`
  return (
    <div
      className={`fix-strip${applied ? ' is-applied' : ''}${barClasses(bar)}${isTarget ? ' is-target' : ''}`}
      style={barStyle(bar)}
      data-fix={entry.finding.id}
    >
      <FindingNumber entry={entry} small />
      <Icon name="sparkles" color="#8b97ff" />
      <span className="fix-strip-text">
        {applied ? `Correctif ${entry.number} appliqué — ${action}` : `Correctif proposé par l'agent — ${action}`}
      </span>
      {pills.length > 0 && <DiffPills entries={pills} />}
      <button type="button" className="fix-strip-hide" onClick={onHide}>
        {applied ? 'Retirer le correctif' : 'Masquer le correctif'}
      </button>
    </div>
  )
}

/** Choix de l'affichage des correctifs, commun à tous les fichiers. */
function FixModeControl({ mode, onChange }: { mode: FixMode; onChange: (mode: FixMode) => void }) {
  return (
    <div className="diff-toolbar">
      <span className="diff-toolbar-label" id="fix-mode-label">
        Correctifs
      </span>
      <div className="segmented segmented-small" role="group" aria-labelledby="fix-mode-label">
        {(Object.keys(FIX_MODE_LABELS) as FixMode[]).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`segmented-item${entry === mode ? ' is-active' : ''}`}
            aria-pressed={entry === mode}
            onClick={() => onChange(entry)}
          >
            {FIX_MODE_LABELS[entry]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Légende des fonds du diff, limitée à ceux que le mode affiche. */
function DiffLegend({ mode }: { mode: FixMode }) {
  return (
    <div className="diff-legend">
      <span className="legend-item">
        <span className="legend-swatch" style={{ background: '#11201a', borderColor: '#2c6b3a' }} />
        Ajouté par la feature
      </span>
      {mode === 'before-after' && (
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#2a1618', borderColor: '#6b2a2d' }} />
          Lignes remplacées par le correctif
        </span>
      )}
      {mode !== 'off' && (
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#1a1c35', borderColor: '#36407a' }} />
          {mode === 'applied' ? 'Correctif appliqué' : 'Correctif proposé'}
        </span>
      )}
    </div>
  )
}

/**
 * Diff d'un fichier : choix de l'affichage des correctifs, en-têtes de bloc,
 * numéros de ligne du côté « nouveau », correctifs affichés à leur place,
 * repère de gravité le long des lignes visées et pastille numérotée des
 * constats dont le correctif n'est pas affiché. Un clic sur un numéro ouvre la
 * saisie d'une remarque sur cette ligne ; les lignes proposées n'ont pas de numéro.
 */
export function DiffView({ file, hunks, notedLines, mode, onModeChange, target, onLineNote, onHideFix }: DiffViewProps) {
  const canNote = file.contentAvailable

  return (
    <div className="diff">
      <FixModeControl mode={mode} onChange={onModeChange} />
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} className="hunk">
          <div className="hunk-header mono">{hunk.header}</div>
          {hunk.rows.map((row, rowIndex) => {
            if (row.kind === 'fix-strip') {
              return (
                <FixStrip
                  key={rowIndex}
                  entry={row.entry}
                  bar={row.bar}
                  pills={row.pills}
                  applied={mode === 'applied'}
                  isTarget={sameAnchor(target, { kind: 'fix', entry: row.entry })}
                  onHide={() => onHideFix(row.entry.finding.id)}
                />
              )
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
              lineNo !== null && sameAnchor(target, { kind: 'line', line: lineNo }) ? 'is-target' : '',
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
                {row.pills.length > 0 && <DiffPills entries={row.pills} />}
              </div>
            )
          })}
        </div>
      ))}
      <DiffLegend mode={mode} />
    </div>
  )
}
