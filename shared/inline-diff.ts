import type { DiffLine } from "./schemas/diff.schema.js";
import type { MergedLine } from "./reindent.js";

/** Plage de caractères d'une ligne, `start` inclus, `end` exclu. */
export interface CharRange {
  start: number;
  end: number;
}

/** Parties d'une ligne supprimée et de la ligne ajoutée qui la remplace qui diffèrent de l'autre. */
export interface InlineChanges {
  removed: CharRange[];
  added: CharRange[];
}

/** Nombre maximal de mots d'une ligne au-delà duquel la comparaison n'est pas faite. */
const MAX_TOKENS = 400;

/** Part minimale des mots, hors espaces, communs aux deux lignes pour les comparer mot à mot. */
const MIN_SIMILARITY = 0.5;

interface Token {
  text: string;
  start: number;
}

/** Mots d'une ligne : identifiants et nombres, suites d'espaces, et chaque autre caractère seul. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu)) {
    tokens.push({ text: match[0], start: match.index });
  }
  return tokens;
}

function isBlank(token: Token): boolean {
  return token.text.trim() === "";
}

/** Indices des mots de `a` et de `b` qui appartiennent à leur plus longue suite commune. */
function commonTokens(a: Token[], b: Token[]): { inA: Set<number>; inB: Set<number> } {
  const width = b.length + 1;
  // lengths[i * width + j] : longueur de la plus longue suite commune de a[i..] et b[j..].
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i].text === b[j].text ? lengths[(i + 1) * width + j + 1] + 1 : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const inA = new Set<number>();
  const inB = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].text === b[j].text) {
      inA.add(i++);
      inB.add(j++);
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
    else j++;
  }
  return { inA, inB };
}

/**
 * Plages couvertes par les mots absents de `common`, les mots voisins réunis en
 * une plage ; les espaces en bord de plage n'en font pas partie.
 */
function changedRanges(tokens: Token[], common: Set<number>): CharRange[] {
  const runs: Token[][] = [];
  tokens.forEach((token, index) => {
    if (common.has(index)) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === tokens[index - 1]) last.push(token);
    else runs.push([token]);
  });
  return runs.flatMap((run) => {
    const first = run.findIndex((token) => !isBlank(token));
    if (first === -1) return [];
    const last = run.length - 1 - [...run].reverse().findIndex((token) => !isBlank(token));
    return [{ start: run[first].start, end: run[last].start + run[last].text.length }];
  });
}

function significantTokens(tokens: Token[]): string[] {
  return tokens.filter((token) => !isBlank(token)).map((token) => token.text);
}

/**
 * Majorant de la similarité de deux lignes : part des mots, hors espaces, que
 * leurs deux multiensembles ont en commun, sans tenir compte de l'ordre.
 */
function similarityBound(a: string[], b: string[]): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  const counts = new Map<string, number>();
  for (const text of a) counts.set(text, (counts.get(text) ?? 0) + 1);
  let shared = 0;
  for (const text of b) {
    const count = counts.get(text) ?? 0;
    if (count === 0) continue;
    counts.set(text, count - 1);
    shared++;
  }
  return shared / longest;
}

/** Comparaison mot à mot de deux lignes : parties qui diffèrent et part des mots, hors espaces, en commun. */
function compareLines(oldTokens: Token[], newTokens: Token[]): { changes: InlineChanges; similarity: number } | null {
  if (oldTokens.length > MAX_TOKENS || newTokens.length > MAX_TOKENS) return null;
  const { inA, inB } = commonTokens(oldTokens, newTokens);
  const shared = [...inA].filter((index) => !isBlank(oldTokens[index])).length;
  const longest = Math.max(significantTokens(oldTokens).length, significantTokens(newTokens).length);
  if (longest === 0 || shared / longest < MIN_SIMILARITY) return null;
  return { changes: { removed: changedRanges(oldTokens, inA), added: changedRanges(newTokens, inB) }, similarity: shared / longest };
}

/**
 * Parties qui diffèrent entre une ligne supprimée et la ligne ajoutée qui la
 * remplace, comparées mot à mot. Null quand les lignes sont identiques, trop
 * longues, ou trop différentes pour qu'un surlignage partiel ait un sens :
 * moins de la moitié de leurs mots, hors espaces, en commun.
 */
