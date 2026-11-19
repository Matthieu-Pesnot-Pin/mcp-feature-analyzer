import type { FileEntry, FileLevel } from '@shared/schemas/analysis.schema'
import { effectiveLevel } from '@shared/file-levels'
import { FILE_LEVEL_LABELS } from '@shared/labels'
import { Icon, type IconName } from '../components/Icon'
import { OptionMenu, type MenuOption } from '../components/OptionMenu'
import { useAnalysisStore } from '../store/useAnalysisStore'

/** Icône de chaque niveau de relecture. */
export const FILE_LEVEL_ICONS: Record<FileLevel, IconName> = {
  central: 'target',
  check: 'eye',
  skim: 'chevrons-right',
}

/**
 * Bandeau sous l'en-tête du fichier : son niveau de relecture, la raison donnée
 * par l'agent et le bouton « Reclasser ». Quand le relecteur a changé le niveau,
 * le bandeau rappelle celui que proposait l'agent. Rien pour un fichier non classé.
 */
export function ClassificationBar({ file }: { file: FileEntry }) {
  const setFileLevel = useAnalysisStore((state) => state.setFileLevel)
  const classification = file.classification
  const level = effectiveLevel(file)
  if (classification === null || level === null) return null

  const options = Object.fromEntries(
    (Object.keys(FILE_LEVEL_LABELS) as FileLevel[]).map((entry) => [
      entry,
      {
        icon: FILE_LEVEL_ICONS[entry],
        label: FILE_LEVEL_LABELS[entry].label,
        description:
          entry === classification.level
            ? `${FILE_LEVEL_LABELS[entry].description} · choix de l'agent`
            : FILE_LEVEL_LABELS[entry].description,
      },
    ]),
  ) as Record<FileLevel, MenuOption>

  return (
    <div className="classification-bar">
      <span className={`level-chip is-${level}`}>
        <Icon name={FILE_LEVEL_ICONS[level]} />
        {FILE_LEVEL_LABELS[level].label}
      </span>
      <span className="classification-reason" title={classification.reason}>
        {classification.reason}
      </span>
      {classification.reviewerLevel !== null && (
        <span className="classification-override">
          Reclassé par vous · l'agent proposait {FILE_LEVEL_LABELS[classification.level].label}
        </span>
      )}
      <span className="spacer" />
      <OptionMenu
        label="Niveau de ce fichier"
        options={options}
        value={level}
        onChange={(next) => {
          if (next !== level) void setFileLevel(file.path, next)
        }}
        trigger={{ icon: 'arrow-up-down', label: 'Reclasser' }}
      />
    </div>
  )
}
