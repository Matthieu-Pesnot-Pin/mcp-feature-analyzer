import type { Analysis } from '@shared/schemas/analysis.schema'

/** Progression de la revue, pour la barre supérieure : fichiers revus sur le total et barre étroite. */
export function ReviewProgressMeter({ analysis }: { analysis: Analysis }) {
  const total = analysis.files.length
  const reviewed = analysis.files.filter((file) => file.reviewed).length
  const percent = total === 0 ? 0 : (reviewed / total) * 100

  return (
    <div className="topbar-progress" title={`${reviewed} fichier(s) revu(s) sur ${total}`}>
      <span className="topbar-progress-label mono">
        {reviewed}/{total} revus
      </span>
      <div
        className="topbar-progress-bar"
        role="progressbar"
        aria-label="Fichiers revus"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={reviewed}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
