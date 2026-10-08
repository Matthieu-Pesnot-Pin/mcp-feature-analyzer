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

/**
 * Parties qui diffèrent entre une ligne supprimée et la ligne ajoutée qui la
 * remplace, comparées mot à mot. Null quand les lignes sont identiques, trop
 * longues, ou trop différentes pour qu'un surlignage partiel ait un sens :
 * moins de la moitié de leurs mots, hors espaces, en commun.
 */
export function inlineChanges(oldText: string, newText: string): InlineChanges | null {
  if (oldText === newText) return null;
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  if (oldTokens.length > MAX_TOKENS || newTokens.length > MAX_TOKENS) return null;
  const { inA, inB } = commonTokens(oldTokens, newTokens);
  const shared = [...inA].filter((index) => !isBlank(oldTokens[index])).length;
  const longest = Math.max(oldTokens.filter((token) => !isBlank(token)).length, newTokens.filter((token) => !isBlank(token)).length);
  if (longest === 0 || shared / longest < MIN_SIMILARITY) return null;
  return { removed: changedRanges(oldTokens, inA), added: changedRanges(newTokens, inB) };
}

/**
 * Parties modifiées des lignes d'un bloc. Dans chaque suite de lignes supprimées
 * suivie de lignes ajoutées, hors lignes dont seule l'indentation change, la
 * i-ème ligne supprimée est comparée à la i-ème ligne ajoutée. Seules les lignes
 * dont la comparaison aboutit figurent dans le résultat.
 */
export function inlineChangesOfLines(lines: MergedLine[]): Map<DiffLine, CharRange[]> {
  const result = new Map<DiffLine, CharRange[]>();
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
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
      const changes = inlineChanges(removed[pair].text, added[pair].text);
      if (!changes) continue;
      result.set(removed[pair], changes.removed);
      result.set(added[pair], changes.added);
    }
  }
  return result;
}
