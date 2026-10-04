import type { CSSProperties } from 'react'
import type { FileEntry } from '@shared/schemas/analysis.schema'
import type { DiffLine, FileDiff, Hunk } from '@shared/schemas/diff.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { splitLines } from '@shared/text'
import { Icon } from '../components/Icon'
import { FindingNumber } from '../components/MarginFindingCard'
import type { ThemedToken } from '../utils/syntax'
import {
  CODE_VIEW_LABELS,
  DIFF_SCOPE_LABELS,
  FIX_MODE_LABELS,
  replacedLinesLabel,
  sameAnchor,
  type CodeView,
  type DiffAnchor,
  type DiffScope,
  type FixMode,
  type HunkRows,
  type NumberedFinding,
  type RowBar,
} from './review-diff-model'
import { useSyntaxTokens } from './useSyntaxTokens'

/** Ligne où s'ouvre la saisie d'une remarque ; `line` null vise le fichier entier. */
export type ComposerTarget = { line: number | null } | null

interface DiffViewProps {
  file: FileEntry
  /** Diff figé du fichier, source de la coloration syntaxique. */
  fileDiff: FileDiff
  hunks: HunkRows[]
  /** Lignes portant au moins une remarque. */
  notedLines: ReadonlySet<number>
  mode: FixMode
  onModeChange: (mode: FixMode) => void
  codeView: CodeView
  onCodeViewChange: (view: CodeView) => void
  scope: DiffScope
  onScopeChange: (scope: DiffScope) => void
  /** Le snapshot conserve le contenu du fichier : il peut s'afficher en entier. */
  wholeFileAvailable: boolean
  /** Des lignes sont marquées comme décrites par une explication : la légende l'indique. */
  explained: boolean
  /** Élément mis en évidence (paramètre `?line=N`). */
  target: DiffAnchor | null
  onLineNote: (line: number) => void
  onHideFix: (findingId: string) => void
  /** Copie le prompt qui demande à l'agent d'expliquer ce bloc. */
  onRequestExplanation: (hunk: Hunk) => void
}

const MARKERS: Record<DiffLine['type'], string> = { context: ' ', add: '+', del: '−' }

/** Classe d'une ligne du diff : en vue `new`, une ligne ajoutée ne porte qu'un filet, sans fond ni marque. */
function lineTypeClass(type: DiffLine['type'], codeView: CodeView): string {
  return codeView === 'new' && type === 'add' ? 'is-new' : `is-${type}`
}

/** Texte d'une ligne, coloré par ses jetons quand il y en a. */
function CodeText({ text, tokens }: { text: string; tokens: ThemedToken[] | undefined }) {
  if (!tokens) return <span className="diff-code">{text}</span>
  return (
    <span className="diff-code is-highlighted">
      {tokens.map((token, index) => (
        <span key={index} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </span>
  )
}

/** Couleur et style d'un jeton ; `fontStyle` est un champ de bits : 1 italique, 2 gras. */
function tokenStyle(token: ThemedToken): CSSProperties {
  const fontStyle = token.fontStyle ?? 0
  return {
    color: token.color,
    fontStyle: fontStyle & 1 ? 'italic' : undefined,
    fontWeight: fontStyle & 2 ? 600 : undefined,
  }
}

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

interface SegmentedControlProps<T extends string> {
  /** Identifiant du libellé, relié au groupe de boutons. */
  id: string
  label: string
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
  /** Choix indisponibles, avec la raison affichée en infobulle. */
  disabled?: Partial<Record<T, string>>
}

/** Libellé suivi d'un sélecteur à boutons segmentés. */
function SegmentedControl<T extends string>({ id, label, labels, value, onChange, disabled }: SegmentedControlProps<T>) {
  return (
    <>
      <span className="diff-toolbar-label" id={id}>
        {label}
      </span>
      <div className="segmented segmented-small" role="group" aria-labelledby={id}>
        {(Object.keys(labels) as T[]).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`segmented-item${entry === value ? ' is-active' : ''}`}
            aria-pressed={entry === value}
            disabled={disabled?.[entry] !== undefined}
            title={disabled?.[entry]}
            onClick={() => onChange(entry)}
          >
            {labels[entry]}
          </button>
        ))}
      </div>
    </>
  )
}

/** Légende des fonds du diff, limitée à ceux que la vue et le mode affichent. */
function DiffLegend({ mode, codeView, explained }: { mode: FixMode; codeView: CodeView; explained: boolean }) {
  return (
    <div className="diff-legend">
      {codeView === 'new' ? (
        <span className="legend-item">
          <span className="legend-swatch is-new" />
          Ajouté par la feature
        </span>
      ) : (
        <>
          <span className="legend-item">
            <span className="legend-swatch is-add" />
            Ajouté par la feature
          </span>
          <span className="legend-item">
            <span className="legend-swatch is-del" />
            Supprimé par la feature
          </span>
        </>
      )}
      {mode === 'before-after' && (
        <span className="legend-item">
          <span className="legend-swatch is-replaced" />
          Lignes remplacées par le correctif
        </span>
      )}
      {mode !== 'off' && (
        <span className="legend-item">
          <span className="legend-swatch is-proposed" />
          {mode === 'applied' ? 'Correctif appliqué' : 'Correctif proposé'}
        </span>
      )}
      {explained && (
        <span className="legend-item">
          <span className="legend-swatch is-explained" />
          Code décrit par une explication
        </span>
      )}
    </div>
  )
}

