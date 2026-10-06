import type { DiffLine, FileDiff, Hunk } from "./schemas/diff.schema.js";
import { splitLines } from "./text.js";

/** Nombre de lignes de contexte ajoutées, ou retirées, au-dessus et en dessous d'un bloc par clic. */
export const CONTEXT_STEP = 5;

/** État du contexte d'un bloc élargi. */
export interface HunkContext {
  /** Lignes de contexte affichées au-dessus de la première ligne modifiée du bloc. */
  context: number;
  /** Lignes de contexte ajoutées au-dessus et en dessous du bloc. */
  above: number;
  below: number;
  /** Le fichier a encore des lignes à ajouter au-dessus ou en dessous du bloc. */
  canGrow: boolean;
}

export interface ExpandedDiff {
  fileDiff: FileDiff;
  /** Contexte de chaque bloc, dans l'ordre des blocs. */
  hunks: HunkContext[];
  /** Numéros, côté « nouveau », des lignes de contexte ajoutées. */
  added: Set<number>;
}

/** Plage d'un côté d'un en-tête de diff unifié : `12` pour une ligne, `12,4` sinon. */
function headerRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

/** Nombre de lignes de contexte en tête du bloc, avant sa première ligne modifiée. */
function leadingContext(hunk: Hunk): number {
  const index = hunk.lines.findIndex((line) => line.type !== "context");
  return index === -1 ? hunk.lines.length : index;
}

/**
 * Diff de `fileDiff` dont chaque bloc `i` gagne jusqu'à `extras[i]` lignes de
 * contexte au-dessus et autant en dessous, tirées de `newContent`. Les blocs
 * ne fusionnent pas : les lignes entre deux blocs vont d'abord au bloc du
 * dessus, puis au bloc du dessous, sans jamais se recouvrir ; le début et la
 * fin du fichier bornent aussi l'élargissement. Un bloc sans ligne ajoutée
 * reste inchangé. Null quand le snapshot ne conserve pas le contenu du fichier.
 */
export function expandContext(fileDiff: FileDiff, extras: readonly number[]): ExpandedDiff | null {
  if (fileDiff.newContent === null) return null;
  const content = splitLines(fileDiff.newContent);
  const added = new Set<number>();
  const contexts: HunkContext[] = [];
  const hunks: Hunk[] = [];
  // Écart entre les numéros des deux côtés avant le bloc courant, et dernière ligne déjà affichée.
  let offset = 0;
  let shownUntil = 0;

  fileDiff.hunks.forEach((hunk, index) => {
    // Premières et dernières lignes du bloc côté « nouveau » ; un bloc sans ligne de ce côté se place après `newStart`.
    const first = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;
    const last = first + hunk.newLines - 1;
    const next = fileDiff.hunks[index + 1];
    const nextFirst = next === undefined ? content.length + 1 : next.newLines === 0 ? next.newStart + 1 : next.newStart;
    const extra = Math.max(0, extras[index] ?? 0);

    const aboveRoom = first - 1 - shownUntil;
    const belowRoom = nextFirst - 1 - last;
    const above = Math.min(extra, aboveRoom);
    const below = Math.min(extra, belowRoom);
    const after = offset + hunk.oldLines - hunk.newLines;
    const contextLine = (newNo: number, shift: number): DiffLine => {
      added.add(newNo);
      return { type: "context", oldNo: newNo + shift, newNo, text: content[newNo - 1] };
    };

    if (above === 0 && below === 0) {
      hunks.push(hunk);
    } else {
      const lines = [
        ...Array.from({ length: above }, (_, k) => contextLine(first - above + k, offset)),
        ...hunk.lines,
        ...Array.from({ length: below }, (_, k) => contextLine(last + 1 + k, after)),
      ];
      const oldStart = (hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart) - above;
      const newStart = first - above;
      const oldLines = hunk.oldLines + above + below;
      const newLines = hunk.newLines + above + below;
      const rest = hunk.header.replace(/^@@[^@]*@@/, "");
      hunks.push({
        header: `@@ -${headerRange(oldStart, oldLines)} +${headerRange(newStart, newLines)} @@${rest}`,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines,
      });
    }

    contexts.push({ context: leadingContext(hunk) + above, above, below, canGrow: above < aboveRoom || below < belowRoom });
    offset = after;
    shownUntil = last + below;
  });

  return { fileDiff: { ...fileDiff, hunks }, hunks: contexts, added };
}
