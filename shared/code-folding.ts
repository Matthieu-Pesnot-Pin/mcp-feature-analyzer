/** Largeur d'une tabulation dans le calcul de l'indentation. */
const TAB_WIDTH = 4;

/**
 * Bloc repliable : la ligne `start` reste affichée, les lignes `start + 1` à
 * `end` se replient. `parent` est l'indice du bloc qui le contient le plus
 * étroitement, `depth` sa profondeur d'imbrication (0 au premier niveau).
 */
export interface FoldRegion {
  start: number;
  end: number;
  parent: number | null;
  depth: number;
}

/** Largeur de l'indentation de `text`, tabulations alignées sur `TAB_WIDTH`. */
function indentWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === " ") width++;
    else if (char === "\t") width += TAB_WIDTH - (width % TAB_WIDTH);
    else break;
  }
  return width;
}

/**
 * Blocs repliables d'une suite de lignes, d'après leur indentation : une ligne
 * ouvre un bloc quand la ligne non vide suivante est plus indentée ; le bloc
 * s'étend jusqu'à la dernière ligne non vide plus indentée qu'elle. Une entrée
 * `null` ou une ligne blanche n'ouvre ni ne ferme aucun bloc. Les blocs sont
 * rangés par première ligne.
 */
export function foldRegions(lines: ReadonlyArray<string | null>): FoldRegion[] {
  const spans: Array<{ start: number; end: number }> = [];
  const open: Array<{ start: number; indent: number }> = [];
  let last = -1;
  const close = (candidate: { start: number }) => {
    if (last > candidate.start) spans.push({ start: candidate.start, end: last });
  };
  lines.forEach((text, index) => {
    if (text === null || text.trim() === "") return;
    const indent = indentWidth(text);
    while (open.length > 0 && open[open.length - 1].indent >= indent) close(open.pop()!);
    open.push({ start: index, indent });
    last = index;
  });
  while (open.length > 0) close(open.pop()!);

  spans.sort((a, b) => a.start - b.start);
  const regions: FoldRegion[] = [];
  const stack: number[] = [];
  for (const span of spans) {
    while (stack.length > 0 && regions[stack[stack.length - 1]].end < span.start) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    regions.push({ ...span, parent, depth: parent === null ? 0 : regions[parent].depth + 1 });
    stack.push(regions.length - 1);
  }
  return regions;
}

/** Indices des lignes masquées par les blocs repliés `folded`. */
export function hiddenLines(regions: FoldRegion[], folded: ReadonlySet<number>): Set<number> {
  const hidden = new Set<number>();
  for (const index of folded) {
    const region = regions[index];
    for (let line = region.start + 1; line <= region.end; line++) hidden.add(line);
  }
  return hidden;
}

/** Vrai quand `index` est contenu, à n'importe quel niveau, dans le bloc `ancestor`. */
function isInside(regions: FoldRegion[], index: number, ancestor: number): boolean {
  for (let parent = regions[index].parent; parent !== null; parent = regions[parent].parent) {
    if (parent === ancestor) return true;
  }
  return false;
}

/** Vrai quand un bloc replié sépare `index` de son ancêtre `ancestor`. */
function hiddenBelow(regions: FoldRegion[], index: number, ancestor: number, folded: ReadonlySet<number>): boolean {
  for (let parent = regions[index].parent; parent !== null && parent !== ancestor; parent = regions[parent].parent) {
    if (folded.has(parent)) return true;
  }
  return false;
}

/**
 * Blocs repliés après un repli progressif du bloc `index` : replié, il se
 * déplie avec tous ses sous-blocs ; sinon, les sous-blocs dépliés et visibles
 * les plus profonds se replient, et le bloc lui-même quand il n'en reste plus.
 */
export function stepFold(regions: FoldRegion[], index: number, folded: ReadonlySet<number>): Set<number> {
  const next = new Set(folded);
  const descendants = regions.map((_, other) => other).filter((other) => isInside(regions, other, index));
  if (folded.has(index)) {
    next.delete(index);
    for (const other of descendants) next.delete(other);
    return next;
  }
  const open = descendants.filter((other) => !folded.has(other) && !hiddenBelow(regions, other, index, folded));
  if (open.length === 0) {
    next.add(index);
    return next;
  }
  const deepest = Math.max(...open.map((other) => regions[other].depth));
  for (const other of open) if (regions[other].depth === deepest) next.add(other);
  return next;
}
