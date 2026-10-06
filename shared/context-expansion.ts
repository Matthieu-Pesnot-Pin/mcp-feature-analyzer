import type { DiffLine, FileDiff, Hunk } from "./schemas/diff.schema.js";
import { splitLines } from "./text.js";

/** Nombre de lignes de contexte ajoutées, ou retirées, au-dessus et en dessous d'un bloc par clic. */
export const CONTEXT_STEP = 5;

/** État du contexte d'un bloc affiché. */
export interface HunkContext {
  /** Lignes de contexte affichées au-dessus de la première ligne modifiée du bloc. */
  context: number;
  /** Indices des blocs du diff d'origine réunis dans ce bloc. */
  members: number[];
  /** Le bloc porte des lignes de contexte ajoutées. */
  canShrink: boolean;
  /** Le fichier a encore des lignes à ajouter au-dessus ou en dessous du bloc. */
  canGrow: boolean;
}

export interface ExpandedDiff {
  fileDiff: FileDiff;
  /** Contexte de chaque bloc affiché, dans l'ordre des blocs. */
  hunks: HunkContext[];
  /** Lignes ajoutées autour de chaque bloc du diff d'origine, du côté qui en compte le plus. */
  extras: number[];
  /** Numéros, côté « nouveau », des lignes de contexte ajoutées. */
  added: Set<number>;
}

/** Plage d'un côté d'un en-tête de diff unifié : `12` pour une ligne, `12,4` sinon. */
function headerRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

/** Bloc couvrant les plages données, en-tête recalculé à partir de celui de `source`. */
function rangedHunk(source: Hunk, oldStart: number, newStart: number, lines: DiffLine[]): Hunk {
  const oldLines = lines.filter((line) => line.type !== "add").length;
  const newLines = lines.filter((line) => line.type !== "del").length;
  const rest = source.header.replace(/^@@[^@]*@@/, "");
  return {
    header: `@@ -${headerRange(oldStart, oldLines)} +${headerRange(newStart, newLines)} @@${rest}`,
    oldStart,
    oldLines,
    newStart,
    newLines,
    lines,
  };
}

/** Nombre de lignes de contexte en tête du bloc, avant sa première ligne modifiée. */
function leadingContext(hunk: Hunk): number {
  const index = hunk.lines.findIndex((line) => line.type !== "context");
  return index === -1 ? hunk.lines.length : index;
}

/** Bloc d'origine élargi, avant réunion avec ses voisins. */
interface ExpandedPart {
  hunk: Hunk;
  above: number;
  below: number;
  canGrow: boolean;
  /** Toutes les lignes qui le séparent du bloc précédent sont affichées. */
  joinsPrevious: boolean;
}

/**
 * Diff de `fileDiff` dont chaque bloc `i` gagne jusqu'à `extras[i]` lignes de
 * contexte au-dessus et autant en dessous, tirées de `newContent`. Les lignes
 * entre deux blocs vont d'abord au bloc du dessus, puis au bloc du dessous,
 * sans jamais se recouvrir ; le début et la fin du fichier bornent aussi
 * l'élargissement. Deux blocs que plus aucune ligne masquée ne sépare n'en
 * forment plus qu'un. Un bloc sans ligne ajoutée ni voisin réuni reste
 * inchangé. Null quand le snapshot ne conserve pas le contenu du fichier.
 */
export function expandContext(fileDiff: FileDiff, extras: readonly number[]): ExpandedDiff | null {
  if (fileDiff.newContent === null) return null;
  const content = splitLines(fileDiff.newContent);
  const added = new Set<number>();
  const parts: ExpandedPart[] = [];
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

    const expanded =
      above === 0 && below === 0
        ? hunk
        : rangedHunk(hunk, (hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart) - above, first - above, [
            ...Array.from({ length: above }, (_, k) => contextLine(first - above + k, offset)),
            ...hunk.lines,
            ...Array.from({ length: below }, (_, k) => contextLine(last + 1 + k, after)),
          ]);

    parts.push({
      hunk: expanded,
      above,
      below,
      canGrow: above < aboveRoom || below < belowRoom,
      joinsPrevious: index > 0 && above === aboveRoom,
    });
    offset = after;
    shownUntil = last + below;
  });

  const groups: number[][] = [];
  parts.forEach((part, index) => {
    if (part.joinsPrevious) groups[groups.length - 1].push(index);
    else groups.push([index]);
  });

  const hunks = groups.map((members) => {
    if (members.length === 1) return parts[members[0]].hunk;
    const head = parts[members[0]].hunk;
    return rangedHunk(
      head,
      head.oldLines === 0 ? head.oldStart + 1 : head.oldStart,
      head.newLines === 0 ? head.newStart + 1 : head.newStart,
      members.flatMap((member) => parts[member].hunk.lines),
    );
  });
  const contexts = groups.map((members) => ({
    context: leadingContext(fileDiff.hunks[members[0]]) + parts[members[0]].above,
    members,
    canShrink: members.some((member) => parts[member].above > 0 || parts[member].below > 0),
    canGrow: members.some((member) => parts[member].canGrow),
  }));

  return {
    fileDiff: { ...fileDiff, hunks },
    hunks: contexts,
    extras: parts.map((part) => Math.max(part.above, part.below)),
    added,
  };
}

/**
 * Élargissement de chaque bloc d'origine après un clic sur « +5 » (`delta`
 * `1`) ou « −5 » (`-1`) dans l'en-tête du bloc affiché `hunkIndex` : chacun
 * des blocs qu'il réunit gagne ou perd une tranche de lignes.
 */
export function stepContext(expanded: ExpandedDiff, hunkIndex: number, delta: 1 | -1): number[] {
  const next = [...expanded.extras];
  for (const member of expanded.hunks[hunkIndex].members) {
    next[member] = Math.max(0, next[member] + delta * CONTEXT_STEP);
  }
  return next;
}
