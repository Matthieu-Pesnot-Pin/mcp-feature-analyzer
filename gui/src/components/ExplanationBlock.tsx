import { useState } from 'react'
import type { Explanation } from '@shared/schemas/analysis.schema'
import { lineRange } from '@shared/text'
import { Icon } from './Icon'

/**
 * Explication de l'agent dans le diff, au-dessus des lignes qu'elle décrit :
 * en-tête cliquable (titre, lignes, côté du diff) qui replie ou déplie le texte.
 * Une explication obsolète l'indique, car le code décrit a changé depuis.
 */
export function ExplanationBlock({ explanation }: { explanation: Explanation }) {
  const [open, setOpen] = useState(true)
  const { side, startLine, endLine } = explanation.location
  const lines = `l. ${lineRange(startLine, endLine, '–')}`

  return (
    <section className={`explanation-block is-${explanation.status}${open ? '' : ' is-collapsed'}`} data-explanation={explanation.id}>
      <button type="button" className="explanation-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} color="#646b7b" />
        <Icon name="info" color="#3cc4b4" />
        <span className="explanation-kind">Explication</span>
        <span className="explanation-title">{explanation.title}</span>
        {side === 'old' && <span className="tag explanation-side">Code supprimé</span>}
        {explanation.status === 'outdated' && <span className="tag explanation-outdated-tag">Obsolète</span>}
        <span className="explanation-lines mono" title={side === 'old' ? 'Numéros de ligne avant la feature' : undefined}>
          {lines}
        </span>
      </button>
      {open && (
        <div className="explanation-body">
          {explanation.status === 'outdated' && (
            <p className="explanation-outdated">
              Le code décrit a changé depuis la rédaction de cette explication : elle peut ne plus correspondre.
            </p>
          )}
          <p className="explanation-text">{explanation.body}</p>
        </div>
      )}
    </section>
  )
}
