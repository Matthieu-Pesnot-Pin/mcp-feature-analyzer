import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguages, bundledLanguagesInfo, type BundledLanguage } from 'shiki/langs'
import { splitLines } from '@shared/text'
import type { FileDiff } from '@shared/schemas/diff.schema'

export type { ThemedToken }

const THEME = 'github-dark-default'

/** Extensions et noms de fichier absents des identifiants et alias de Shiki. */
const EXTRA_NAMES: Record<string, BundledLanguage> = {
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  htm: 'html',
  svg: 'xml',
  pl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  makefile: 'make',
  dockerfile: 'dockerfile',
}

const NAMES = new Map<string, BundledLanguage>()
for (const info of bundledLanguagesInfo) {
  for (const name of [info.id, ...(info.aliases ?? [])]) NAMES.set(name.toLowerCase(), info.id as BundledLanguage)
}
for (const [name, lang] of Object.entries(EXTRA_NAMES)) NAMES.set(name, lang)

/** Langage Shiki d'un fichier, d'après son extension ou son nom ; null quand aucun ne correspond. */
export function languageOf(path: string): BundledLanguage | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? name : name.slice(dot + 1)
  return NAMES.get(extension) ?? NAMES.get(name) ?? null
}

/** Découpe un texte en lignes de jetons colorés. */
export type Tokenizer = (lines: string[]) => ThemedToken[][]

let highlighter: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-dark-default.mjs')],
    langs: [],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })
  return highlighter
}

/** Charge la grammaire de `lang` et renvoie le découpeur en jetons de ce langage. */
export async function loadTokenizer(lang: BundledLanguage): Promise<Tokenizer> {
  const core = await getHighlighter()
  if (!core.getLoadedLanguages().includes(lang)) await core.loadLanguage(bundledLanguages[lang])
  return (lines) => (lines.length === 0 ? [] : core.codeToTokensBase(lines.join('\n'), { lang, theme: THEME }))
}

/** Jetons colorés des lignes d'un fichier du diff, par numéro de ligne de chaque côté. */
export interface FileTokens {
  /** Lignes du côté « nouveau », par `newNo`. */
  newSide: Map<number, ThemedToken[]>
  /** Lignes du côté « ancien », par `oldNo`. */
  oldSide: Map<number, ThemedToken[]>
}

/**
 * Colore les lignes du diff d'un fichier. Le côté « nouveau » est coloré à
 * partir du contenu complet du fichier quand le snapshot le conserve, sinon bloc
 * par bloc ; le côté « ancien » est coloré bloc par bloc, lignes de contexte et
 * lignes supprimées mises bout à bout.
 */
export function tokenizeFile(fileDiff: FileDiff, tokenize: Tokenizer): FileTokens {
  const newSide = new Map<number, ThemedToken[]>()
  const oldSide = new Map<number, ThemedToken[]>()

  if (fileDiff.newContent !== null) {
    const lastShown = Math.max(0, ...fileDiff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.newNo ?? 0)))
    tokenize(splitLines(fileDiff.newContent).slice(0, lastShown)).forEach((tokens, index) => newSide.set(index + 1, tokens))
  }

  for (const hunk of fileDiff.hunks) {
    const oldLines = hunk.lines.filter((line) => line.type !== 'add')
    tokenize(oldLines.map((line) => line.text)).forEach((tokens, index) => oldSide.set(oldLines[index].oldNo!, tokens))
    if (fileDiff.newContent === null) {
      const newLines = hunk.lines.filter((line) => line.type !== 'del')
      tokenize(newLines.map((line) => line.text)).forEach((tokens, index) => newSide.set(newLines[index].newNo!, tokens))
    }
  }

  return { newSide, oldSide }
}
