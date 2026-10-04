import type { DiffLine, FileDiff, Hunk } from "./schemas/diff.schema.js";
import { splitLines } from "./text.js";

/** Première ligne d'un côté d'un bloc et nombre de lignes, au format d'un en-tête de diff unifié. */
function headerRange(count: number): string {
  return `${count === 0 ? 0 : 1},${count}`;
}

/**
 * Diff de `fileDiff` étendu au fichier entier : un seul bloc qui contient les
 * lignes des blocs du diff, et entre eux, avant et après, les lignes inchangées
 * du fichier, tirées de `newContent`, en lignes de contexte numérotées des deux
 * côtés. Null quand le snapshot ne conserve pas le contenu du fichier.
 */
export function wholeFileDiff(fileDiff: FileDiff): FileDiff | null {
  if (fileDiff.newContent === null) return null;
  const content = splitLines(fileDiff.newContent);
  const lines: DiffLine[] = [];
  // Prochaine ligne du côté « nouveau » à placer, et écart entre les numéros des deux côtés.
  let next = 1;
  let offset = 0;
  const unchangedUntil = (last: number) => {
    for (; next <= last; next++) lines.push({ type: "context", oldNo: next + offset, newNo: next, text: content[next - 1] });
  };

  for (const hunk of fileDiff.hunks) {
    // Un bloc sans ligne du côté « nouveau » se place après sa ligne `newStart`.
    unchangedUntil(hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1);
    lines.push(...hunk.lines);
    next += hunk.newLines;
    offset += hunk.oldLines - hunk.newLines;
  }
  unchangedUntil(content.length);

  const oldCount = content.length + offset;
  const hunk: Hunk = {
    header: `@@ -${headerRange(oldCount)} +${headerRange(content.length)} @@`,
    oldStart: oldCount === 0 ? 0 : 1,
    oldLines: oldCount,
    newStart: content.length === 0 ? 0 : 1,
    newLines: content.length,
    lines,
  };
  return { path: fileDiff.path, hunks: [hunk], newContent: fileDiff.newContent };
}
