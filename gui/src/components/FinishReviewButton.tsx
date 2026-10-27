import type { Analysis } from '@shared/schemas/analysis.schema'
import { hrefs, navigate } from '../utils/router'

/** Bouton « Terminer la revue » de la barre supérieure : ouvre l'écran Fin de revue. */
export function FinishReviewButton({ analysis }: { analysis: Analysis }) {
  return (
    <button type="button" className="button button-primary topbar-action" onClick={() => navigate(hrefs.finish(analysis.id))}>
      Terminer la revue
    </button>
  )
}