export function inlineChanges(oldText: string, newText: string): InlineChanges | null {
  if (oldText === newText) return null;
  return compareLines(tokenize(oldText), tokenize(newText))?.changes ?? null;
}

/** Ligne supprimée et ligne ajoutée qui la remplace, désignées par leur position dans leur suite. */
export interface LinePair {
  removed: number;
  added: number;
  changes: InlineChanges;
}

/** Nombre maximal de couples de lignes comparés pour apparier une suite de lignes supprimées et ajoutées. */
const MAX_PAIRS = 40_000;

/**
 * Appariement d'une suite de lignes supprimées et de la suite de lignes ajoutées
 * qui la suit. Chaque ligne supprimée est associée au plus à une ligne ajoutée
 * assez proche pour être comparée mot à mot, dans le respect de l'ordre des deux
 * suites, de façon à maximiser la somme des similarités : une ligne insérée ou
 * retirée entre deux lignes modifiées ne décale pas l'appariement. Vide quand le
 * nombre de couples à comparer dépasse `MAX_PAIRS`.
 */
export function pairSimilarLines(removed: string[], added: string[]): LinePair[] {
  if (removed.length === 0 || added.length === 0 || removed.length * added.length > MAX_PAIRS) return [];
  const removedTokens = removed.map(tokenize);
  const addedTokens = added.map(tokenize);
  const removedWords = removedTokens.map(significantTokens);
  const addedWords = addedTokens.map(significantTokens);
  const width = added.length;
  const comparisons: ({ changes: InlineChanges; similarity: number } | null)[] = new Array(removed.length * width).fill(null);
  for (let i = 0; i < removed.length; i++) {
    for (let j = 0; j < added.length; j++) {
      if (removed[i] === added[j] || similarityBound(removedWords[i], addedWords[j]) < MIN_SIMILARITY) continue;
      comparisons[i * width + j] = compareLines(removedTokens[i], addedTokens[j]);
    }
  }
  // scores[i * (width + 1) + j] : meilleure somme des similarités des appariements de removed[i..] et added[j..].
  const scores = new Float64Array((removed.length + 1) * (width + 1));
  const score = (i: number, j: number) => scores[i * (width + 1) + j];
  for (let i = removed.length - 1; i >= 0; i--) {
    for (let j = added.length - 1; j >= 0; j--) {
      const comparison = comparisons[i * width + j];
      const matched = comparison ? comparison.similarity + score(i + 1, j + 1) : 0;
      scores[i * (width + 1) + j] = Math.max(matched, score(i + 1, j), score(i, j + 1));
    }
  }
  const pairs: LinePair[] = [];
  let i = 0;
  let j = 0;
  while (i < removed.length && j < added.length) {
    const comparison = comparisons[i * width + j];
    if (comparison && comparison.similarity + score(i + 1, j + 1) === score(i, j)) {
      pairs.push({ removed: i++, added: j++, changes: comparison.changes });
    } else if (score(i + 1, j) >= score(i, j + 1)) i++;
    else j++;
  }
  return pairs;
}

/** Parties modifiées d'une ligne et ligne de l'autre côté à laquelle elle est comparée. */
export interface InlineMatch {
  ranges: CharRange[];
  counterpart: DiffLine;
}

/**
 * Parties modifiées des lignes d'un bloc. Dans chaque suite de lignes supprimées
 * suivie de lignes ajoutées, hors lignes dont seule l'indentation change, les
 * lignes sont appariées par `pairSimilarLines`. Seules les lignes appariées
 * figurent dans le résultat.
 */
export function inlineChangesOfLines(lines: MergedLine[]): Map<DiffLine, InlineMatch> {
  const result = new Map<DiffLine, InlineMatch>();
  const single = (index: number, type: DiffLine["type"]) => lines[index]?.oldLine === null && lines[index].line.type === type;
  let index = 0;
  while (index < lines.length) {
    if (!single(index, "del")) {
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (single(index, "del")) removed.push(lines[index++].line);
    while (single(index, "add")) added.push(lines[index++].line);
    const pairs = pairSimilarLines(
      removed.map((line) => line.text),
      added.map((line) => line.text),
    );
    for (const pair of pairs) {
      result.set(removed[pair.removed], { ranges: pair.changes.removed, counterpart: added[pair.added] });
      result.set(added[pair.added], { ranges: pair.changes.added, counterpart: removed[pair.removed] });
    }
  }
  return result;
}
