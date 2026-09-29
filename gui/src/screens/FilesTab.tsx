import type { Analysis } from '@shared/schemas/analysis.schema'
import { FILE_STATUS_LABELS } from '@shared/labels'
import { Icon } from '../components/Icon'
import { SeverityDot } from '../components/Pills'
import { openFindingsLabel, splitPath } from '../utils/format'
import { hrefs } from '../utils/router'
import { openFindingCounts } from './review-model'

/** Onglet Fichiers : chaque fichier modifié avec son statut, ses +/− et son état de revue. */
export function FilesTab({ analysis }: { analysis: Analysis }) {
  const reviewed = analysis.files.filter((file) => file.reviewed).length

  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Fichiers modifiés</h2>
        <span className="section-meta">
          {reviewed} / {analysis.files.length} revus
        </span>
      </div>
      <section className="card list-card">
        {analysis.files.length === 0 && <p className="list-empty">Le diff ne contient aucun fichier modifié.</p>}
        {analysis.files.map((file) => {
          const { folder, name } = splitPath(file.path)
          return (
            <a key={file.path} className="file-row" href={hrefs.review(analysis.id, file.path)}>
              <Icon
                name={file.reviewed ? 'circle-check' : 'circle'}
                color={file.reviewed ? '#3fb950' : '#3a4050'}
              />
              <span className="file-row-path mono" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
                <span className="path-folder">{folder}</span>
                <span className={file.reviewed ? 'path-name is-reviewed' : 'path-name'}>{name}</span>
              </span>
              <span className={`tag tag-file-${file.status}`}>{FILE_STATUS_LABELS[file.status]}</span>
              {file.binary && <span className="tag">Binaire</span>}
              <span className="spacer" />
              {openFindingCounts(analysis, file.path).map(({ severity, count }) => (
                <SeverityDot key={severity} severity={severity} count={count} title={`${openFindingsLabel(severity, count)} dans ce fichier`} />
              ))}
              <span className="file-row-counts mono">
                <span className="count-add">+{file.additions}</span>
                <span className="count-del">−{file.deletions}</span>
              </span>
              <span className={`file-row-state${file.reviewed ? ' is-reviewed' : ''}`}>{file.reviewed ? 'Revu' : 'À revoir'}</span>
            </a>
          )
        })}
      </section>
    </>
  )
}
