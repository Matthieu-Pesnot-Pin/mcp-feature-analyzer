/**
 * Copie `text` dans le presse-papiers. Lève une erreur explicite quand l'API
 * n'est pas disponible (page servie hors contexte sécurisé) ou refuse l'écriture.
 */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error(
      "le presse-papiers n'est accessible que sur une page servie en HTTPS ou sur localhost. Ouvrez la GUI par une de ces adresses.",
    )
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    throw new Error(`le navigateur a refusé l'écriture dans le presse-papiers (${(err as Error).message}).`)
  }
}
