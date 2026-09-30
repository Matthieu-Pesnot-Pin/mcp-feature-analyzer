import { useSyncExternalStore } from 'react'

/** Onglets de l'écran Feature, dans leur ordre d'affichage. */
export const FEATURE_TABS = ['summary', 'files', 'findings', 'diagrams'] as const

export type FeatureTab = (typeof FEATURE_TABS)[number]

/**
 * Écran désigné par le hash de l'URL :
 *   `#/`                                        accueil (analyses par projet) ;
 *   `#/<id>` et `#/<id>/<onglet>`               écran Feature ;
 *   `#/<id>/review[/<chemin encodé>][?line=N]`  écran Revue ;
 *   `#/<id>/finish`                             écran Fin de revue.
 */
export type Route =
  | { name: 'home' }
  | { name: 'feature'; id: string; tab: FeatureTab }
  | { name: 'review'; id: string; path: string | null; line: number | null }
  | { name: 'finish'; id: string }
  | { name: 'not_found'; hash: string }

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const queryIndex = raw.indexOf('?')
  const pathPart = queryIndex === -1 ? raw : raw.slice(0, queryIndex)
  const queryPart = queryIndex === -1 ? '' : raw.slice(queryIndex + 1)
  const segments = pathPart.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) return { name: 'home' }

  const id = decode(segments[0])
  if (id === null) return { name: 'not_found', hash }
  const [section, ...rest] = segments.slice(1)

  if (section === undefined) return { name: 'feature', id, tab: 'summary' }
  if ((FEATURE_TABS as readonly string[]).includes(section) && rest.length === 0) {
    return { name: 'feature', id, tab: section as FeatureTab }
  }
  if (section === 'finish' && rest.length === 0) return { name: 'finish', id }
  if (section === 'review' && rest.length <= 1) {
    const path = rest.length === 1 ? decode(rest[0]) : null
    if (rest.length === 1 && path === null) return { name: 'not_found', hash }
    const lineValue = new URLSearchParams(queryPart).get('line')
    const line = lineValue !== null && /^[1-9]\d*$/.test(lineValue) ? Number(lineValue) : null
    return { name: 'review', id, path, line }
  }
  return { name: 'not_found', hash }
}

/**
 * Adresse de la page courante suivie de `hash`. Un lien `#/…` seul serait
 * résolu contre le `<base href>`, qui diffère de l'adresse de la page quand un
 * relais (gateway manager, `/_gui/…`) la sert sous un autre chemin.
 */
function inPage(hash: string): string {
  return `${window.location.pathname}${window.location.search}${hash}`
}

/** Liens vers chaque écran ; le chemin d'un fichier est encodé en un seul segment. */
export const hrefs = {
  home: () => inPage('#/'),
  feature: (id: string, tab: FeatureTab = 'summary') =>
    inPage(tab === 'summary' ? `#/${encodeURIComponent(id)}` : `#/${encodeURIComponent(id)}/${tab}`),
  review: (id: string, path?: string | null, line?: number | null) => {
    const base = `#/${encodeURIComponent(id)}/review`
    if (!path) return inPage(base)
    return inPage(`${base}/${encodeURIComponent(path)}${line ? `?line=${line}` : ''}`)
  },
  finish: (id: string) => inPage(`#/${encodeURIComponent(id)}/finish`),
}

/** Change d'écran ; `replace` remplace l'entrée courante de l'historique. */
export function navigate(href: string, options: { replace?: boolean } = {}) {
  if (options.replace) {
    window.location.replace(href)
  } else {
    window.location.assign(href)
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function getHash() {
  return window.location.hash
}

/** Route courante, recalculée à chaque changement de hash. */
export function useRoute(): Route {
  return parseHash(useSyncExternalStore(subscribe, getHash))
}
