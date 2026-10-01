import { useState } from 'react'
import type { Explanation } from '@shared/schemas/analysis.schema'
import { lineRange } from '@shared/text'
import { Icon } from './Icon'

/** Au-delà de ce nombre de lignes ou de caractères, le texte est replié sur ses premières lignes. */
const FOLD_LINES = 8
const FOLD_CHARS = 600

/**
 * Carte d'une explication de l'agent dans la colonne de droite : ce que fait le
 * code décrit et comment. Les lignes sont celles du côté « ancien » pour du code
 * supprimé. Un texte long est replié, avec un bouton pour le lire en entier ; une
 * explication obsolète signale que le code décrit a changé depuis.
 */
export function MarginExplanationCard({ explanation }: { explanation: Explanation }) {
  const [expanded, setExpanded] = useState(false)
  const { side, startLine, endLine } = explanation.location
  const long = explanation.body.split('\n').length > FOLD_LINES || explanation.body.length > FOLD_CHARS

  return (
    <article className={`margin-card margin-explanation is-${explanation.status}`} data-explanation-card={explanation.id}>
      <header className="margin-card-head">
        <Icon name="info" color="#3cc4b4" />
        <span className="margin-explanation-kind">Explication</span>
        {side === 'old' && <span className="tag explanation-side">Code supprimé</span>}
        {explanation.status === 'outdated' && <span className="tag explanation-outdated-tag">Obsolète</span>}
        <span className="margin-card-lines mono" title={side === 'old' ? 'Numéros de ligne avant la feature' : undefined}>
          l. {lineRange(startLine, endLine, '–')}
        </span>
      </header>
      <h3 className="margin-card-title">{explanation.title}</h3>
      {explanation.status === 'outdated' && (
        <p className="explanation-outdated">Le code décrit a changé depuis la rédaction de cette explication : elle peut ne plus correspondre.</p>
      )}
      <p className={`margin-explanation-body${long && !expanded ? ' is-folded' : ''}`}>{explanation.body}</p>
      {long && (
        <button type="button" className="margin-explanation-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Réduire' : 'Lire la suite'}
        </button>
      )}
    </article>
  )
}
