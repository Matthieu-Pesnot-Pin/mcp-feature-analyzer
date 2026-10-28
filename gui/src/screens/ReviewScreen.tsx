import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Analysis, FileEntry } from '@shared/schemas/analysis.schema'
import { expandContext, stepContext } from '@shared/context-expansion'
import { buildExplanationRequestPrompt } from '@shared/explanation-request'
import { FILE_STATUS_LABELS, FILE_STATUS_LETTERS } from '@shared/labels'
import { wholeFileDiff } from '@shared/whole-file-diff'
import { FindingCard } from '../components/FindingCard'
import { FinishReviewButton } from '../components/FinishReviewButton'
import { Icon } from '../components/Icon'
import { NoteComposer } from '../components/Notes'
import { NoteDot, SeverityDot } from '../components/Pills'
import { ReviewProgressMeter } from '../components/ReviewProgressMeter'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { middleEllipsisParts, openFindingsLabel, plural, splitPath } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import { DiffOptionMenus, DiffView, type ComposerTarget } from './DiffView'
import { FindingsMargin } from './FindingsMargin'
import { fileNotesOf, marginItems } from './margin-items'
import {
  anchorSelector,
  appliedRemovals,
  buildDiffRows,
  explanationsOfFile,
  lineAnchorOf,
  lineNotesOfFile,
  numberedFindingsOfFile,
  resolveFixDisplays,
  shownLineNumbers,
  type NumberedFinding,
} from './review-diff-model'
import { fileNoteCount, firstFileToReview, openFindingCounts, unlocatedFindings, zenApplies } from './review-model'
import { clampFilesPanelWidth, FILES_PANEL_WIDTH, useFilesPanelWidth, type WidthUpdate } from './useFilesPanelWidth'
import { ZenRail } from './ZenRail'

/** Nom de fichier tronqué au milieu : le début se coupe, l'extension et la fin du nom restent visibles. */
function MiddleEllipsis({ name }: { name: string }) {
  const { head, tail } = middleEllipsisParts(name)
  return (
    <span className="middle-ellipsis">
      <span className="middle-ellipsis-head">{head}</span>
      <span className="middle-ellipsis-tail">{tail}</span>
    </span>
  )
}

/**
 * Panneau gauche : liste des fichiers, un intertitre par dossier, chaque fichier
 * suivi de la lettre de son statut git. Chaque pastille de gravité ouvre le
 * fichier sur son premier constat ouvert de cette gravité ; la pastille des
 * remarques, sur sa première remarque de ligne. La progression de la
 * revue est dans la barre supérieure.
 */
function FilesPanel({ analysis, currentPath }: { analysis: Analysis; currentPath: string }) {
  return (
    <aside className="files-panel">
      <div className="files-panel-head">
        <span className="files-panel-title">Fichiers</span>
        <span className="files-panel-count">{analysis.files.length}</span>
      </div>
      <nav className="files-list">
        {analysis.files.map((file, index) => {
          const current = file.path === currentPath
          const icon = file.reviewed ? 'circle-check' : current ? 'circle-dot' : 'circle'
          const color = file.reviewed ? '#3fb950' : current ? '#8b97ff' : '#3a4050'
          const folder = splitPath(file.path).folder
          const newFolder = index === 0 ? folder !== '' : splitPath(analysis.files[index - 1].path).folder !== folder
          const notes = fileNoteCount(analysis, file.path)
          return (
            <Fragment key={file.path}>
              {newFolder && (
                <span className="files-group mono" title={folder || 'racine du dépôt'}>
                  {folder || './'}
                </span>
              )}
              <div className={`files-item${current ? ' is-current' : ''}${file.reviewed ? ' is-reviewed' : ''}`}>
                <a
                  href={hrefs.review(analysis.id, file.path)}
                  className="files-item-link"
                  title={file.path}
                  aria-current={current ? 'page' : undefined}
                >
                  <Icon name={icon} color={color} />
                  <span className="files-item-name">
                    <MiddleEllipsis name={splitPath(file.path).name} />
                  </span>
                </a>
                {openFindingCounts(analysis, file.path).map(({ severity, count, firstLine }) => (
                  <SeverityDot
                    key={severity}
                    severity={severity}
                    count={count}
                    href={hrefs.review(analysis.id, file.path, firstLine)}
                    title={`${openFindingsLabel(severity, count)} — ${count > 1 ? 'aller au premier' : 'y aller'}`}
                  />
                ))}
                {notes && (
                  <NoteDot
                    count={notes.count}
                    href={hrefs.review(analysis.id, file.path, notes.firstLine ?? undefined)}
                    title={
                      notes.firstLine === null
                        ? `${plural(notes.count, 'remarque')} sur le fichier — y aller`
                        : `${plural(notes.count, 'remarque')} — ${notes.count > 1 ? 'aller à la première' : 'y aller'}`
                    }
                  />
                )}
                <span className={`files-item-status mono is-${file.status}`} title={FILE_STATUS_LABELS[file.status]}>
                  {FILE_STATUS_LETTERS[file.status]}
                </span>
              </div>
            </Fragment>
          )
        })}
      </nav>
    </aside>
  )
}

