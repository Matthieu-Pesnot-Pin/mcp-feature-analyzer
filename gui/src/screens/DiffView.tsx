import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { FileEntry } from '@shared/schemas/analysis.schema'
import type { DiffLine, FileDiff, Hunk } from '@shared/schemas/diff.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { indentChange } from '@shared/reindent'
import { splitLines } from '@shared/text'
import { Icon } from '../components/Icon'
import { FindingNumber } from '../components/MarginFindingCard'
import { OptionMenu } from '../components/OptionMenu'
import type { ThemedToken } from '../utils/syntax'
import { DiffMinimap } from './DiffMinimap'
import {
  buildMinimap,
  CODE_VIEW_OPTIONS,
  DIFF_SCOPE_OPTIONS,
  FIX_MODE_OPTIONS,
  replacedLinesLabel,
  sameAnchor,
  splitRows,
  type CodeView,
  type DiffAnchor,
  type DiffRow,
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
  /** Constats affichés du fichier, repérés sur la mini-carte. */
  findings: NumberedFinding[]
  /** Lignes portant au moins une remarque. */
  notedLines: ReadonlySet<number>
  /** Conteneur qui fait défiler le diff, que pilote la mini-carte. */
  scrollRef: RefObject<HTMLDivElement | null>
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

/** Place d'une ligne : diff sur une colonne, ou côté gauche / droit de la vue côte à côte. */
type LineSide = 'both' | 'old' | 'new'

/** Classe d'une ligne du diff : en vue `new`, une ligne ajoutée ne porte qu'un filet, sans fond ni marque. */
function lineTypeClass(type: DiffLine['type'], codeView: CodeView): string {
  return codeView === 'new' && type === 'add' ? 'is-new' : `is-${type}`
}

/** Caractères `start`–`end` d'une ligne marqués comme indentation ajoutée ou retirée. */
interface IndentMark {
  start: number
  end: number
  kind: 'add' | 'del'
}

/** Morceaux de `chunks` découpés aux bornes de `mark`, chacun avec son style et son marquage. */
function markedPieces(chunks: Array<{ text: string; style?: CSSProperties }>, mark: IndentMark | null) {
  const pieces: Array<{ text: string; style?: CSSProperties; marked: boolean }> = []
  let offset = 0
  for (const { text, style } of chunks) {
    const bounds = mark ? [mark.start, mark.end].map((bound) => Math.min(Math.max(bound - offset, 0), text.length)) : []
    const cuts = [0, ...bounds, text.length]
    for (let index = 0; index < cuts.length - 1; index++) {
      if (cuts[index + 1] <= cuts[index]) continue
      const piece = text.slice(cuts[index], cuts[index + 1])
      const at = offset + cuts[index]
      pieces.push({ text: piece, style, marked: mark !== null && at >= mark.start && at < mark.end })
    }
    offset += text.length
  }
  return pieces
}

/** Texte d'une ligne, coloré par ses jetons quand il y en a, son indentation modifiée marquée. */
function CodeText({ text, tokens, mark = null }: { text: string; tokens: ThemedToken[] | undefined; mark?: IndentMark | null }) {
  const chunks = tokens ? tokens.map((token) => ({ text: token.content, style: tokenStyle(token) })) : [{ text }]
  return (
    <span className={`diff-code${tokens ? ' is-highlighted' : ''}`}>
      {markedPieces(chunks, mark).map((piece, index) => (
        <span key={index} style={piece.style} className={piece.marked ? `diff-indent is-${mark!.kind}` : undefined}>
          {piece.text}
        </span>
      ))}
    </span>
  )
}

/** Marque d'une ligne dont seule l'indentation change : flèche du sens du décalage. */
function reindentMarker(oldText: string, newText: string): string {
  const { oldEnd, newEnd } = indentChange(oldText, newText)
  return newEnd > oldEnd ? '→' : newEnd < oldEnd ? '←' : '↔'
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


/** Légende des fonds du diff, limitée à ceux que la vue et le mode affichent. */
function DiffLegend({ mode, codeView, explained, reindented }: { mode: FixMode; codeView: CodeView; explained: boolean; reindented: boolean }) {
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
      {reindented && (
        <span className="legend-item">
          <span className="legend-swatch is-reindent" />
          Indentation modifiée
        </span>
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
 * entier), du code affiché (diff unifié, diff côte à côte avec l'ancien code à
 * gauche et le nouveau à droite, ou nouveau code seul) et de l'affichage
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
 * vert à la place de leur fond et de leur marque. Une ligne dont seule
 * l'indentation change ne forme qu'une ligne, marquée d'une flèche, son
 * indentation ajoutée ou retirée surlignée. Quand le fichier entier est
 * affiché, une mini-carte longe le bord droit du diff.
 */
export function DiffView({
  file,
  fileDiff,
  hunks,
  findings,
  notedLines,
  scrollRef,
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
  const toolbarRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const minimapShown = scope === 'file'
  const minimap = useMemo(
    () => (minimapShown ? buildMinimap(hunks, codeView, findings, notedLines) : null),
    [minimapShown, hunks, codeView, findings, notedLines],
  )

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.offsetHeight))
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  const renderStrip = (row: Extract<DiffRow, { kind: 'fix-strip' }>, key: number) => (
    <FixStrip
      key={key}
      entry={row.entry}
      bar={row.bar}
      pills={row.pills}
      applied={mode === 'applied'}
      isTarget={sameAnchor(target, { kind: 'fix', entry: row.entry })}
      onHide={() => onHideFix(row.entry.finding.id)}
    />
  )

  /**
   * Ligne du diff. `both` : ligne du diff unifié ; `old` / `new` : côté gauche
   * ou droit de la vue côte à côte. Le côté gauche porte le numéro du côté
   * « ancien » et n'accueille ni remarque, ni repère, ni pastille.
   */
  const renderLine = (row: Exclude<DiffRow, { kind: 'fix-strip' }>, side: LineSide, key?: number) => {
    if (row.kind === 'fix-line') {
      return (
        <div key={key} className={`diff-line is-proposed${barClasses(row.bar)}`} style={barStyle(row.bar)}>
          <span className="diff-num" />
          <span className="diff-marker">›</span>
          <CodeText
            text={row.text}
            tokens={syntax.status === 'ready' ? syntax.suggestion(row.entry.finding.suggestion ?? '')[row.index] : undefined}
          />
        </div>
      )
    }

    const { oldLine } = row
    const oldSide = side === 'old'
    const line = oldSide && oldLine ? oldLine : row.line
    const removedLine = oldLine ?? (line.type === 'del' ? line : null)
    const replaced = row.replaced && !oldSide
    const bar = oldSide ? null : row.bar
    const lineNo = oldSide ? null : line.newNo
    const tokens =
      syntax.status !== 'ready' || replaced
        ? undefined
        : line.type === 'del'
          ? syntax.file.oldSide.get(line.oldNo!)
          : syntax.file.newSide.get(line.newNo!)
    const change = oldLine ? indentChange(oldLine.text, row.line.text) : null
    const mark: IndentMark | null =
      change === null
        ? null
        : oldSide
          ? { start: change.start, end: change.oldEnd, kind: 'del' }
          : { start: change.start, end: change.newEnd, kind: 'add' }
    const classes = [
      'diff-line',
      oldLine ? 'is-reindent' : lineTypeClass(line.type, codeView),
      replaced ? 'is-replaced' : '',
      row.explained ? 'is-explained' : '',
      barClasses(bar).trim(),
      lineNo !== null && sameAnchor(target, { kind: 'line', line: lineNo }) ? 'is-target' : '',
    ]
    return (
      <div
        key={key}
        className={classes.filter(Boolean).join(' ')}
        style={barStyle(bar)}
        data-line={lineNo ?? undefined}
        data-old-line={side === 'new' ? undefined : (removedLine?.oldNo ?? undefined)}
      >
        {lineNo !== null && notedLines.has(lineNo) && <span className="diff-note-dot" title="Remarque sur cette ligne" />}
        {lineNo !== null && canNote ? (
          <button type="button" className="diff-num" title={`Ajouter une remarque sur la ligne ${lineNo}`} onClick={() => onLineNote(lineNo)}>
            {lineNo}
          </button>
        ) : (
          <span className="diff-num">{(oldSide ? line.oldNo : lineNo) ?? ''}</span>
        )}
        {oldLine ? (
          <span className="diff-marker" title={`Seule l'indentation de cette ligne change (ligne ${oldLine.oldNo} avant)`}>
            {reindentMarker(oldLine.text, row.line.text)}
          </span>
        ) : (
          <span className="diff-marker">{codeView === 'new' ? '' : MARKERS[line.type]}</span>
        )}
        <CodeText text={line.text} tokens={tokens} mark={replaced ? null : mark} />
        {!oldSide && row.pills.length > 0 && <DiffPills entries={row.pills} />}
      </div>
    )
  }

  return (
    <div className="diff">
      <div className="diff-toolbar" ref={toolbarRef}>
        {syntax.status === 'error' && <span className="diff-toolbar-error">Coloration syntaxique indisponible : {syntax.message}</span>}
        <OptionMenu
          label="Afficher"
          options={DIFF_SCOPE_OPTIONS}
          value={scope}
          onChange={onScopeChange}
          disabled={wholeFileAvailable ? undefined : { file: "Contenu du fichier non conservé dans l'analyse" }}
        />
        <OptionMenu label="Code" options={CODE_VIEW_OPTIONS} value={codeView} onChange={onCodeViewChange} />
        <OptionMenu label="Correctifs" options={FIX_MODE_OPTIONS} value={mode} onChange={onModeChange} />
      </div>
      <div className={`diff-body${minimapShown ? ' has-minimap' : ''}`}>
        <div className="diff-rows" ref={rowsRef}>
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
              {codeView === 'split'
                ? splitRows(hunk.rows).map((split, rowIndex) =>
                    split.kind === 'full' ? (
                      renderStrip(split.row, rowIndex)
                    ) : (
                      <div key={rowIndex} className="diff-split-row">
                        {split.left ? renderLine(split.left, 'old') : <div className="diff-line is-empty" />}
                        {split.right ? renderLine(split.right, 'new') : <div className="diff-line is-empty" />}
                      </div>
                    ),
                  )
                : hunk.rows.map((row, rowIndex) => (row.kind === 'fix-strip' ? renderStrip(row, rowIndex) : renderLine(row, 'both', rowIndex)))}
            </div>
          ))}
        </div>
        {minimap && (
          <DiffMinimap
            model={minimap}
            rowsRef={rowsRef}
            scrollRef={scrollRef}
            toolbarHeight={toolbarHeight}
          />
        )}
      </div>
      <DiffLegend
        mode={mode}
        codeView={codeView}
        explained={explained}
        reindented={hunks.some((hunk) => hunk.rows.some((row) => row.kind === 'line' && row.oldLine !== null))}
      />
    </div>
  )
}