/**
 * Diff d'un fichier : choix de l'étendue affichée (modifications ou fichier
 * entier), du code affiché (diff git ou nouveau code seul) et de l'affichage
 * des correctifs, en-têtes de bloc,
 * numéros de ligne du côté « nouveau », correctifs affichés à leur place,
 * repère de gravité le long des lignes visées et pastille numérotée des
 * constats dont le correctif n'est pas affiché, filet le long des lignes
 * décrites par une explication. Un clic sur un numéro ouvre la saisie d'une
 * remarque sur cette ligne ; les lignes proposées n'ont pas de numéro. Une ligne
 * supprimée porte son numéro du côté « ancien » (`data-old-line`), sur lequel
 * s'aligne la carte d'une explication de code supprimé. Le code est coloré
 * selon le langage du fichier, sauf sur les lignes barrées par un correctif.
 * En vue « Nouveau code », les lignes ajoutées par la feature portent un filet
 * vert à la place de leur fond et de leur marque.
 */
export function DiffView({
  file,
  fileDiff,
  hunks,
  notedLines,
  mode,
  onModeChange,
  codeView,
  onCodeViewChange,
  scope,
  onScopeChange,
  wholeFileAvailable,
  explained,
  target,
  onLineNote,
  onHideFix,
  onRequestExplanation,
}: DiffViewProps) {
  const canNote = file.contentAvailable
  const syntax = useSyntaxTokens(fileDiff)

  return (
    <div className="diff">
      <div className="diff-toolbar">
        {syntax.status === 'error' && <span className="diff-toolbar-error">Coloration syntaxique indisponible : {syntax.message}</span>}
        <SegmentedControl
          id="diff-scope-label"
          label="Afficher"
          labels={DIFF_SCOPE_LABELS}
          value={scope}
          onChange={onScopeChange}
          disabled={wholeFileAvailable ? undefined : { file: "Le contenu de ce fichier n'est pas conservé dans l'analyse." }}
        />
        <span className="diff-toolbar-gap" />
        <SegmentedControl id="code-view-label" label="Code" labels={CODE_VIEW_LABELS} value={codeView} onChange={onCodeViewChange} />
        <span className="diff-toolbar-gap" />
        <SegmentedControl id="fix-mode-label" label="Correctifs" labels={FIX_MODE_LABELS} value={mode} onChange={onModeChange} />
      </div>
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} className="hunk">
          <div className="hunk-header">
            <span className="hunk-header-text mono">{hunk.hunk.header}</span>
            <button
              type="button"
              className="hunk-explain"
              title="Copier un prompt qui demande à l'agent d'expliquer ce bloc et d'ajouter ses explications à l'analyse"
              onClick={() => onRequestExplanation(hunk.hunk)}
            >
              <Icon name="bot" color="#3cc4b4" />
              Copier une demande d'explication
            </button>
          </div>
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
                  <CodeText
                    text={row.text}
                    tokens={syntax.status === 'ready' ? syntax.suggestion(row.entry.finding.suggestion ?? '')[row.index] : undefined}
                  />
                </div>
              )
            }

            const { line } = row
            const lineNo = line.newNo
            const tokens =
              syntax.status !== 'ready' || row.replaced
                ? undefined
                : line.type === 'del'
                  ? syntax.file.oldSide.get(line.oldNo!)
                  : syntax.file.newSide.get(lineNo!)
            const classes = [
              'diff-line',
              lineTypeClass(line.type, codeView),
              row.replaced ? 'is-replaced' : '',
              row.explained ? 'is-explained' : '',
              barClasses(row.bar).trim(),
              lineNo !== null && sameAnchor(target, { kind: 'line', line: lineNo }) ? 'is-target' : '',
            ]
            return (
              <div
                key={rowIndex}
                className={classes.filter(Boolean).join(' ')}
                style={barStyle(row.bar)}
                data-line={lineNo ?? undefined}
                data-old-line={line.type === 'del' ? (line.oldNo ?? undefined) : undefined}
              >
                {lineNo !== null && notedLines.has(lineNo) && <span className="diff-note-dot" title="Remarque sur cette ligne" />}
                {lineNo !== null && canNote ? (
                  <button type="button" className="diff-num" title={`Ajouter une remarque sur la ligne ${lineNo}`} onClick={() => onLineNote(lineNo)}>
                    {lineNo}
                  </button>
                ) : (
                  <span className="diff-num">{lineNo ?? ''}</span>
                )}
                <span className="diff-marker">{codeView === 'new' ? '' : MARKERS[line.type]}</span>
                <CodeText text={line.text} tokens={tokens} />
                {row.pills.length > 0 && <DiffPills entries={row.pills} />}
              </div>
            )
          })}
        </div>
      ))}
      <DiffLegend mode={mode} codeView={codeView} explained={explained} />
    </div>
  )
}