/**
 * Poignée sur le bord droit du panneau des fichiers : un glissé règle sa largeur,
 * les flèches gauche et droite la changent de 16 px, un double-clic la remet
 * par défaut. Pendant le glissé, seule la grille de l'écran change ; la largeur
 * est enregistrée au relâchement.
 */
function FilesPanelResizer({
  width,
  setWidth,
  containerRef,
}: {
  width: number
  setWidth: (update: WidthUpdate) => void
  containerRef: RefObject<HTMLElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  const widthAt = (clientX: number) => clampFilesPanelWidth(clientX - (containerRef.current?.getBoundingClientRect().left ?? 0))

  return (
    <div
      className={`files-panel-resizer${dragging ? ' is-dragging' : ''}`}
      style={{ left: width }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Largeur de la liste des fichiers"
      aria-valuenow={width}
      aria-valuemin={FILES_PANEL_WIDTH.min}
      aria-valuemax={FILES_PANEL_WIDTH.max}
      tabIndex={0}
      title="Glisser pour régler la largeur · double-clic pour la largeur par défaut"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const container = containerRef.current
        if (!dragging || !container) return
        const next = widthAt(event.clientX)
        container.style.gridTemplateColumns = `${next}px minmax(0, 1fr)`
        event.currentTarget.style.left = `${next}px`
      }}
      onPointerUp={(event) => {
        if (!dragging) return
        setDragging(false)
        setWidth(widthAt(event.clientX))
      }}
      onDoubleClick={() => setWidth(FILES_PANEL_WIDTH.default)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setWidth((current) => current - 16)
        if (event.key === 'ArrowRight') setWidth((current) => current + 16)
      }}
    />
  )
}

