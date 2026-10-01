import { Fragment, useEffect, useRef, useState } from 'react'
import type { Analysis, FileEntry } from '@shared/schemas/analysis.schema'
import { buildExplanationRequestPrompt } from '@shared/explanation-request'
import { FILE_STATUS_LABELS } from '@shared/labels'
import { FindingCard } from '../components/FindingCard'
import { Icon } from '../components/Icon'
import { SeverityDot } from '../components/Pills'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { middleEllipsisParts, openFindingsLabel, plural, splitPath } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import { DiffView, type ComposerTarget } from './DiffView'
import { FindingsMargin } from './FindingsMargin'
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
import { firstFileToReview, openFindingCounts, unlocatedFindings } from './review-model'

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
 * Panneau gauche : progression de la revue et liste des fichiers, un intertitre
 * par dossier. Chaque pastille de gravité ouvre le fichier sur son premier
 * constat ouvert de cette gravité.
 */
function FilesPanel({ analysis, currentPath }: { analysis: Analysis; currentPath: string }) {
  const reviewed = analysis.files.filter((file) => file.reviewed).length
  const progress = analysis.files.length === 0 ? 0 : (reviewed / analysis.files.length) * 100

  return (
    <aside className="files-panel">
      <div className="files-panel-head">
        <span className="files-panel-title">Fichiers</span>
        <span className="files-panel-count">
          {reviewed} / {analysis.files.length} revus
        </span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={analysis.files.length} aria-valuenow={reviewed}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <nav className="files-list">
        {analysis.files.map((file, index) => {
          const current = file.path === currentPath
          const icon = file.reviewed ? 'circle-check' : current ? 'circle-dot' : 'circle'
          const color = file.reviewed ? '#3fb950' : current ? '#8b97ff' : '#3a4050'
          const folder = splitPath(file.path).folder
          const newFolder = index === 0 ? folder !== '' : splitPath(analysis.files[index - 1].path).folder !== folder
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
              </div>
            </Fragment>
          )
        })}
      </nav>
    </aside>
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

/** En-tête du fichier revu : chemin, +/−, navigation, remarque sur le fichier et « Marquer comme revu ». */
function FileHeader({
  analysis,
  file,
  onFileNote,
}: {
  analysis: Analysis
  file: FileEntry
  onFileNote: () => void
}) {
  const setFileReviewed = useAnalysisStore((state) => state.setFileReviewed)
  const saving = useAnalysisStore((state) => state.saving)
  const index = analysis.files.findIndex((entry) => entry.path === file.path)
  const previous = analysis.files[index - 1]
  const next = analysis.files[index + 1]
  const { folder, name } = splitPath(file.path)

  return (
    <div className="file-head">
      <span className="file-head-path mono" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
        <span className="path-folder">{folder}</span>
        <span className="file-head-name">{name}</span>
      </span>
      <span className="count-add mono">+{file.additions}</span>
      <span className="count-del mono">−{file.deletions}</span>
      {file.status !== 'modified' && <span className={`tag tag-file-${file.status}`}>{FILE_STATUS_LABELS[file.status]}</span>}
      <span className="spacer" />
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
    </div>
  )
}

/**
 * Écran Revue : fichiers à gauche, diff du fichier `path` au centre avec les
 * correctifs proposés à leur place, constats et remarques dans la colonne de droite.
 */
export function ReviewScreen({ analysis, path, line }: { analysis: Analysis; path: string | null; line: number | null }) {
  const diff = useAnalysisStore((state) => state.diff)
  const diffError = useAnalysisStore((state) => state.diffError)
  const fixMode = useAnalysisStore((state) => state.fixMode)
  const setFixMode = useAnalysisStore((state) => state.setFixMode)
  const copy = useAnalysisStore((state) => state.copy)
  const findingsShown = useAnalysisStore((state) => state.findingsShown)
  const setFindingsShown = useAnalysisStore((state) => state.setFindingsShown)
  const explanationsShown = useAnalysisStore((state) => state.explanationsShown)
  const setExplanationsShown = useAnalysisStore((state) => state.setExplanationsShown)
  // La saisie d'une remarque est liée au fichier où elle a été ouverte.
  const [composerState, setComposerState] = useState<{ path: string; line: number | null } | null>(null)
  const composer: ComposerTarget = composerState && composerState.path === path ? { line: composerState.line } : null
  const setComposer = (target: ComposerTarget) => setComposerState(target && path !== null ? { path, line: target.line } : null)
  // Choix du relecteur d'afficher ou non le correctif de chaque constat dans le code.
  const [fixChoices, setFixChoices] = useState<Record<string, boolean>>({})
  // Constat amené à l'écran depuis l'index ; `seq` relance le défilement sur un même constat.
  const [reveal, setReveal] = useState<{ path: string; findingId: string; line: number; seq: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)

  const fallbackPath = firstFileToReview(analysis)
  useEffect(() => {
    if (path === null && fallbackPath !== null) navigate(hrefs.review(analysis.id, fallbackPath), { replace: true })
  }, [path, fallbackPath, analysis.id])

  const file = analysis.files.find((entry) => entry.path === path) ?? null
  const fileDiff = diff?.id === analysis.id ? diff.snapshot.files.find((entry) => entry.path === path) : undefined
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
  useEffect(() => {
    const body = bodyRef.current
    if (!fileDiff || !body) return
    if (targetSelector === null) {
      body.scrollTo({ top: 0 })
      return
    }
    body.querySelector(targetSelector)?.scrollIntoView({ block: 'center' })
    if (revealedId !== null) body.querySelector(`[data-finding-card="${CSS.escape(revealedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [fileDiff, targetSelector, path, revealedId, revealSeq])

  if (path === null) {
    return (
      <div className="page">
        <p className="empty-text">L'analyse ne contient aucun fichier modifié : il n'y a rien à revoir.</p>
      </div>
    )
  }

  const explanations = explanationsOfFile(analysis, path)
  const shownExplanations = explanationsShown ? explanations : []
  const hunks = fileDiff ? buildDiffRows(fileDiff, numbered, fixes, fixMode, shownExplanations) : []
  const shownLines = fileDiff ? shownLineNumbers(fileDiff) : failed ? new Set<number>() : null
  const lineNotes = lineNotesOfFile(analysis, path)
  const notedLines = new Set(lineNotes.map((note) => note.location.line))
  const setFixShown = (findingId: string, shown: boolean) => setFixChoices((choices) => ({ ...choices, [findingId]: shown }))
  const revealFinding = (entry: NumberedFinding) => {
    setReveal((previous) => ({ path, findingId: entry.finding.id, line: entry.startLine, seq: (previous?.seq ?? 0) + 1 }))
    navigate(hrefs.review(analysis.id, path, entry.startLine))
  }

  return (
    <div className="review">
      <FilesPanel analysis={analysis} currentPath={path} />
      <section className="review-main">
        {file === null ? (
          <div className="review-body review-body-padded">
            <p className="diff-message">
              Le fichier « {path} » ne fait pas partie de cette analyse. Choisissez un fichier dans la liste.
            </p>
          </div>
        ) : (
          <>
            <FileHeader analysis={analysis} file={file} onFileNote={() => setComposer({ line: null })} />
            <div className="review-body" ref={bodyRef}>
              <div className="review-columns">
                <div className="review-center" ref={centerRef}>
                  {findingsShown && <GapBanner analysis={analysis} />}

                  {!file.contentAvailable && !file.binary && file.status !== 'deleted' && (
                    <p className="diff-notice">
                      Fichier trop volumineux pour être conservé en entier : les remarques ne peuvent viser que le fichier entier.
                    </p>
                  )}

                  {failed ? (
                    <p className="diff-message is-error">{diffError}</p>
                  ) : !fileDiff ? (
                    <p className="diff-message">Chargement du diff…</p>
                  ) : fileDiff.hunks.length === 0 ? (
                    <EmptyDiffMessage file={file} />
                  ) : (
                    <DiffView
                      file={file}
                      hunks={hunks}
                      notedLines={notedLines}
                      mode={fixMode}
                      onModeChange={setFixMode}
                      explained={shownExplanations.length > 0}
                      target={target}
                      onLineNote={(lineNo) => setComposer({ line: lineNo })}
                      onHideFix={(findingId) => setFixShown(findingId, false)}
                      onRequestExplanation={(hunk) =>
                        void copy(
                          buildExplanationRequestPrompt(analysis, file, hunk),
                          "Demande d'explication copiée : collez-la dans la conversation de l'agent.",
                        )
                      }
                    />
                  )}
                </div>
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
