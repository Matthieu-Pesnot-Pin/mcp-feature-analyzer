const STORAGE_PREFIX = 'feature-analyzer.'

/**
 * Choix enregistré dans le navigateur sous `key` ; `fallback` quand rien n'est
 * enregistré ou que la valeur enregistrée ne fait pas partie de `options`.
 */
export function readStoredChoice<T extends string>(key: string, options: Record<T, unknown>, fallback: T): T {
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + key)
    return value !== null && Object.hasOwn(options, value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

/** Enregistre le choix `value` dans le navigateur sous `key`. */
export function storeChoice(key: string, value: string): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, value)
  } catch {
    // Stockage du navigateur indisponible : le choix vaut pour la page ouverte.
  }
}
