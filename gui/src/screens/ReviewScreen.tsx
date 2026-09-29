import { Fragment, useEffect, useRef, useState } from 'react'
import type { Analysis, FileEntry } from '@shared/schemas/analysis.schema'
import { FILE_STATUS_LABELS } from '@shared/labels'
import { FindingCard } from '../components/FindingCard'
import { Icon } from '../components/Icon'
import { NoteCard, NoteComposer } from '../components/Notes'
import { SeverityDot } from '../components/Pills'
import { useAnalysisStore } from '../store/useAnalysisStore'
import { splitPath } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import { DiffView, type ComposerTarget } from './DiffView'
import { firstFileToReview, openFindingCounts, unlocatedFindings } from './review-model'

/** Panneau gauche : progression de la revue et liste des fichiers, un intertitre par dossier. */
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
              <a
                href={hrefs.review(analysis.id, file.path)}
                className={`files-item${current ? ' is-current' : ''}${file.reviewed ? ' is-reviewed' : ''}`}
                title={file.path}
                aria-current={current ? 'page' : undefined}
              >
                <Icon name={icon} color={color} />
                <span className="files-item-name">{splitPath(file.path).name}</span>
                {openFindingCounts(analysis, file.path).map(({ severity, count }) => (
                  <SeverityDot key={severity} severity={severity} count={count} />
                ))}
              </a>
            </Fragment>
          )
        })}
      </nav>
    </aside>
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

/** Écran Revue : fichiers à gauche, diff du fichier `path` avec constats et remarques. */
export function ReviewScreen({ analysis, path, line }: { analysis: Analysis; path: string | null; line: number | null }) {
  const diff = useAnalysisStore((state) => state.diff)
  const diffError = useAnalysisStore((state) => state.diffError)
  // La saisie d'une remarque est liée au fichier où elle a été ouverte.
  const [composerState, setComposerState] = useState<{ path: string; line: number | null } | null>(null)
  const composer: ComposerTarget = composerState && composerState.path === path ? { line: composerState.line } : null
  const setComposer = (target: ComposerTarget) => setComposerState(target && path !== null ? { path, line: target.line } : null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const fallbackPath = firstFileToReview(analysis)
  useEffect(() => {
    if (path === null && fallbackPath !== null) navigate(hrefs.review(analysis.id, fallbackPath), { replace: true })
  }, [path, fallbackPath, analysis.id])

  const file = analysis.files.find((entry) => entry.path === path) ?? null
  const fileDiff = diff?.id === analysis.id ? diff.snapshot.files.find((entry) => entry.path === path) : undefined

  // Ligne ciblée par `?line=N` : centrée à l'écran ; sans ligne, retour en haut du fichier.
  useEffect(() => {
    if (!fileDiff) return
    if (line === null) {
      bodyRef.current?.scrollTo({ top: 0 })
      return
    }
    bodyRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' })
  }, [fileDiff, line, path])

  if (path === null) {
    return (
      <div className="page">
        <p className="empty-text">L'analyse ne contient aucun fichier modifié : il n'y a rien à revoir.</p>
      </div>
    )
  }

  const gaps = analysis.files[0]?.path === path ? unlocatedFindings(analysis) : []
  const fileNotes = analysis.notes.filter((note) => note.location?.path === path && note.location.line === null)

  return (
    <div className="review">
      <FilesPanel analysis={analysis} currentPath={path} />
      <section className="review-main">
        {file === null ? (
          <div className="review-body">
            <p className="diff-message">
              Le fichier « {path} » ne fait pas partie de cette analyse. Choisissez un fichier dans la liste.
            </p>
          </div>
        ) : (
          <>
            <FileHeader analysis={analysis} file={file} onFileNote={() => setComposer({ line: null })} />
            <div className="review-body" ref={bodyRef}>
              {gaps.length > 0 && (
                <section className="gap-banner">
                  <h3 className="block-title">
                    <Icon name="triangle-alert" color="#e3a33b" />
                    Exigences manquantes et constats sans emplacement
                  </h3>
                  {gaps.map((finding) => (
                    <FindingCard key={finding.id} analysis={analysis} finding={finding} />
                  ))}
                </section>
              )}

              {(fileNotes.length > 0 || composer?.line === null) && (
                <section className="file-notes">
                  {fileNotes.map((note) => (
                    <NoteCard key={note.id} note={note} />
                  ))}
                  {composer?.line === null && <NoteComposer path={file.path} line={null} onClose={() => setComposer(null)} />}
                </section>
              )}

              {!file.contentAvailable && !file.binary && file.status !== 'deleted' && (
                <p className="diff-notice">
                  Fichier trop volumineux pour être conservé en entier : les remarques ne peuvent viser que le fichier entier.
                </p>
              )}

              {diffError && diff?.id !== analysis.id ? (
                <p className="diff-message is-error">{diffError}</p>
              ) : !fileDiff ? (
                <p className="diff-message">Chargement du diff…</p>
              ) : fileDiff.hunks.length === 0 ? (
                <EmptyDiffMessage file={file} />
              ) : (
                <DiffView
                  analysis={analysis}
                  file={file}
                  fileDiff={fileDiff}
                  targetLine={line}
                  composer={composer}
                  setComposer={setComposer}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
