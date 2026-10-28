import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { foldRegions, hiddenLines, stepFold, type FoldRegion } from '@shared/code-folding'
import type { FileEntry } from '@shared/schemas/analysis.schema'
import { CONTEXT_STEP, type HunkContext } from '@shared/context-expansion'
import type { DiffLine, FileDiff, Hunk } from '@shared/schemas/diff.schema'
import { SEVERITY_STYLES } from '@shared/labels'
import { indentChange } from '@shared/reindent'
import { splitLines } from '@shared/text'
import { Icon } from '../components/Icon'
import { FindingNumber } from '../components/MarginFindingCard'
import { OptionMenu } from '../components/OptionMenu'
import { plural } from '../utils/format'
import type { ThemedToken } from '../utils/syntax'
import { DiffMinimap } from './DiffMinimap'
import {
  buildMinimap,
  CODE_VIEW_OPTIONS,
  DIFF_SCOPE_OPTIONS,
  FIX_MODE_OPTIONS,
  foldText,
  replacedLinesLabel,
  rowKey,
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

/**
 * Ligne où s'ouvre la saisie d'une remarque ; `line` null vise le fichier entier.
 * `findingId` désigne le constat auquel la remarque répond, null pour une remarque libre.
 */
export type ComposerTarget = { line: number | null; findingId: string | null } | null

interface DiffViewProps {
  file: FileEntry
  /** Diff figé du fichier, source de la coloration syntaxique. */
  fileDiff: FileDiff
  hunks: HunkRows[]
  /** Contexte de chaque bloc, élargissable depuis son en-tête ; null quand les blocs ne s'élargissent pas. */
  hunkContexts: HunkContext[] | null
  /** Numéros, côté « nouveau », des lignes de contexte ajoutées autour des blocs. */
  addedContext: ReadonlySet<number> | null
  /** Ajoute (`1`) ou retire (`-1`) une tranche de lignes de contexte autour du bloc `hunkIndex`. */
  onContextChange: (hunkIndex: number, delta: 1 | -1) => void
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
  /** Mode zen : les réglages sont dans la barre de l'écran et le rail des repères tient lieu de mini-carte. */
  zen: boolean
}

interface DiffOptionMenusProps {
  scope: DiffScope
  onScopeChange: (scope: DiffScope) => void
  /** Le snapshot conserve le contenu du fichier : il peut s'afficher en entier. */
  wholeFileAvailable: boolean
  codeView: CodeView
  onCodeViewChange: (view: CodeView) => void
  mode: FixMode
  onModeChange: (mode: FixMode) => void
}

/** Réglages du diff : étendue affichée, code affiché et affichage des correctifs. */
export function DiffOptionMenus({
  scope,
  onScopeChange,
  wholeFileAvailable,
  codeView,
  onCodeViewChange,
  mode,
  onModeChange,
}: DiffOptionMenusProps) {
  return (
    <>
      <OptionMenu
        label="Afficher"
        options={DIFF_SCOPE_OPTIONS}
        value={scope}
        onChange={onScopeChange}
        disabled={wholeFileAvailable ? undefined : { file: "Contenu du fichier non conservé dans l'analyse" }}
      />
      <OptionMenu label="Code" options={CODE_VIEW_OPTIONS} value={codeView} onChange={onCodeViewChange} />
      <OptionMenu label="Correctifs" options={FIX_MODE_OPTIONS} value={mode} onChange={onModeChange} />
    </>
  )
}

const MARKERS: Record<DiffLine['type'], string> = { context: ' ', add: '+', del: '−' }

/** Place d'une ligne : diff sur une colonne, ou côté gauche / droit de la vue côte à côte. */
type LineSide = 'both' | 'old' | 'new'

/** Classe d'une ligne du diff : en vue `new`, une ligne ajoutée ne porte qu'un filet, sans fond ni marque. */
function lineTypeClass(type: DiffLine['type'], codeView: CodeView): string {
  return codeView === 'new' && type === 'add' ? 'is-new' : `is-${type}`
}

/** Caractères `start`–`end` d'une ligne surlignés avec la classe `className`. */
interface TextMark {
  start: number
  end: number
  className: string
}

/** Morceaux de `chunks` découpés aux bornes des `marks`, chacun avec son style et la classe de la marque qui le couvre. */
function markedPieces(chunks: Array<{ text: string; style?: CSSProperties }>, marks: TextMark[]) {
  const pieces: Array<{ text: string; style?: CSSProperties; className?: string }> = []
  let offset = 0
  for (const { text, style } of chunks) {
    const bounds = marks.flatMap((mark) => [mark.start, mark.end]).map((bound) => Math.min(Math.max(bound - offset, 0), text.length))
    const cuts = [...new Set([0, ...bounds, text.length])].sort((a, b) => a - b)
    for (let index = 0; index < cuts.length - 1; index++) {
      const at = offset + cuts[index]
      const mark = marks.find((entry) => at >= entry.start && at < entry.end)
      pieces.push({ text: text.slice(cuts[index], cuts[index + 1]), style, className: mark?.className })
    }
    offset += text.length
  }
  return pieces
}

/** Texte d'une ligne, coloré par ses jetons quand il y en a, ses parties modifiées surlignées, suivi de `suffix`. */
function CodeText({
  text,
  tokens,
  marks = [],
  suffix,
}: {
  text: string
  tokens: ThemedToken[] | undefined
  marks?: TextMark[]
  suffix?: ReactNode
}) {
  const chunks = tokens ? tokens.map((token) => ({ text: token.content, style: tokenStyle(token) })) : [{ text }]
  return (
    <span className={`diff-code${tokens ? ' is-highlighted' : ''}`}>
      {markedPieces(chunks, marks).map((piece, index) => (
        <span key={index} style={piece.style} className={piece.className}>
          {piece.text}
        </span>
      ))}
      {suffix}
    </span>
  )
}

/** Bloc repliable qui s'ouvre sur une ligne : son état et le nombre de lignes qu'il replie. */
interface LineFold {
  folded: boolean
  lines: number
  /** Clic : replie ou déplie le bloc ; Ctrl+clic : repli progressif. */
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void
}

/** Case de repli d'une ligne, entre son numéro et sa marque ; vide quand aucun bloc ne s'ouvre sur la ligne. */
function FoldToggle({ fold }: { fold: LineFold | null }) {
  if (!fold) return <span className="diff-fold" />
  return (
    <button
      type="button"
      className={`diff-fold${fold.folded ? ' is-folded' : ''}`}
      aria-expanded={!fold.folded}
      title={
        fold.folded
          ? 'Déplier le bloc · Ctrl+clic : tout déplier'
          : 'Replier le bloc · Ctrl+clic : replier niveau par niveau, des blocs les plus imbriqués vers celui-ci'
      }
      onClick={fold.onToggle}
    >
      <Icon name={fold.folded ? 'chevron-right' : 'chevron-down'} size={14} />
    </button>
  )
}

/** Repère d'un bloc replié, après le texte de sa première ligne : un clic le déplie. */
function FoldEllipsis({ fold }: { fold: LineFold | null }) {
  if (!fold?.folded) return null
  return (
    <button type="button" className="diff-fold-ellipsis" title="Déplier le bloc" onClick={fold.onToggle}>
      ⋯ {plural(fold.lines, 'ligne')}
    </button>
  )
}

/** Blocs repliables d'un bloc du diff, repérés par la clé de leur première rangée. */
interface HunkFolding {
  regions: FoldRegion[]
  /** Clé de la première rangée de chaque bloc repliable. */
  keys: string[]
  folded: Set<number>
  /** Indice du bloc repliable qui s'ouvre sur chaque rangée. */
  regionAt: Map<number, number>
  /** Rangées masquées par un bloc replié. */
  hidden: Set<number>
  /** Position de chaque rangée dans le bloc du diff. */
  rowIndex: Map<DiffRow, number>
}

function hunkFolding(hunk: HunkRows, foldedKeys: ReadonlySet<string>): HunkFolding {
  const regions = foldRegions(hunk.rows.map(foldText))
  const keys = regions.map((region) => rowKey(hunk.rows[region.start]))
  const folded = new Set(regions.flatMap((_, index) => (foldedKeys.has(keys[index]) ? [index] : [])))
  return {
    regions,
    keys,
    folded,
    regionAt: new Map(regions.map((region, index) => [region.start, index])),
    hidden: hiddenLines(regions, folded),
    rowIndex: new Map(hunk.rows.map((row, index) => [row, index])),
  }
}

const NO_FOLDS: ReadonlySet<string> = new Set()

/**
 * Surlignages d'une ligne : son indentation ajoutée ou retirée quand seule
 * l'indentation change, sinon ses parties modifiées par rapport à la ligne
 * qui lui correspond.
 */
function lineMarks(row: Extract<DiffRow, { kind: 'line' }>, line: DiffLine, oldSide: boolean): TextMark[] {
  if (row.replaced && !oldSide) return []
  if (row.oldLine) {
    const change = indentChange(row.oldLine.text, row.line.text)
    return oldSide
      ? [{ start: change.start, end: change.oldEnd, className: 'diff-indent is-del' }]
      : [{ start: change.start, end: change.newEnd, className: 'diff-indent is-add' }]
  }
  if (!row.inline || line.type === 'context') return []
  return row.inline.map((range) => ({ ...range, className: `diff-inline is-${line.type}` }))
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
  /** Bandeau masqué par un bloc replié. */
  foldHidden: boolean
  onHide: () => void
}

/**
 * Bandeau d'un correctif dans le diff : avant les lignes qu'il remplace, ou,
 * correctif appliqué, avant les lignes proposées qui en tiennent lieu.
 */
function FixStrip({ entry, bar, pills, applied, isTarget, foldHidden, onHide }: FixStripProps) {
  const removes = splitLines(entry.finding.suggestion ?? '').length === 0
  const lines = replacedLinesLabel(entry.startLine, entry.endLine)
  const action = removes ? `supprime ${lines}` : `remplace ${lines}`
  return (
    <div
      className={`fix-strip${applied ? ' is-applied' : ''}${barClasses(bar)}${isTarget ? ' is-target' : ''}${foldHidden ? ' is-fold-hidden' : ''}`}
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

interface ContextStepperProps {
  context: HunkContext
  onChange: (delta: 1 | -1) => void
}

/**
 * Réglage du contexte d'un bloc, dans son en-tête : « −5 » retire et « +5 »
 * ajoute cinq lignes au-dessus et en dessous du bloc ; entre les deux, le
 * nombre de lignes de contexte au-dessus de la première modification.
 */
function ContextStepper({ context, onChange }: ContextStepperProps) {
  return (
    <div className="context-stepper" role="group" aria-label="Contexte du bloc">
      <button
        type="button"
        className="context-stepper-button"
        disabled={!context.canShrink}
        title={`Retirer ${CONTEXT_STEP} lignes de contexte au-dessus et en dessous`}
        onClick={() => onChange(-1)}
      >
        <Icon name="fold-vertical" size={12} />−{CONTEXT_STEP}
      </button>
      <span className="context-stepper-count">{plural(context.context, 'ligne')}</span>
      <button
        type="button"
        className="context-stepper-button"
        disabled={!context.canGrow}
        title={`Ajouter ${CONTEXT_STEP} lignes de contexte au-dessus et en dessous`}
        onClick={() => onChange(1)}
      >
        <Icon name="unfold-vertical" size={12} />+{CONTEXT_STEP}
      </button>
    </div>
  )
}

/** Légende des fonds du diff, limitée à ceux que la vue et le mode affichent. */
function DiffLegend({
  mode,
  codeView,
  explained,
  reindented,
  inlined,
  expanded,
}: {
  mode: FixMode
  codeView: CodeView
  explained: boolean
  reindented: boolean
  inlined: boolean
  expanded: boolean
}) {
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
      {inlined && (
        <span className="legend-item">
          <span className={`legend-swatch ${codeView === 'new' ? 'is-inline-add' : 'is-inline'}`} />
          Partie modifiée de la ligne
        </span>
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
      {expanded && (
        <span className="legend-item">
          <span className="legend-swatch is-expanded" />
          Contexte ajouté
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
 * vert à la place de leur fond et de leur marque. Quand une ligne supprimée et
 * la ligne ajoutée qui la remplace se ressemblent, seules leurs parties
 * modifiées sont surlignées, sans fond sur le reste de la ligne. Une ligne dont seule
 * l'indentation change ne forme qu'une ligne, marquée d'une flèche, son
 * indentation ajoutée ou retirée surlignée. Quand le fichier entier est
 * affiché hors mode zen, une mini-carte longe le bord droit du diff ; en
 * « Modifications », l'en-tête de
 * chaque bloc élargit ou réduit son contexte, les lignes de contexte ajoutées
 * se distinguant par un fond plus sombre et un filet. Les blocs de code,
 * délimités par l'indentation, se replient depuis la case à gauche de leur
 * première ligne : un clic replie ou déplie le bloc ; un Ctrl+clic replie
 * d'abord ses sous-blocs les plus imbriqués, puis un niveau de plus à chaque
 * clic jusqu'au bloc lui-même, et déplie le tout une fois le bloc replié. Les
 * rangées repliées restent dans le diff sans hauteur.
 */
export function DiffView({
  file,
  fileDiff,
  hunks,
  hunkContexts,
  addedContext,
  onContextChange,
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
  zen,
}: DiffViewProps) {
  const canNote = file.contentAvailable
  const syntax = useSyntaxTokens(fileDiff)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const [folds, setFolds] = useState<{ path: string; keys: ReadonlySet<string> }>({ path: file.path, keys: NO_FOLDS })
  const foldedKeys = folds.path === file.path ? folds.keys : NO_FOLDS
  const folding = hunks.map((hunk) => hunkFolding(hunk, foldedKeys))
  // En mode zen, la barre du diff ne s'affiche que pour signaler une coloration syntaxique indisponible.
  const toolbarShown = !zen || syntax.status === 'error'
  const minimapShown = scope === 'file' && !zen
  const minimap = useMemo(
    () => (minimapShown ? buildMinimap(hunks, codeView, findings, notedLines) : null),
    [minimapShown, hunks, codeView, findings, notedLines],
  )

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) {
      setToolbarHeight(0)
      return
    }
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.offsetHeight))
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [toolbarShown])

  /** Clic sur la case de repli du bloc `regionIndex` du bloc du diff `hunkIndex`. */
  const toggleFold = (hunkIndex: number, regionIndex: number, event: MouseEvent<HTMLButtonElement>) => {
    const { regions, keys, folded } = folding[hunkIndex]
    let next: Set<number>
    if (event.ctrlKey || event.metaKey) {
      next = stepFold(regions, regionIndex, folded)
    } else {
      next = new Set(folded)
      if (!next.delete(regionIndex)) next.add(regionIndex)
    }
    const hunkKeys = new Set(keys)
    const kept = [...foldedKeys].filter((key) => !hunkKeys.has(key))
    setFolds({ path: file.path, keys: new Set([...kept, ...[...next].map((index) => keys[index])]) })
  }

  /** Bloc repliable qui s'ouvre sur la rangée `rowIndex` du bloc du diff `hunkIndex`, null s'il n'y en a pas. */
  const lineFold = (hunkIndex: number, rowIndex: number): LineFold | null => {
    const { regions, folded, regionAt } = folding[hunkIndex]
    const regionIndex = regionAt.get(rowIndex)
    if (regionIndex === undefined) return null
    const region = regions[regionIndex]
    return {
      folded: folded.has(regionIndex),
      lines: region.end - region.start,
      onToggle: (event) => toggleFold(hunkIndex, regionIndex, event),
    }
  }

  const renderStrip = (row: Extract<DiffRow, { kind: 'fix-strip' }>, key: number, foldHidden: boolean) => (
    <FixStrip
      key={key}
      entry={row.entry}
      bar={row.bar}
      pills={row.pills}
      applied={mode === 'applied'}
      isTarget={sameAnchor(target, { kind: 'fix', entry: row.entry })}
      foldHidden={foldHidden}
      onHide={() => onHideFix(row.entry.finding.id)}
    />
  )

  /**
   * Ligne du diff. `both` : ligne du diff unifié ; `old` / `new` : côté gauche
   * ou droit de la vue côte à côte. Le côté gauche porte le numéro du côté
   * « ancien » et n'accueille ni remarque, ni repère, ni pastille. `fold` est le
   * bloc repliable qui s'ouvre sur la ligne ; `foldHidden`, une ligne masquée par
   * un bloc replié.
   */
  const renderLine = (
    row: Exclude<DiffRow, { kind: 'fix-strip' }>,
    side: LineSide,
    fold: LineFold | null,
    foldHidden: boolean,
    key?: number,
  ) => {
    if (row.kind === 'fix-line') {
      return (
        <div
          key={key}
          className={`diff-line is-proposed${barClasses(row.bar)}${foldHidden ? ' is-fold-hidden' : ''}`}
          style={barStyle(row.bar)}
        >
          <span className="diff-num" />
          <FoldToggle fold={fold} />
          <span className="diff-marker">›</span>
          <CodeText
            text={row.text}
            tokens={syntax.status === 'ready' ? syntax.suggestion(row.entry.finding.suggestion ?? '')[row.index] : undefined}
            suffix={<FoldEllipsis fold={fold} />}
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
    const marks = lineMarks(row, line, oldSide)
    const classes = [
      'diff-line',
      oldLine ? 'is-reindent' : lineTypeClass(line.type, codeView),
      !oldLine && !replaced && row.inline ? 'has-inline' : '',
      replaced ? 'is-replaced' : '',
      line.type === 'context' && line.newNo !== null && addedContext?.has(line.newNo) ? 'is-expanded' : '',
      row.explained ? 'is-explained' : '',
      barClasses(bar).trim(),
      lineNo !== null && sameAnchor(target, { kind: 'line', line: lineNo }) ? 'is-target' : '',
      foldHidden ? 'is-fold-hidden' : '',
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
        <FoldToggle fold={fold} />
        {oldLine ? (
          <span className="diff-marker" title={`Seule l'indentation de cette ligne change (ligne ${oldLine.oldNo} avant)`}>
            {reindentMarker(oldLine.text, row.line.text)}
          </span>
        ) : (
          <span className="diff-marker">{codeView === 'new' ? '' : MARKERS[line.type]}</span>
        )}
        <CodeText text={line.text} tokens={tokens} marks={marks} suffix={<FoldEllipsis fold={fold} />} />
        {!oldSide && row.pills.length > 0 && <DiffPills entries={row.pills} />}
      </div>
    )
  }

  return (
    <div className="diff">
      {toolbarShown && (
        <div className="diff-toolbar" ref={toolbarRef}>
          {syntax.status === 'error' && <span className="diff-toolbar-error">Coloration syntaxique indisponible : {syntax.message}</span>}
          {!zen && (
            <DiffOptionMenus
              scope={scope}
              onScopeChange={onScopeChange}
              wholeFileAvailable={wholeFileAvailable}
              codeView={codeView}
              onCodeViewChange={onCodeViewChange}
              mode={mode}
              onModeChange={onModeChange}
            />
          )}
        </div>
      )}
      <div className={`diff-body${minimapShown ? ' has-minimap' : ''}`}>
        <div className="diff-rows" ref={rowsRef}>
          {hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className="hunk">
              <div className="hunk-header">
                <span className="hunk-header-text mono">{hunk.hunk.header}</span>
                {hunkContexts?.[hunkIndex] && (
                  <ContextStepper context={hunkContexts[hunkIndex]} onChange={(delta) => onContextChange(hunkIndex, delta)} />
                )}
                <button
                  type="button"
                  className="hunk-explain"
                  title="Copier un prompt qui demande à l'agent d'expliquer ce bloc et d'ajouter ses explications à l'analyse"
                  aria-label="Copier une demande d'explication"
                  onClick={() => onRequestExplanation(hunk.hunk)}
                >
                  <Icon name="bot" color="#3cc4b4" />
                </button>
              </div>
              {codeView === 'split'
                ? splitRows(hunk.rows).map((split, rowIndex) => {
                    const { hidden, rowIndex: indexOf } = folding[hunkIndex]
                    if (split.kind === 'full') return renderStrip(split.row, rowIndex, hidden.has(indexOf.get(split.row)!))
                    const leftIndex = split.left ? indexOf.get(split.left)! : null
                    const rightIndex = split.right ? indexOf.get(split.right)! : null
                    const pairHidden = [leftIndex, rightIndex].every((index) => index === null || hidden.has(index))
                    // Le côté gauche ne porte la case de repli que d'une ligne supprimée, absente du côté droit.
                    const leftFold =
                      split.left && leftIndex !== null && split.left !== split.right && split.left.line.type === 'del'
                        ? lineFold(hunkIndex, leftIndex)
                        : null
                    return (
                      <div key={rowIndex} className={`diff-split-row${pairHidden ? ' is-fold-hidden' : ''}`}>
                        {split.left ? renderLine(split.left, 'old', leftFold, false) : <div className="diff-line is-empty" />}
                        {split.right && rightIndex !== null ? (
                          renderLine(split.right, 'new', lineFold(hunkIndex, rightIndex), false)
                        ) : (
                          <div className="diff-line is-empty" />
                        )}
                      </div>
                    )
                  })
                : hunk.rows.map((row, rowIndex) => {
                    const foldHidden = folding[hunkIndex].hidden.has(rowIndex)
                    return row.kind === 'fix-strip'
                      ? renderStrip(row, rowIndex, foldHidden)
                      : renderLine(row, 'both', lineFold(hunkIndex, rowIndex), foldHidden, rowIndex)
                  })}
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
        inlined={hunks.some((hunk) => hunk.rows.some((row) => row.kind === 'line' && row.inline !== null && !row.replaced))}
        expanded={addedContext !== null && addedContext.size > 0}
      />
    </div>
  )
}
