import type { DiffLine } from "./schemas/diff.schema.js";

/** Ligne d'un bloc du diff ; `oldLine` est la ligne supprimée dont `line`, ajoutée, ne change que l'indentation. */
export interface MergedLine {
  line: DiffLine;
  oldLine: DiffLine | null;
}

/** Espaces et tabulations en tête de `text`. */
export function leadingWhitespace(text: string): string {
  return text.slice(0, text.length - text.trimStart().length);
}

/**
 * Plage de l'indentation qui diffère entre deux lignes, en caractères depuis le
 * début de la ligne : de la fin de leur indentation commune à la fin de
 * l'indentation de chacune. Une plage vide (`start === end`) n'a rien à marquer.
 */
export function indentChange(oldText: string, newText: string): { start: number; oldEnd: number; newEnd: number } {
  const oldLead = leadingWhitespace(oldText);
  const newLead = leadingWhitespace(newText);
  let start = 0;
  while (start < oldLead.length && start < newLead.length && oldLead[start] === newLead[start]) start++;
  return { start, oldEnd: oldLead.length, newEnd: newLead.length };
}

/** Paires (suppression, ajout) de la plus longue suite commune de lignes égales à l'indentation près. */
function matchReindented(removed: DiffLine[], added: DiffLine[]): Array<[number, number]> {
  const keys = (lines: DiffLine[]) => lines.map((line) => line.text.trimStart());
  const oldKeys = keys(removed);
  const newKeys = keys(added);
  const width = newKeys.length + 1;
  // lengths[i * width + j] : longueur de la plus longue suite commune de oldKeys[i..] et newKeys[j..].
  const lengths = new Uint32Array((oldKeys.length + 1) * width);
  for (let i = oldKeys.length - 1; i >= 0; i--) {
    for (let j = newKeys.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        oldKeys[i] === newKeys[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < oldKeys.length && j < newKeys.length) {
    if (oldKeys[i] === newKeys[j]) pairs.push([i++, j++]);
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Lignes d'un bloc du diff où chaque ligne supprimée puis ajoutée avec pour seule
 * différence son indentation ne forme qu'une ligne. Dans chaque suite de lignes
 * supprimées suivie de lignes ajoutées, les paires sont celles de la plus longue
 * suite commune ; entre deux paires, les lignes restantes gardent l'ordre du diff,
 * suppressions avant ajouts.
 */
export function mergeReindentedLines(lines: DiffLine[]): MergedLine[] {
  const result: MergedLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type !== "del") {
      result.push({ line: lines[index++], oldLine: null });
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index].type === "del") removed.push(lines[index++]);
    while (index < lines.length && lines[index].type === "add") added.push(lines[index++]);

    let i = 0;
    let j = 0;
    const flushUntil = (oldEnd: number, newEnd: number) => {
      for (; i < oldEnd; i++) result.push({ line: removed[i], oldLine: null });
      for (; j < newEnd; j++) result.push({ line: added[j], oldLine: null });
    };
    for (const [oldIndex, newIndex] of matchReindented(removed, added)) {
      flushUntil(oldIndex, newIndex);
      result.push({ line: added[j++], oldLine: removed[i++] });
    }
    flushUntil(removed.length, added.length);
  }
  return result;
}
