import { Fragment, useEffect, useState } from 'react'
import type { Analysis, FileEntry } from '@shared/schemas/analysis.schema'
import { hasClassification } from '@shared/file-levels'
import { FILE_LEVEL_LABELS, FILE_STATUS_LABELS, FILE_STATUS_LETTERS } from '@shared/labels'
import { Icon } from '../components/Icon'
import { NoteDot, SeverityDot } from '../components/Pills'
import { middleEllipsisParts, openFindingsLabel, plural, splitPath } from '../utils/format'
import { hrefs, navigate } from '../utils/router'
import {
  fileNoteCount,
  filesOfTab,
  firstFileOfTab,
  LEVEL_TABS,
  openFindingCounts,
  skimmedWithFindings,
  tabOf,
  type LevelTab,
} from './review-model'

/** Libellé d'un onglet de la liste des fichiers. */
function tabLabel(tab: LevelTab): string {
  return tab === 'unclassified' ? 'Non classés' : FILE_LEVEL_LABELS[tab].label
}

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
 * Ligne d'un fichier : état de revue, nom, pastilles des constats ouverts par
 * gravité et des remarques, lettre du statut git. Chaque pastille de gravité
 * ouvre le fichier sur son premier constat ouvert de cette gravité ; la pastille
 * des remarques, sur sa première remarque de ligne.
 */
function FileRow({ analysis, file, current }: { analysis: Analysis; file: FileEntry; current: boolean }) {
  const icon = file.reviewed ? 'circle-check' : current ? 'circle-dot' : 'circle'
  const color = file.reviewed ? '#3fb950' : current ? '#8b97ff' : '#3a4050'
  const notes = fileNoteCount(analysis, file.path)
  return (
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
  )
}

/** Fichiers, un intertitre par dossier. */
function FileRows({ analysis, files, currentPath }: { analysis: Analysis; files: FileEntry[]; currentPath: string }) {
  return (
    <nav className="files-list">
      {files.map((file, index) => {
        const folder = splitPath(file.path).folder
        const newFolder = index === 0 ? folder !== '' : splitPath(files[index - 1].path).folder !== folder
        return (
          <Fragment key={file.path}>
            {newFolder && (
              <span className="files-group mono" title={folder || 'racine du dépôt'}>
                {folder || './'}
              </span>
            )}
            <FileRow analysis={analysis} file={file} current={file.path === currentPath} />
          </Fragment>
        )
      })}
    </nav>
  )
}

/**
 * Onglets des niveaux de relecture, chacun avec son nombre de fichiers. L'onglet
 * Survol porte un point quand un de ses fichiers a un constat ouvert ; l'onglet
 * des fichiers non classés n'apparaît que s'il en reste.
 */
function LevelTabs({
  analysis,
  tab,
  onChange,
  skimAlert,
}: {
  analysis: Analysis
  tab: LevelTab
  onChange: (tab: LevelTab) => void
  skimAlert: boolean
}) {
  const tabs = LEVEL_TABS.filter((entry) => entry !== 'unclassified' || filesOfTab(analysis, entry).length > 0)
  return (
    <div className="level-tabs" role="tablist" aria-label="Niveaux de relecture">
      {tabs.map((entry) => (
        <button
          key={entry}
          type="button"
          role="tab"
          aria-selected={entry === tab}
          className={`level-tab${entry === tab ? ' is-active' : ''}`}
          title={entry === 'unclassified' ? "Fichiers que l'agent n'a pas classés" : FILE_LEVEL_LABELS[entry].description}
          onClick={() => onChange(entry)}
        >
          {tabLabel(entry)}
          <span className="level-tab-count">{filesOfTab(analysis, entry).length}</span>
          {entry === 'skim' && skimAlert && <span className="level-tab-alert" aria-label="un fichier en survol a un constat" />}
        </button>
      ))}
    </div>
  )
}

/** Encart vers le niveau suivant qui contient des fichiers ; rien après le dernier. */
function NextLevelCard({ analysis, tab, onOpen }: { analysis: Analysis; tab: LevelTab; onOpen: (tab: LevelTab) => void }) {
  const next = LEVEL_TABS.slice(LEVEL_TABS.indexOf(tab) + 1).find((entry) => filesOfTab(analysis, entry).length > 0)
  if (next === undefined) return null
  const count = filesOfTab(analysis, next).length
  return (
    <button type="button" className="level-card level-next" onClick={() => onOpen(next)}>
      <span className="level-card-text">
        <span className="level-card-label">Ensuite</span>
        <span className="level-card-title">
          {tabLabel(next)} · {plural(count, 'fichier')}
        </span>
      </span>
      <Icon name="arrow-right" color="#9aa1b1" />
    </button>
  )
}

/** Encart des fichiers en survol qui portent un constat ouvert : ils méritent quand même d'être lus. */
function SkimFindingsCard({ analysis, files }: { analysis: Analysis; files: FileEntry[] }) {
  return (
    <div className="level-card level-alert">
      <Icon name="circle-alert" color="#e3a33b" />
      <span className="level-card-text">
        <span className="level-alert-title">
          {files.length > 1 ? `${files.length} fichiers en survol ont un constat` : 'Un fichier en survol a un constat'}
        </span>
        {files.map((file) => (
          <a key={file.path} className="level-alert-link" href={hrefs.review(analysis.id, file.path)} title={file.path}>
            {splitPath(file.path).name}
          </a>
        ))}
      </span>
    </div>
  )
}

/**
 * Panneau gauche : liste des fichiers. Quand l'agent a classé les fichiers, un
 * onglet par niveau de relecture n'en montre qu'un à la fois, suivi d'un encart
 * vers le niveau suivant et, hors de l'onglet Survol, des fichiers en survol qui
 * portent un constat. L'onglet affiché suit le niveau du fichier ouvert. La
 * progression de la revue est dans la barre supérieure.
 */
export function FilesPanel({ analysis, currentPath }: { analysis: Analysis; currentPath: string }) {
  const currentFile = analysis.files.find((file) => file.path === currentPath)
  const currentTab = currentFile ? tabOf(currentFile) : null
  const [tab, setTab] = useState<LevelTab>(currentTab ?? 'central')
  useEffect(() => {
    if (currentTab !== null) setTab(currentTab)
  }, [currentPath, currentTab])

  const classified = hasClassification(analysis)
  const skimmed = skimmedWithFindings(analysis)
  const openTab = (next: LevelTab) => {
    setTab(next)
    const first = firstFileOfTab(analysis, next)
    if (first !== null) navigate(hrefs.review(analysis.id, first))
  }

  return (
    <aside className="files-panel">
      <div className="files-panel-head">
        <span className="files-panel-title">Fichiers</span>
        <span className="files-panel-count">{analysis.files.length}</span>
      </div>
      {classified ? (
        <>
          <LevelTabs analysis={analysis} tab={tab} onChange={setTab} skimAlert={skimmed.length > 0} />
          <FileRows analysis={analysis} files={filesOfTab(analysis, tab)} currentPath={currentPath} />
          <div className="level-cards">
            <NextLevelCard analysis={analysis} tab={tab} onOpen={openTab} />
            {tab !== 'skim' && skimmed.length > 0 && <SkimFindingsCard analysis={analysis} files={skimmed} />}
          </div>
        </>
      ) : (
        <FileRows analysis={analysis} files={analysis.files} currentPath={currentPath} />
      )}
    </aside>
  )
}