/** Bandeau repliable des exigences manquantes et constats sans emplacement, au-dessus du diff. */
function GapBanner({ analysis }: { analysis: Analysis }) {
  const collapsed = useAnalysisStore((state) => state.gapsCollapsed)
  const setCollapsed = useAnalysisStore((state) => state.setGapsCollapsed)
  const gaps = unlocatedFindings(analysis)
  if (gaps.length === 0) return null
  const open = gaps.filter((finding) => finding.status === 'open').length

  return (
    <section className={`gap-banner${collapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="gap-banner-toggle block-title" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} color="#646b7b" />
        <Icon name="triangle-alert" color="#e3a33b" />
        {plural(gaps.length, 'exigence manquante', 'exigences manquantes')}
        {open !== gaps.length && <span className="gap-banner-count">· {plural(open, 'ouverte')}</span>}
      </button>
      {!collapsed && gaps.map((finding) => <FindingCard key={finding.id} analysis={analysis} finding={finding} />)}
    </section>
  )
}

/** Message affiché à la place du diff quand il n'y a pas de ligne à montrer. */
function EmptyDiffMessage({ file }: { file: FileEntry }) {
  if (file.binary) {
    return <p className="diff-message">Fichier binaire ({FILE_STATUS_LABELS[file.status].toLowerCase()}) : son contenu n'est pas affiché.</p>
  }
  if (file.status === 'renamed') {
    return <p className="diff-message">Fichier renommé depuis {file.oldPath} sans changement de contenu.</p>
  }
  return <p className="diff-message">Aucune ligne modifiée dans ce fichier (changement de mode ou fichier vide).</p>
}

/** Chemin du fichier revu, nombre de lignes ajoutées et supprimées, et statut quand il n'est pas « modifié ». */
function FilePath({ file }: { file: FileEntry }) {
  const { folder, name } = splitPath(file.path)
  return (
    <>
      <span className="file-head-path mono" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
        <span className="path-folder">{folder}</span>
        <span className="file-head-name">{name}</span>
      </span>
      <span className="count-add mono">+{file.additions}</span>
      <span className="count-del mono">−{file.deletions}</span>
      {file.status !== 'modified' && <span className={`tag tag-file-${file.status}`}>{FILE_STATUS_LABELS[file.status]}</span>}
    </>
  )
}

/** Actions sur le fichier revu : remarque sur le fichier, fichier précédent et suivant, « Marquer comme revu ». */
function FileActions({ analysis, file, onFileNote }: { analysis: Analysis; file: FileEntry; onFileNote: () => void }) {
  const setFileReviewed = useAnalysisStore((state) => state.setFileReviewed)
  const saving = useAnalysisStore((state) => state.saving)
  const index = analysis.files.findIndex((entry) => entry.path === file.path)
  const previous = analysis.files[index - 1]
  const next = analysis.files[index + 1]

  return (
    <>
      <button type="button" className="link-button muted" onClick={onFileNote}>
        <Icon name="message-square" size={13} />
        Remarque sur le fichier
      </button>
      <div className="icon-button-group">
        <button
          type="button"
          className="icon-button"
          disabled={!previous}
          title={previous ? `Fichier précédent : ${previous.path}` : 'Premier fichier'}
          onClick={() => previous && navigate(hrefs.review(analysis.id, previous.path))}
        >
          <Icon name="arrow-left" color="#9aa1b1" />
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={!next}
          title={next ? `Fichier suivant : ${next.path}` : 'Dernier fichier'}
          onClick={() => next && navigate(hrefs.review(analysis.id, next.path))}
        >
          <Icon name="arrow-right" color="#9aa1b1" />
        </button>
      </div>
      <button
        type="button"
        className={`button button-secondary reviewed-toggle${file.reviewed ? ' is-on' : ''}`}
        aria-pressed={file.reviewed}
        disabled={saving}
        onClick={() => void setFileReviewed(file.path, !file.reviewed)}
      >
        <Icon name="square-check" color={file.reviewed ? '#3fb950' : '#9aa1b1'} />
        {file.reviewed ? 'Revu' : 'Marquer comme revu'}
      </button>
    </>
  )
}

/**
 * En-tête du fichier revu : bascule du panneau des fichiers, entrée dans le mode
 * zen, chemin, +/−, remarque sur le fichier, navigation et « Marquer comme revu ».
 */
function FileHeader({ analysis, file, onFileNote }: { analysis: Analysis; file: FileEntry; onFileNote: () => void }) {
  const filesCollapsed = useAnalysisStore((state) => state.filesPanelCollapsed)
  const setFilesCollapsed = useAnalysisStore((state) => state.setFilesPanelCollapsed)
  const setZenMode = useAnalysisStore((state) => state.setZenMode)

  return (
    <div className="file-head">
      <div className="icon-button-group file-head-toggles">
        <button
          type="button"
          className="icon-button"
          aria-pressed={!filesCollapsed}
          title={filesCollapsed ? 'Afficher la liste des fichiers' : 'Masquer la liste des fichiers'}
          onClick={() => setFilesCollapsed(!filesCollapsed)}
        >
          <Icon name={filesCollapsed ? 'panel-left-open' : 'panel-left-close'} color="#9aa1b1" />
        </button>
        <button type="button" className="icon-button" title="Mode zen : le code sur toute la page" onClick={() => setZenMode(true)}>
          <Icon name="maximize" color="#9aa1b1" />
        </button>
      </div>
      <FilePath file={file} />
      <span className="spacer" />
      <FileActions analysis={analysis} file={file} onFileNote={onFileNote} />
    </div>
  )
}

/**
 * Barre unique du mode zen : marque (lien vers l'accueil), chemin et +/− du
 * fichier, réglages du diff, progression de la revue, sortie du mode zen et
 * « Terminer la revue ».
 */
function ZenBar({ analysis, file, menus }: { analysis: Analysis; file: FileEntry; menus: ReactNode }) {
  const setZenMode = useAnalysisStore((state) => state.setZenMode)

  return (
    <header className="file-head zen-bar">
      <a className="brand-mark" href={hrefs.home()} title="Feature Analyzer — accueil">
        <Icon name="scan-search" color="#8b97ff" />
      </a>
      <span className="zen-bar-separator" aria-hidden="true" />
      <FilePath file={file} />
      <div className="zen-bar-menus">{menus}</div>
      <span className="spacer" />
      <ReviewProgressMeter analysis={analysis} />
      <button
        type="button"
        className="icon-button is-on"
        aria-pressed={true}
        title="Quitter le mode zen"
        onClick={() => setZenMode(false)}
      >
        <Icon name="minimize" color="#8b97ff" />
      </button>
      <FinishReviewButton analysis={analysis} />
    </header>
  )
}

/**
 * Écran Revue : fichiers à gauche, diff du fichier `path` au centre avec les
 * correctifs proposés à leur place, constats et remarques dans la colonne de droite.
 * En mode zen : une seule barre en haut, le diff sur toute la largeur, le rail
 * des repères à droite et, flottant en bas, la saisie d'une remarque ouverte et
 * les actions sur le fichier.
 */
export function ReviewScreen({ analysis, path, line }: { analysis: Analysis; path: string | null; line: number | null }) {
  const diff = useAnalysisStore((state) => state.diff)
  const diffError = useAnalysisStore((state) => state.diffError)
  const fixMode = useAnalysisStore((state) => state.fixMode)
  const setFixMode = useAnalysisStore((state) => state.setFixMode)
  const codeView = useAnalysisStore((state) => state.codeView)
  const setCodeView = useAnalysisStore((state) => state.setCodeView)
  const diffScope = useAnalysisStore((state) => state.diffScope)
  const setDiffScope = useAnalysisStore((state) => state.setDiffScope)
  const copy = useAnalysisStore((state) => state.copy)
  const findingsShown = useAnalysisStore((state) => state.findingsShown)
  const setFindingsShown = useAnalysisStore((state) => state.setFindingsShown)
  const explanationsShown = useAnalysisStore((state) => state.explanationsShown)
  const setExplanationsShown = useAnalysisStore((state) => state.setExplanationsShown)
  const filesPanelCollapsed = useAnalysisStore((state) => state.filesPanelCollapsed)
  const zenMode = useAnalysisStore((state) => state.zenMode)
  const filesPanel = useFilesPanelWidth()
  const reviewRef = useRef<HTMLDivElement>(null)
  // La saisie d'une remarque est liée au fichier où elle a été ouverte.
  const [composerState, setComposerState] = useState<{ path: string; line: number | null; findingId: string | null } | null>(null)
  const composer: ComposerTarget =
    composerState && composerState.path === path ? { line: composerState.line, findingId: composerState.findingId } : null
  const setComposer = (target: ComposerTarget) => setComposerState(target && path !== null ? { path, ...target } : null)
  // Choix du relecteur d'afficher ou non le correctif de chaque constat dans le code.
  const [fixChoices, setFixChoices] = useState<Record<string, boolean>>({})
  // Lignes de contexte ajoutées autour de chaque bloc, par fichier puis par bloc.
  const [contextExtras, setContextExtras] = useState<Record<string, number[]>>({})
  // Constat amené à l'écran depuis l'index ; `seq` relance le défilement sur un même constat.
  const [reveal, setReveal] = useState<{ path: string; findingId: string; line: number; seq: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)

  const fallbackPath = firstFileToReview(analysis)
  useEffect(() => {
    if (path === null && fallbackPath !== null) navigate(hrefs.review(analysis.id, fallbackPath), { replace: true })
  }, [path, fallbackPath, analysis.id])

  const file = analysis.files.find((entry) => entry.path === path) ?? null
  const snapshotDiff = diff?.id === analysis.id ? diff.snapshot.files.find((entry) => entry.path === path) : undefined
  const wholeFileAvailable = snapshotDiff !== undefined && snapshotDiff.newContent !== null
  const scope = wholeFileAvailable ? diffScope : 'changes'
  // Diff de l'étendue choisie : celui du snapshot, ou le fichier entier.
  const scopedDiff = useMemo(
    () => (scope === 'file' && snapshotDiff ? (wholeFileDiff(snapshotDiff) ?? undefined) : snapshotDiff),
    [scope, snapshotDiff],
  )
  const extras = path === null ? undefined : contextExtras[path]
  // Diff affiché : en « Modifications », blocs élargis du contexte demandé ; mémorisé pour ne pas relancer la coloration syntaxique.
  const expanded = useMemo(
    () => (scope === 'changes' && snapshotDiff ? expandContext(snapshotDiff, extras ?? []) : null),
    [scope, snapshotDiff, extras],
  )
  const fileDiff = expanded?.fileDiff ?? scopedDiff
  const changeContext = (hunkIndex: number, delta: 1 | -1) => {
    if (path === null || !expanded) return
    const next = stepContext(expanded, hunkIndex, delta)
    setContextExtras((all) => ({ ...all, [path]: next }))
  }
  const failed = diffError !== null && diff?.id !== analysis.id

  const allFindings = path === null ? [] : numberedFindingsOfFile(analysis, path)
  // Constats masqués par le relecteur : ni carte, ni repère, ni correctif dans le diff.
  const numbered = findingsShown ? allFindings : []
  const fixes = resolveFixDisplays(
    numbered,
    fileDiff ?? { path: path ?? '', hunks: [], newContent: null },
    (finding) => fixChoices[finding.id] ?? (finding.suggestion !== null && finding.status === 'open'),
    fixMode,
  )
  const removed = appliedRemovals(numbered, fixes, fixMode)
  // Élément ciblé par `?line=N` : la ligne, ou le bandeau du correctif appliqué qui la retire.
  const target = line === null ? null : lineAnchorOf(line, removed)
  const targetSelector = target === null ? null : anchorSelector(target)

  const revealedId = reveal !== null && reveal.path === path && reveal.line === line ? reveal.findingId : null
  const revealSeq = reveal?.seq ?? 0

  // Élément ciblé centré à l'écran, puis carte du constat amené depuis l'index ; sans ligne, retour en haut du fichier.
  // Élargir le contexte d'un bloc ne relance pas ce défilement : il dépend du diff de l'étendue, pas du diff élargi.
  useEffect(() => {
    const body = bodyRef.current
    if (!scopedDiff || !body) return
    if (targetSelector === null) {
      body.scrollTo({ top: 0 })
      return
    }
    body.querySelector(targetSelector)?.scrollIntoView({ block: 'center' })
    if (revealedId !== null) body.querySelector(`[data-finding-card="${CSS.escape(revealedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [scopedDiff, targetSelector, path, revealedId, revealSeq])

  if (path === null) {
    return (
      <div className="page">
        <p className="empty-text">L'analyse ne contient aucun fichier modifié : il n'y a rien à revoir.</p>
      </div>
    )
  }

  const explanations = explanationsOfFile(analysis, path)
  const shownExplanations = explanationsShown ? explanations : []
  const hunks = fileDiff ? buildDiffRows(fileDiff, numbered, fixes, fixMode, shownExplanations, codeView) : []
  const shownLines = fileDiff ? shownLineNumbers(fileDiff) : failed ? new Set<number>() : null
  const lineNotes = lineNotesOfFile(analysis, path)
  const notedLines = new Set(lineNotes.map((note) => note.location.line))
  const setFixShown = (findingId: string, shown: boolean) => setFixChoices((choices) => ({ ...choices, [findingId]: shown }))
  const revealFinding = (entry: NumberedFinding) => {
    setReveal((previous) => ({ path, findingId: entry.finding.id, line: entry.startLine, seq: (previous?.seq ?? 0) + 1 }))
    navigate(hrefs.review(analysis.id, path, entry.startLine))
  }

  const center =(currentFile: FileEntry, zen: boolean) => (
    <div className="review-center" ref={centerRef}>
      {findingsShown && <GapBanner analysis={analysis} />}

      {!currentFile.contentAvailable && !currentFile.binary && currentFile.status !== 'deleted' && (
        <p className="diff-notice">
          Fichier trop volumineux pour être conservé en entier : les remarques ne peuvent viser que le fichier entier.
        </p>
      )}

      {failed ? (
        <p className="diff-message is-error">{diffError}</p>
      ) : !fileDiff ? (
        <p className="diff-message">Chargement du diff…</p>
      ) : snapshotDiff?.hunks.length === 0 ? (
        <EmptyDiffMessage file={currentFile} />
      ) : (
        <DiffView
          file={currentFile}
          fileDiff={fileDiff}
          hunks={hunks}
          hunkContexts={expanded?.hunks ?? null}
          addedContext={expanded?.added ?? null}
          onContextChange={changeContext}
          findings={numbered}
          notedLines={notedLines}
          scrollRef={bodyRef}
          mode={fixMode}
          onModeChange={setFixMode}
          codeView={codeView}
          onCodeViewChange={setCodeView}
          scope={scope}
          onScopeChange={setDiffScope}
          wholeFileAvailable={wholeFileAvailable}
          explained={shownExplanations.length > 0}
          target={target}
          onLineNote={(lineNo) => setComposer({ line: lineNo, findingId: null })}
          onHideFix={(findingId) => setFixShown(findingId, false)}
          onRequestExplanation={(hunk) =>
            void copy(
              buildExplanationRequestPrompt(analysis, currentFile, hunk),
              "Demande d'explication copiée : collez-la dans la conversation de l'agent.",
            )
          }
          zen={zen}
        />
      )}
    </div>
  )
  const openFileNote = () => setComposer({ line: null, findingId: null })

  if (file !== null && zenApplies(zenMode, analysis, path)) {
    const railItems =
      shownLines === null
        ? []
        : marginItems({
            analysis,
            file,
            numbered,
            explanations: shownExplanations,
            fileDiff: fileDiff ?? null,
            fixes,
            mode: fixMode,
            codeView,
            removed,
            lineNotes,
            shown: shownLines,
            setComposer,
            onToggleFix: setFixShown,
            revealedId,
          })
    return (
      <div className="zen">
        <ZenBar
          analysis={analysis}
          file={file}
          menus={
            <DiffOptionMenus
              scope={scope}
              onScopeChange={setDiffScope}
              wholeFileAvailable={wholeFileAvailable}
              codeView={codeView}
              onCodeViewChange={setCodeView}
              mode={fixMode}
              onModeChange={setFixMode}
            />
          }
        />
        <div className="zen-main">
          <div className="review-body" ref={bodyRef}>
            {center(file, true)}
          </div>
          <ZenRail items={railItems} fileNotes={fileNotesOf(analysis, file)} scopeRef={centerRef} scrollRef={bodyRef} />
          <div className="zen-dock">
            {composer !== null && (
              <div className="zen-composer">
                <NoteComposer
                  key={`${composer.line ?? 'file'}-${composer.findingId ?? ''}`}
                  path={file.path}
                  line={composer.line}
                  findingId={composer.findingId}
                  onClose={() => setComposer(null)}
                />
              </div>
            )}
            <div className="zen-actions">
              <FileActions analysis={analysis} file={file} onFileNote={openFileNote} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Sans fichier valide, la liste reste visible : c'est le seul moyen d'en choisir un.
  const filesHidden = filesPanelCollapsed && file !== null

  return (
    <div
      className={`review${filesHidden ? ' is-files-hidden' : ''}`}
      ref={reviewRef}
      style={filesHidden ? undefined : { gridTemplateColumns: `${filesPanel.width}px minmax(0, 1fr)` }}
    >
      {!filesHidden && <FilesPanel analysis={analysis} currentPath={path} />}
      {!filesHidden && <FilesPanelResizer width={filesPanel.width} setWidth={filesPanel.setWidth} containerRef={reviewRef} />}
      <section className="review-main">
        {file === null ? (
          <div className="review-body review-body-padded">
            <p className="diff-message">
              Le fichier « {path} » ne fait pas partie de cette analyse. Choisissez un fichier dans la liste.
            </p>
          </div>
        ) : (
          <>
            <FileHeader analysis={analysis} file={file} onFileNote={openFileNote} />
            <div className="review-body" ref={bodyRef}>
              <div className="review-columns">
                {center(file, false)}
                <FindingsMargin
                  analysis={analysis}
                  file={file}
                  numbered={numbered}
                  explanations={shownExplanations}
                  filters={{
                    findingCount: allFindings.length,
                    explanationCount: explanations.length,
                    findingsShown,
                    explanationsShown,
                    onFindingsShownChange: setFindingsShown,
                    onExplanationsShownChange: setExplanationsShown,
                  }}
                  fileDiff={fileDiff ?? null}
                  fixes={fixes}
                  mode={fixMode}
                  codeView={codeView}
                  removed={removed}
                  lineNotes={lineNotes}
                  shownLines={shownLines}
                  composer={composer}
                  setComposer={setComposer}
                  onToggleFix={setFixShown}
                  scopeRef={centerRef}
                  scrollRef={bodyRef}
                  onReveal={revealFinding}
                  revealedId={revealedId}
                />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
