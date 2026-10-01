import { useEffect, useMemo, useState } from 'react'
import type { FileDiff } from '@shared/schemas/diff.schema'
import { splitLines } from '@shared/text'
import { languageOf, loadTokenizer, tokenizeFile, type FileTokens, type ThemedToken, type Tokenizer } from '../utils/syntax'

export type SyntaxState =
  | { status: 'none' }
  | {
      status: 'ready'
      file: FileTokens
      /** Lignes colorées d'un correctif proposé. */
      suggestion: (text: string) => ThemedToken[][]
    }
  | { status: 'error'; message: string }

type Loaded = { lang: string; tokenizer: Tokenizer } | { lang: string; error: string }

/**
 * Coloration syntaxique du diff `fileDiff` dans le langage déduit du chemin du
 * fichier. `none` pendant le chargement de la grammaire et quand aucun langage
 * ne correspond au fichier ; `error` quand la grammaire ne se charge pas.
 */
export function useSyntaxTokens(fileDiff: FileDiff): SyntaxState {
  const lang = languageOf(fileDiff.path)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (lang === null) return
    let cancelled = false
    loadTokenizer(lang).then(
      (tokenizer) => !cancelled && setLoaded({ lang, tokenizer }),
      (error: unknown) => !cancelled && setLoaded({ lang, error: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      cancelled = true
    }
  }, [lang])

  const current = loaded !== null && loaded.lang === lang ? loaded : null
  const tokenizer = current !== null && 'tokenizer' in current ? current.tokenizer : null

  return useMemo<SyntaxState>(() => {
    if (current !== null && 'error' in current) return { status: 'error', message: current.error }
    if (tokenizer === null) return { status: 'none' }
    const cache = new Map<string, ThemedToken[][]>()
    const suggestion = (text: string) => {
      let tokens = cache.get(text)
      if (!tokens) {
        tokens = tokenizer(splitLines(text))
        cache.set(text, tokens)
      }
      return tokens
    }
    return { status: 'ready', file: tokenizeFile(fileDiff, tokenizer), suggestion }
  }, [current, tokenizer, fileDiff])
}
