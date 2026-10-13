import type { AnalysisLink } from '@shared/schemas/analysis.schema'
import { hrefs } from '../utils/router'
import { Icon } from './Icon'

/**
 * Bouton vers une autre analyse de la chaîne de revues : son titre, avec une
 * flèche vers la gauche pour l'analyse suivie et vers la droite pour la revue de
 * suivi. `small` est la taille des cartes de l'accueil.
 */
export function AnalysisLinkButton({
  link,
  direction,
  small = false,
}: {
  link: AnalysisLink
  direction: 'previous' | 'next'
  small?: boolean
}) {
  const iconSize = small ? 12 : 14
  return (
    <a className={`analysis-link-button${small ? ' is-small' : ''}`} href={hrefs.feature(link.id)} title={`Ouvrir « ${link.title} »`}>
      {direction === 'previous' && <Icon name="arrow-left" size={iconSize} color="currentColor" />}
      <span className="analysis-link-button-title">{link.title}</span>
      {direction === 'next' && <Icon name="arrow-right" size={iconSize} color="currentColor" />}
    </a>
  )
}
