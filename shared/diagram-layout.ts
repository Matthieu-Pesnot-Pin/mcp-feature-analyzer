/**
 * Placement des schémas : position et taille de chaque nœud, tracé de chaque
 * lien, pour les trois sortes de schéma (`flow`, `layers`, `mindmap`).
 * Fonctions pures et déterministes, sans dépendance, partagées par la GUI et
 * les tests. Un schéma incohérent lève une erreur explicite.
 */
import type { Diagram, DiagramNode } from "./schemas/analysis.schema.js";

export interface Point {
  x: number;
  y: number;
}

/** Police d'un texte de schéma. */
export interface TextFont {
  size: number;
  weight: number;
  mono: boolean;
}

/** Largeur d'un texte, en pixels. */
export type TextMeasure = (text: string, font: TextFont) => number;

/** Nœud placé : coin supérieur gauche et taille. */
export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Lien placé : ligne brisée de `from` vers `to`. `labelPosition` est le point
 * d'ancrage du libellé (centre vertical du texte), aligné selon `labelAnchor`.
 * `back` signale un lien qui remonte le flux (cycle) ou une boucle sur un nœud.
 */
export interface LaidOutLink {
  from: string;
  to: string;
  points: Point[];
  labelPosition: Point;
  labelAnchor: "start" | "middle";
  back: boolean;
}

/** En-tête de colonne d'un schéma `layers` : coin supérieur gauche et largeur de la colonne. */
export interface LayerHeader {
  label: string;
  x: number;
  y: number;
  width: number;
}

export interface DiagramLayout {
  nodes: LaidOutNode[];
  /** Dans l'ordre de `diagram.links`. */
  links: LaidOutLink[];
  /** Vide sauf pour `layers`. */
  headers: LayerHeader[];
  width: number;
  height: number;
}

// --- Mesure du texte ---------------------------------------------------------

/** Largeur moyenne d'un caractère en police à chasse fixe (JetBrains Mono : 0,6 em exactement). */
export const MONO_CHAR_WIDTH = 0.6;
/** Largeur moyenne d'un caractère en Inter, majorée pour couvrir capitales et accents d'un texte courant. */
export const SANS_CHAR_WIDTH = 0.56;

/** Estimation déterministe : nombre de caractères × largeur moyenne × taille de police. */
export function estimateTextWidth(text: string, font: TextFont): number {
  return [...text].length * font.size * (font.mono ? MONO_CHAR_WIDTH : SANS_CHAR_WIDTH);
}

export const LABEL_FONT_MONO: TextFont = { size: 12, weight: 400, mono: true };
export const LABEL_FONT_SANS: TextFont = { size: 12.5, weight: 400, mono: false };
export const MISSING_LABEL_FONT: TextFont = { size: 12.5, weight: 500, mono: false };
export const DECISION_FONT: TextFont = { size: 11.5, weight: 500, mono: false };
export const DETAIL_FONT: TextFont = { size: 11, weight: 400, mono: false };
export const LINK_LABEL_FONT: TextFont = { size: 10.5, weight: 400, mono: false };
export const HEADER_FONT: TextFont = { size: 10.5, weight: 600, mono: false };

/** Police du libellé d'un nœud : chasse fixe pour un nœud rattaché à un fichier. */
export function labelFont(node: DiagramNode): TextFont {
  if (node.shape === "decision") return DECISION_FONT;
  if (node.status === "missing") return MISSING_LABEL_FONT;
  return node.location ? LABEL_FONT_MONO : LABEL_FONT_SANS;
}

// --- Dimensions des nœuds ----------------------------------------------------

export const BOX_MIN_WIDTH = 140;
export const BOX_HEIGHT = 44;
export const BOX_RADIUS = 10;
export const PILL_MIN_WIDTH = 80;
export const PILL_HEIGHT = 40;
export const DECISION_MIN_SIZE = 84;
/** Marge ajoutée au libellé d'un losange : le texte tient dans sa diagonale horizontale. */
export const DECISION_TEXT_MARGIN = 36;
/** Hauteur d'un nœud « manquant » qui affiche son détail sur une deuxième ligne. */
export const DETAIL_NODE_HEIGHT = 52;
export const NODE_PADDING_X = 16;
export const PILL_PADDING_X = 24;
/** Place de l'icône de fichier : 14 px d'icône et 8 px d'espace. */
export const ICON_SLOT = 22;
/** Place de la pastille de constat à droite du libellé. */
export const DOT_SLOT = 14;
/** Largeur minimale d'une colonne de schéma `layers`. */
export const LAYER_MIN_WIDTH = 180;

/** Vrai quand le nœud affiche une icône de fichier. */
export function hasFileIcon(node: DiagramNode): boolean {
  return node.location !== null && node.shape !== "decision";
}

/** Vrai quand le nœud affiche son détail sur une deuxième ligne (nœud « manquant »). */
export function showsDetailLine(node: DiagramNode): boolean {
  return node.status === "missing" && node.shape !== "decision" && node.detail !== null && node.detail !== "";
}

interface Size {
  width: number;
  height: number;
}

function nodeSize(node: DiagramNode, measure: TextMeasure): Size {
  const label = measure(node.label, labelFont(node));
  if (node.shape === "decision") {
    const side = Math.max(DECISION_MIN_SIZE, Math.ceil(label + DECISION_TEXT_MARGIN));
    return { width: side, height: side };
  }
  const detail = showsDetailLine(node) ? measure(node.detail as string, DETAIL_FONT) : 0;
  const text = Math.max(label, detail);
  const extras = (hasFileIcon(node) ? ICON_SLOT : 0) + (node.location ? DOT_SLOT : 0);
  if (node.shape === "pill") {
    return {
      width: Math.max(PILL_MIN_WIDTH, Math.ceil(text + 2 * PILL_PADDING_X + extras)),
      height: detail > 0 ? DETAIL_NODE_HEIGHT : PILL_HEIGHT,
    };
  }
  return {
    width: Math.max(BOX_MIN_WIDTH, Math.ceil(text + 2 * NODE_PADDING_X + extras)),
    height: detail > 0 ? DETAIL_NODE_HEIGHT : BOX_HEIGHT,
  };
}

// --- Constantes de placement -------------------------------------------------

/** Marge autour du schéma. */
export const LAYOUT_PADDING = 24;
/** Écart horizontal minimal entre deux rangs d'un flux. */
const RANK_GAP = 56;
/** Écart vertical entre deux nœuds d'un même rang ou d'une même colonne. */
const NODE_GAP = 36;
/** Écart vertical autour d'un point de passage d'un lien long. */
const DUMMY_GAP = 18;
/** Écart minimal entre deux couloirs verticaux de liens dans un intervalle de rangs. */
const CHANNEL_SPACING = 12;
/** Décalage du couloir d'un lien de retour par rapport au bord du rang. */
const BACK_OFFSET = 14;
/** Distance entre le bas du schéma et le premier couloir des liens de retour. */
const BACK_CHANNEL_GAP = 30;
const BACK_CHANNEL_SPACING = 14;
/** Taille de la boucle d'un lien d'un nœud vers lui-même. */
const LOOP_SIZE = 14;
/** Distance entre un lien et son libellé. */
const LABEL_OFFSET = 8;
const LABEL_MARGIN = 8;
/** Écart horizontal entre deux colonnes d'un schéma `layers`. */
const COLUMN_GAP = 60;
/** Distance entre l'en-tête d'une colonne et son premier nœud. */
const HEADER_OFFSET = 40;
const HEADER_HEIGHT = 14;
/** Marge verticale d'un nœud qu'un lien droit ne doit pas traverser. */
const CROSS_MARGIN = 6;
/** Écart entre un nœud de carte mentale et son parent, le long du rayon. */
const RING_GAP = 48;
/** Distance minimale entre deux nœuds d'une carte mentale. */
const MINDMAP_CLEARANCE = 16;
/** Pas d'éloignement d'un nœud qui en chevauche un autre. */
const RING_STEP = 8;
const MAX_RING_ITERATIONS = 20000;
/** Passes de réduction des croisements et de placement vertical. */
const ORDER_SWEEPS = 8;
const PLACEMENT_PASSES = 12;
/** Poids d'un lien entre deux nœuds alignés, pour garder droite la branche principale. */
const ALIGN_WEIGHT = 1000;
/** Poids d'un nœud sans voisin dans la direction de la passe : il reste presque où il est. */
const FREE_WEIGHT = 0.1;
/** Écart vertical en deçà duquel un élément aligné est calé sur son voisin. */
const SNAP_DISTANCE = 4;
/** Écart vertical en deçà duquel un lien entre deux rangs est tracé droit, sans coude. */
const STRAIGHT_TOLERANCE = 2;

// --- Outils communs ----------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IndexedLink {
  u: number;
  v: number;
  label: string | null;
}

function rightMid(box: Box): Point {
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

function leftMid(box: Box): Point {
  return { x: box.x, y: box.y + box.height / 2 };
}

function centerOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moyenne pondérée ; null sans poids. */
function weightedMean(values: Array<{ value: number; weight: number }>): number | null {
  let sum = 0;
  let total = 0;
  for (const { value, weight } of values) {
    sum += value * weight;
    total += weight;
  }
  return total > 0 ? sum / total : null;
}

/**
 * Régression isotone pondérée (fusion des blocs adjacents en désordre) :
 * suite croissante la plus proche des cibles au sens des moindres carrés.
 */
function isotonic(targets: number[], weights: number[]): number[] {
  const blocks: Array<{ value: number; weight: number; count: number }> = [];
  targets.forEach((target, index) => {
    blocks.push({ value: target, weight: weights[index], count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const last = blocks.pop()!;
      const previous = blocks[blocks.length - 1];
      const weight = previous.weight + last.weight;
      previous.value = (previous.value * previous.weight + last.value * last.weight) / weight;
      previous.weight = weight;
      previous.count += last.count;
    }
  });
  return blocks.flatMap((block) => new Array<number>(block.count).fill(block.value));
}

/**
 * Place une pile de nœuds ordonnée au plus près des centres souhaités, sans
 * chevauchement : `gaps[i]` sépare l'élément `i` du suivant. Renvoie les centres.
 */
function placeStack(heights: number[], gaps: number[], desired: number[], weights: number[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  heights.forEach((height, index) => {
    offsets.push(offset);
    offset += height + (gaps[index] ?? 0);
  });
  const targets = desired.map((center, index) => center - heights[index] / 2 - offsets[index]);
  return isotonic(targets, weights).map((value, index) => value + offsets[index] + heights[index] / 2);
}

/** Centres d'une pile posée à partir de 0. */
function stackCenters(heights: number[], gaps: number[]): number[] {
  const centers: number[] = [];
  let top = 0;
  heights.forEach((height, index) => {
    centers.push(top + height / 2);
    top += height + (gaps[index] ?? 0);
  });
  return centers;
}

/** Tri stable d'une liste selon une clé numérique, départagé par la position d'origine. */
function stableSortBy<T>(items: T[], key: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, key: key(item) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ item }) => item);
}

/** Boucle d'un nœud vers lui-même : sort à droite, entre par le haut. */
function selfLoop(box: Box, id: string): LaidOutLink {
  const start = rightMid(box);
  const loopX = start.x + LOOP_SIZE;
  const loopY = box.y - LOOP_SIZE;
  const centerX = box.x + box.width / 2;
  return {
    from: id,
    to: id,
    points: [start, { x: loopX, y: start.y }, { x: loopX, y: loopY }, { x: centerX, y: loopY }, { x: centerX, y: box.y }],
    labelPosition: { x: (centerX + loopX) / 2, y: loopY - LABEL_OFFSET },
    labelAnchor: "middle",
    back: true,
  };
}

/** Supprime les points intermédiaires alignés avec leurs voisins. */
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) continue;
    if (result.length >= 2) {
      const before = result[result.length - 2];
      const cross = (last.x - before.x) * (point.y - before.y) - (last.y - before.y) * (point.x - before.x);
      if (Math.abs(cross) < 1e-6) result.pop();
    }
    result.push(point);
  }
  return result;
}

/** Point milieu du segment central d'une ligne brisée. */
function middleOf(points: Point[]): Point {
  const index = Math.max(0, Math.floor((points.length - 1) / 2));
  const a = points[index];
  const b = points[Math.min(index + 1, points.length - 1)];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Vérifie les nœuds et les liens, puis indexe les liens. */
function indexLinks(diagram: Diagram): { index: Map<string, number>; links: IndexedLink[] } {
  if (diagram.nodes.length === 0) throw new Error(`Le schéma « ${diagram.title} » ne contient aucun nœud.`);
  const index = new Map<string, number>();
  diagram.nodes.forEach((node, position) => {
    if (index.has(node.id)) throw new Error(`Le nœud « ${node.id} » apparaît deux fois dans le schéma « ${diagram.title} ».`);
    index.set(node.id, position);
  });
  const links = diagram.links.map((link) => {
    const u = index.get(link.from);
    const v = index.get(link.to);
    if (u === undefined || v === undefined) {
      const missing = u === undefined ? link.from : link.to;
      throw new Error(`Le lien ${link.from} → ${link.to} référence le nœud « ${missing} », absent du schéma « ${diagram.title} ».`);
    }
    return { u, v, label: link.label };
  });
  return { index, links };
}

// --- Flux (flow) ---------------------------------------------------------------

interface RawLayout {
  boxes: Box[];
  links: LaidOutLink[];
  headers: LayerHeader[];
  /** Point qui doit rester au centre du schéma (racine d'une carte mentale). */
  center: Point | null;
}

/** Élément d'un rang : un nœud réel, ou un point de passage (`node` null) d'un lien long. */
interface RankItem {
  node: number | null;
  rank: number;
  width: number;
  height: number;
}

function layoutFlow(diagram: Diagram, sizes: Size[], links: IndexedLink[], measure: TextMeasure): RawLayout {
  const count = diagram.nodes.length;

  // Liens de retour : repérés par un parcours en profondeur qui part des sources.
  const outgoing: number[][] = Array.from({ length: count }, () => []);
  const incoming = new Array<number>(count).fill(0);
  links.forEach((link, k) => {
    if (link.u === link.v) return;
    outgoing[link.u].push(k);
    incoming[link.v]++;
  });
  const state = new Array<number>(count).fill(0);
  const visitOrder = new Array<number>(count).fill(-1);
  const back = new Array<boolean>(links.length).fill(false);
  let visited = 0;
  const starts = [...diagram.nodes.keys()].filter((node) => incoming[node] === 0).concat([...diagram.nodes.keys()]);
  for (const start of starts) {
    if (state[start] !== 0) continue;
    state[start] = 1;
    visitOrder[start] = visited++;
    const stack = [{ node: start, next: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.next < outgoing[top.node].length) {
        const k = outgoing[top.node][top.next++];
        const target = links[k].v;
        if (state[target] === 1) back[k] = true;
        else if (state[target] === 0) {
          state[target] = 1;
          visitOrder[target] = visited++;
          stack.push({ node: target, next: 0 });
        }
      } else {
        state[top.node] = 2;
        stack.pop();
      }
    }
  }

  // Rangs : plus long chemin depuis les sources, sur le graphe sans liens de retour.
  const forward = links.map((link, k) => ({ ...link, k })).filter((link) => link.u !== link.v && !back[link.k]);
  const preds: number[][] = Array.from({ length: count }, () => []);
  const succs: number[][] = Array.from({ length: count }, () => []);
  for (const link of forward) {
    succs[link.u].push(link.v);
    preds[link.v].push(link.u);
  }
  const rank = new Array<number>(count).fill(0);
  const remaining = preds.map((list) => list.length);
  const ready = [...diagram.nodes.keys()].filter((node) => remaining[node] === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => visitOrder[a] - visitOrder[b]);
    const node = ready.shift()!;
    for (const next of succs[node]) {
      rank[next] = Math.max(rank[next], rank[node] + 1);
      if (--remaining[next] === 0) ready.push(next);
    }
  }
  // Une source se place juste avant son premier successeur.
  for (let node = 0; node < count; node++) {
    if (preds[node].length === 0 && succs[node].length > 0) {
      rank[node] = Math.min(...succs[node].map((next) => rank[next])) - 1;
    }
  }
  const rankCount = Math.max(...rank) + 1;

  // Points de passage des liens qui sautent des rangs.
  const items: RankItem[] = diagram.nodes.map((_, node) => ({ node, rank: rank[node], ...sizes[node] }));
  const chains = new Map<number, number[]>();
  for (const link of forward) {
    const chain = [link.u];
    for (let r = rank[link.u] + 1; r < rank[link.v]; r++) {
      items.push({ node: null, rank: r, width: 0, height: 0 });
      chain.push(items.length - 1);
    }
    chain.push(link.v);
    chains.set(link.k, chain);
  }
  const itemPreds: number[][] = items.map(() => []);
  const itemSuccs: number[][] = items.map(() => []);
  for (const chain of chains.values()) {
    for (let i = 1; i < chain.length; i++) {
      itemSuccs[chain[i - 1]].push(chain[i]);
      itemPreds[chain[i]].push(chain[i - 1]);
    }
  }

  // Ordre dans chaque rang : barycentre des voisins, en conservant le meilleur ordre rencontré.
  let layers: number[][] = Array.from({ length: rankCount }, () => []);
  stableSortBy([...diagram.nodes.keys()], (node) => visitOrder[node]).forEach((node) => layers[rank[node]].push(node));
  for (let item = count; item < items.length; item++) layers[items[item].rank].push(item);
  const position = new Array<number>(items.length).fill(0);
  const refresh = () => layers.forEach((layer) => layer.forEach((item, index) => (position[item] = index)));
  refresh();
  const crossings = () => {
    let total = 0;
    for (let r = 0; r + 1 < rankCount; r++) {
      const hops = layers[r].flatMap((a) => itemSuccs[a].map((b) => [position[a], position[b]]));
      for (let i = 0; i < hops.length; i++) {
        for (let j = i + 1; j < hops.length; j++) {
          if ((hops[i][0] - hops[j][0]) * (hops[i][1] - hops[j][1]) < 0) total++;
        }
      }
    }
    return total;
  };
  const reorder = (r: number, neighbours: number[][]) => {
    layers[r] = stableSortBy(layers[r], (item) => {
      const list = neighbours[item];
      return list.length > 0 ? list.reduce((sum, other) => sum + position[other], 0) / list.length : position[item];
    });
    layers[r].forEach((item, index) => (position[item] = index));
  };
  let best = layers.map((layer) => [...layer]);
  let bestCrossings = crossings();
  for (let sweep = 0; sweep < ORDER_SWEEPS && bestCrossings > 0; sweep++) {
    if (sweep % 2 === 0) for (let r = 1; r < rankCount; r++) reorder(r, itemPreds);
    else for (let r = rankCount - 2; r >= 0; r--) reorder(r, itemSuccs);
    const current = crossings();
    if (current < bestCrossings) {
      best = layers.map((layer) => [...layer]);
      bestCrossings = current;
    }
  }
  layers = best;
  refresh();

  // Alignement : chaque élément s'aligne sur son voisin médian du rang précédent, si celui-ci est libre.
  const aligned = new Set<string>();
  const taken = new Set<number>();
  for (let r = 1; r < rankCount; r++) {
    let lastPosition = -1;
    for (const item of layers[r]) {
      const candidates = [...new Set(itemPreds[item])].sort((a, b) => position[a] - position[b]);
      if (candidates.length === 0) continue;
      const median = candidates[Math.floor((candidates.length - 1) / 2)];
      if (!taken.has(median) && position[median] > lastPosition) {
        taken.add(median);
        aligned.add(`${median}>${item}`);
        lastPosition = position[median];
      }
    }
  }
  const hopWeight = (a: number, b: number) => (aligned.has(`${a}>${b}`) || aligned.has(`${b}>${a}`) ? ALIGN_WEIGHT : 1);

  // Placement vertical : passes alternées vers l'aval et vers l'amont.
  const gapsOf = (layer: number[]) =>
    layer.slice(0, -1).map((item, index) => (items[item].node === null || items[layer[index + 1]].node === null ? DUMMY_GAP : NODE_GAP));
  const center = new Array<number>(items.length).fill(0);
  for (const layer of layers) {
    stackCenters(layer.map((item) => items[item].height), gapsOf(layer)).forEach((value, index) => (center[layer[index]] = value));
  }
  for (let pass = 0; pass < PLACEMENT_PASSES; pass++) {
    const mode = pass === PLACEMENT_PASSES - 1 ? "both" : pass % 2 === 0 ? "down" : "up";
    const order = mode === "up" ? [...layers.keys()].reverse() : [...layers.keys()];
    for (const r of order) {
      const layer = layers[r];
      const desired: number[] = [];
      const weights: number[] = [];
      for (const item of layer) {
        const neighbours = mode === "down" ? itemPreds[item] : mode === "up" ? itemSuccs[item] : [...itemPreds[item], ...itemSuccs[item]];
        const values = neighbours.map((other) => ({ value: center[other], weight: hopWeight(item, other) }));
        const mean = weightedMean(values);
        desired.push(mean ?? center[item]);
        weights.push(mean === null ? FREE_WEIGHT : values.reduce((sum, entry) => sum + entry.weight, 0));
      }
      placeStack(layer.map((item) => items[item].height), gapsOf(layer), desired, weights).forEach(
        (value, index) => (center[layer[index]] = value)
      );
    }
  }

  // Redressement : un élément aligné presque à hauteur de son voisin s'y cale exactement ; ses voisins de rang s'écartent d'autant.
  for (let r = 1; r < rankCount; r++) {
    const layer = layers[r];
    const gaps = gapsOf(layer);
    const half = (item: number) => items[item].height / 2;
    layer.forEach((item, index) => {
      const partner = itemPreds[item].find((other) => aligned.has(`${other}>${item}`));
      if (partner === undefined || Math.abs(center[partner] - center[item]) > SNAP_DISTANCE) return;
      center[item] = center[partner];
      for (let j = index + 1; j < layer.length; j++) {
        const minimum = center[layer[j - 1]] + half(layer[j - 1]) + gaps[j - 1] + half(layer[j]);
        if (center[layer[j]] < minimum) center[layer[j]] = minimum;
      }
      for (let j = index - 1; j >= 0; j--) {
        const maximum = center[layer[j + 1]] - half(layer[j + 1]) - gaps[j] - half(layer[j]);
        if (center[layer[j]] > maximum) center[layer[j]] = maximum;
      }
    });
  }

  // Couloirs verticaux des liens coudés, par intervalle entre deux rangs.
  const isElbow = (a: number, b: number) => Math.abs(center[a] - center[b]) >= STRAIGHT_TOLERANCE;
  const channels: number[][] = Array.from({ length: rankCount }, () => []);
  for (const chain of chains.values()) {
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      if (isElbow(a, chain[i]) && !channels[items[a].rank].includes(a)) channels[items[a].rank].push(a);
    }
  }
  channels.forEach((list, r) => (channels[r] = stableSortBy(list, (item) => center[item])));
  const channelFraction = (r: number, item: number) => (channels[r].indexOf(item) + 1) / (channels[r].length + 1);

  // Largeur des intervalles : couloirs et libellés doivent y tenir.
  const gapWidth = channels.map((list) => Math.max(RANK_GAP, (list.length + 1) * CHANNEL_SPACING));
  for (const link of forward) {
    if (!link.label) continue;
    const chain = chains.get(link.k)!;
    const a = chain[chain.length - 2];
    const r = items[a].rank;
    const width = measure(link.label, LINK_LABEL_FONT);
    const needed = isElbow(a, link.v)
      ? (width + LABEL_OFFSET + LABEL_MARGIN) / (1 - channelFraction(r, a))
      : width + 2 * LABEL_MARGIN;
    gapWidth[r] = Math.max(gapWidth[r], needed);
  }

  const rankWidth = layers.map((layer) => Math.max(0, ...layer.map((item) => items[item].width)));
  const rankLeft: number[] = [];
  let left = 0;
  for (let r = 0; r < rankCount; r++) {
    rankLeft.push(left);
    left += rankWidth[r] + gapWidth[r];
  }
  const boxes: Box[] = diagram.nodes.map((_, node) => ({
    x: rankLeft[rank[node]] + (rankWidth[rank[node]] - sizes[node].width) / 2,
    y: center[node] - sizes[node].height / 2,
    width: sizes[node].width,
    height: sizes[node].height,
  }));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  let backIndex = 0;
  const laidOut = links.map((link, k): LaidOutLink => {
    const from = diagram.nodes[link.u].id;
    const to = diagram.nodes[link.v].id;
    if (link.u === link.v) return selfLoop(boxes[link.u], from);

    if (back[k]) {
      const start = rightMid(boxes[link.u]);
      const end = leftMid(boxes[link.v]);
      const outX = rankLeft[rank[link.u]] + rankWidth[rank[link.u]] + BACK_OFFSET;
      const inX = rankLeft[rank[link.v]] - BACK_OFFSET;
      const channelY = bottom + BACK_CHANNEL_GAP + BACK_CHANNEL_SPACING * backIndex++;
      return {
        from,
        to,
        points: [start, { x: outX, y: start.y }, { x: outX, y: channelY }, { x: inX, y: channelY }, { x: inX, y: end.y }, end],
        labelPosition: { x: (outX + inX) / 2, y: channelY - LABEL_OFFSET },
        labelAnchor: "middle",
        back: true,
      };
    }

    const chain = chains.get(k)!;
    const points: Point[] = [rightMid(boxes[link.u])];
    let labelPosition: Point = points[0];
    let labelAnchor: LaidOutLink["labelAnchor"] = "middle";
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const exit = points[points.length - 1];
      const real = items[b].node !== null;
      const entry = real ? leftMid(boxes[b]) : { x: rankLeft[items[b].rank], y: center[b] };
      if (isElbow(a, b)) {
        const r = items[a].rank;
        const channelX = rankLeft[r] + rankWidth[r] + gapWidth[r] * channelFraction(r, a);
        points.push({ x: channelX, y: exit.y }, { x: channelX, y: entry.y });
        labelPosition = { x: channelX + LABEL_OFFSET, y: (exit.y + entry.y) / 2 };
        labelAnchor = "start";
      } else {
        labelPosition = { x: (exit.x + entry.x) / 2, y: entry.y - LABEL_OFFSET };
        labelAnchor = "middle";
      }
      points.push(entry);
      if (!real) points.push({ x: rankLeft[items[b].rank] + rankWidth[items[b].rank], y: center[b] });
    }
    return { from, to, points: simplify(points), labelPosition, labelAnchor, back: false };
  });

  return { boxes, links: laidOut, headers: [], center: null };
}

// --- Couches (layers) --------------------------------------------------------

function layoutLayers(diagram: Diagram, sizes: Size[], links: IndexedLink[], measure: TextMeasure): RawLayout {
  if (diagram.layers.length === 0) throw new Error(`Le schéma en couches « ${diagram.title} » ne déclare aucune couche.`);
  const column = diagram.nodes.map((node) => {
    if (node.layer === null) {
      throw new Error(`Le nœud « ${node.id} » n'a pas de couche alors que le schéma « ${diagram.title} » est en couches.`);
    }
    const index = diagram.layers.indexOf(node.layer);
    if (index === -1) {
      throw new Error(`Le nœud « ${node.id} » est dans la couche « ${node.layer} », absente des couches déclarées (${diagram.layers.join(", ")}).`);
    }
    return index;
  });
  const columnCount = diagram.layers.length;
  const columnWidth = diagram.layers.map((layer, c) =>
    Math.max(LAYER_MIN_WIDTH, Math.ceil(measure(layer.toUpperCase(), HEADER_FONT)), ...sizes.filter((_, node) => column[node] === c).map((size) => size.width))
  );
  // Les boîtes occupent toute la largeur de leur colonne ; pastilles et losanges gardent la leur.
  const width = diagram.nodes.map((node, index) => (node.shape === "box" ? columnWidth[column[index]] : sizes[index].width));
  const height = sizes.map((size) => size.height);

  // Voisins : centre souhaité = centre du voisin, décalé d'un pas quand les deux nœuds partagent la colonne.
  const neighbours: Array<Array<{ other: number; delta: number }>> = diagram.nodes.map(() => []);
  for (const link of links) {
    if (link.u === link.v) continue;
    const delta = column[link.u] === column[link.v] ? (height[link.u] + height[link.v]) / 2 + NODE_GAP : 0;
    neighbours[link.u].push({ other: link.v, delta: -delta });
    neighbours[link.v].push({ other: link.u, delta });
  }

  const columns: number[][] = diagram.layers.map((_, c) => [...diagram.nodes.keys()].filter((node) => column[node] === c));
  const gaps = (list: number[]) => list.slice(0, -1).map(() => NODE_GAP);
  const center = new Array<number>(diagram.nodes.length).fill(0);
  const restack = (c: number) =>
    stackCenters(columns[c].map((node) => height[node]), gaps(columns[c])).forEach((value, index) => (center[columns[c][index]] = value));
  columns.forEach((_, c) => restack(c));
  const desiredOf = (node: number) => {
    const values = neighbours[node].map(({ other, delta }) => ({ value: center[other] + delta, weight: 1 }));
    return { mean: weightedMean(values), weight: values.length };
  };

  // Ordre dans chaque colonne : barycentre des voisins.
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    const order = sweep % 2 === 0 ? [...columns.keys()] : [...columns.keys()].reverse();
    for (const c of order) {
      columns[c] = stableSortBy(columns[c], (node) => desiredOf(node).mean ?? center[node]);
      restack(c);
    }
  }

  // Placement vertical au plus près des voisins, sans chevauchement.
  for (let pass = 0; pass < PLACEMENT_PASSES; pass++) {
    const order = pass % 2 === 0 ? [...columns.keys()] : [...columns.keys()].reverse();
    for (const c of order) {
      const list = columns[c];
      const targets = list.map(desiredOf);
      placeStack(
        list.map((node) => height[node]),
        gaps(list),
        targets.map((target, index) => target.mean ?? center[list[index]]),
        targets.map((target) => (target.mean === null ? FREE_WEIGHT : target.weight))
      ).forEach((value, index) => (center[list[index]] = value));
    }
  }

  const columnLeft: number[] = [];
  let left = 0;
  for (let c = 0; c < columnCount; c++) {
    columnLeft.push(left);
    left += columnWidth[c] + COLUMN_GAP;
  }
  const boxes: Box[] = diagram.nodes.map((_, node) => ({
    x: columnLeft[column[node]] + (columnWidth[column[node]] - width[node]) / 2,
    y: center[node] - height[node] / 2,
    width: width[node],
    height: height[node],
  }));
  const top = Math.min(...boxes.map((box) => box.y));
  const headers = diagram.layers.map((label, c) => ({ label, x: columnLeft[c], y: top - HEADER_OFFSET, width: columnWidth[c] }));

  /** Ordonnée libre la plus proche de `y` dans la colonne `c`. */
  const freeSlot = (c: number, y: number) => {
    const list = columns[c].map((node) => boxes[node]);
    const slots = [list[0].y - NODE_GAP / 2, ...list.slice(1).map((box, i) => (list[i].y + list[i].height + box.y) / 2)];
    slots.push(list[list.length - 1].y + list[list.length - 1].height + NODE_GAP / 2);
    return stableSortBy(slots, (slot) => Math.abs(slot - y))[0];
  };

  const laidOut = links.map((link): LaidOutLink => {
    const from = diagram.nodes[link.u].id;
    const to = diagram.nodes[link.v].id;
    if (link.u === link.v) return selfLoop(boxes[link.u], from);
    const a = boxes[link.u];
    const b = boxes[link.v];
    let points: Point[];

    if (column[link.u] === column[link.v]) {
      const c = column[link.u];
      const [upper, lower] = a.y <= b.y ? [link.u, link.v] : [link.v, link.u];
      const between = columns[c].indexOf(lower) - columns[c].indexOf(upper) > 1;
      const up = boxes[upper];
      const low = boxes[lower];
      if (between) {
        const sideX = columnLeft[c] + columnWidth[c] + BACK_OFFSET;
        points = [rightMid(up), { x: sideX, y: up.y + up.height / 2 }, { x: sideX, y: low.y + low.height / 2 }, rightMid(low)];
      } else {
        points = [
          { x: up.x + up.width / 2, y: up.y + up.height },
          { x: low.x + low.width / 2, y: low.y },
        ];
      }
      if (upper !== link.u) points.reverse();
    } else {
      const [leftNode, rightNode] = column[link.u] < column[link.v] ? [link.u, link.v] : [link.v, link.u];
      const end = leftMid(boxes[rightNode]);
      points = [rightMid(boxes[leftNode])];
      for (let c = column[leftNode] + 1; c < column[rightNode]; c++) {
        const start = points[points.length - 1];
        const x0 = columnLeft[c];
        const x1 = columnLeft[c] + columnWidth[c];
        const yAt = (x: number) => start.y + ((end.y - start.y) * (x - start.x)) / (end.x - start.x);
        const low = Math.min(yAt(x0), yAt(x1));
        const high = Math.max(yAt(x0), yAt(x1));
        const blocked = columns[c].some((node) => boxes[node].y - CROSS_MARGIN < high && boxes[node].y + boxes[node].height + CROSS_MARGIN > low);
        if (blocked) {
          const slot = freeSlot(c, yAt((x0 + x1) / 2));
          points.push({ x: x0, y: slot }, { x: x1, y: slot });
        }
      }
      points.push(end);
      if (leftNode !== link.u) points.reverse();
    }

    const middle = middleOf(points);
    return {
      from,
      to,
      points,
      labelPosition: { x: middle.x, y: middle.y - LABEL_OFFSET },
      labelAnchor: "middle",
      back: false,
    };
  });

  return { boxes, links: laidOut, headers, center: null };
}

// --- Carte mentale (mindmap) --------------------------------------------------

/** Point du bord d'un nœud sur la demi-droite qui part de son centre vers `target`. */
function clipToBorder(box: Box, shape: DiagramNode["shape"], target: Point): Point {
  const c = centerOf(box);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  let t: number;
  if (shape === "decision") {
    t = 1 / (Math.abs(dx) / halfW + Math.abs(dy) / halfH);
  } else {
    t = Math.min(dx === 0 ? Infinity : halfW / Math.abs(dx), dy === 0 ? Infinity : halfH / Math.abs(dy));
    if (shape === "pill") {
      // Extrémités arrondies : intersection avec le demi-cercle quand le point tombe au-delà de la partie droite.
      const radius = halfH;
      const straight = halfW - radius;
      if (Math.abs(t * dx) > straight) {
        const length = Math.hypot(dx, dy);
        const ux = dx / length;
        const cx = Math.sign(dx) * straight;
        const projection = cx * ux;
        const s = projection + Math.sqrt(Math.max(0, projection * projection - cx * cx + radius * radius));
        t = s / length;
      }
    }
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function boxesOverlap(a: Box, b: Box, clearance: number): boolean {
  return (
    a.x < b.x + b.width + clearance &&
    b.x < a.x + a.width + clearance &&
    a.y < b.y + b.height + clearance &&
    b.y < a.y + a.height + clearance
  );
}

function layoutMindmap(diagram: Diagram, sizes: Size[], links: IndexedLink[]): RawLayout {
  const count = diagram.nodes.length;
  const hasIncoming = new Array<boolean>(count).fill(false);
  const adjacent: number[][] = Array.from({ length: count }, () => []);
  for (const link of links) {
    if (link.u === link.v) continue;
    hasIncoming[link.v] = true;
    adjacent[link.u].push(link.v);
    adjacent[link.v].push(link.u);
  }
  const rootIndex = hasIncoming.indexOf(false);
  const root = rootIndex === -1 ? 0 : rootIndex;

  // Arbre en largeur ; un nœud non relié devient une branche de la racine.
  const children: number[][] = Array.from({ length: count }, () => []);
  const depth = new Array<number>(count).fill(-1);
  const bfsOrder: number[] = [];
  const explore = (start: number) => {
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      bfsOrder.push(node);
      for (const next of adjacent[node]) {
        if (depth[next] !== -1) continue;
        depth[next] = depth[node] + 1;
        children[node].push(next);
        queue.push(next);
      }
    }
  };
  depth[root] = 0;
  explore(root);
  for (let node = 0; node < count; node++) {
    if (depth[node] !== -1) continue;
    depth[node] = 1;
    children[root].push(node);
    explore(node);
  }

  const subtree = new Array<number>(count).fill(1);
  for (const node of [...bfsOrder].reverse()) for (const child of children[node]) subtree[node] += subtree[child];

  // Secteurs angulaires proportionnels à la taille des sous-arbres ; la première branche pointe vers la droite.
  const angle = new Array<number>(count).fill(0);
  const assign = (node: number, from: number, to: number) => {
    const total = children[node].reduce((sum, child) => sum + subtree[child], 0);
    let start = from;
    for (const child of children[node]) {
      const span = ((to - from) * subtree[child]) / total;
      angle[child] = start + span / 2;
      assign(child, start, start + span);
      start += span;
    }
  };
  if (children[root].length > 0) {
    const firstSpan = (2 * Math.PI * subtree[children[root][0]]) / (subtree[root] - 1);
    assign(root, -firstSpan / 2, 2 * Math.PI - firstSpan / 2);
  }

  // Distance au centre : celle du parent, plus la demi-traversée des deux nœuds le long du rayon et un écart ;
  // un nœud qui en chevauche un autre s'éloigne ensuite avec son sous-arbre, pas à pas.
  const exit = (node: number, theta: number) =>
    Math.min(
      Math.abs(Math.cos(theta)) < 1e-9 ? Infinity : sizes[node].width / 2 / Math.abs(Math.cos(theta)),
      Math.abs(Math.sin(theta)) < 1e-9 ? Infinity : sizes[node].height / 2 / Math.abs(Math.sin(theta))
    );
  const distance = new Array<number>(count).fill(0);
  for (const node of bfsOrder) {
    for (const child of children[node]) {
      distance[child] = distance[node] + exit(node, angle[child]) + exit(child, angle[child]) + RING_GAP;
    }
  }
  const bfsRank = new Array<number>(count).fill(0);
  bfsOrder.forEach((node, index) => (bfsRank[node] = index));
  const pushOut = (node: number) => {
    distance[node] += RING_STEP;
    for (const child of children[node]) pushOut(child);
  };

  const place = (): Box[] =>
    diagram.nodes.map((_, node) => {
      const cx = distance[node] * Math.cos(angle[node]);
      const cy = distance[node] * Math.sin(angle[node]);
      return { x: cx - sizes[node].width / 2, y: cy - sizes[node].height / 2, width: sizes[node].width, height: sizes[node].height };
    });
  let boxes = place();
  for (let iteration = 0; ; iteration++) {
    let moved: number | null = null;
    for (let a = 0; a < count && moved === null; a++) {
      for (let b = a + 1; b < count; b++) {
        if (!boxesOverlap(boxes[a], boxes[b], MINDMAP_CLEARANCE)) continue;
        moved = depth[a] > depth[b] || (depth[a] === depth[b] && bfsRank[a] > bfsRank[b]) ? a : b;
        break;
      }
    }
    if (moved === null) break;
    if (iteration >= MAX_RING_ITERATIONS) {
      throw new Error(`La carte mentale « ${diagram.title} » n'a pas pu être placée sans chevauchement.`);
    }
    pushOut(moved);
    boxes = place();
  }

  const laidOut = links.map((link): LaidOutLink => {
    const from = diagram.nodes[link.u].id;
    const to = diagram.nodes[link.v].id;
    if (link.u === link.v) return selfLoop(boxes[link.u], from);
    const start = clipToBorder(boxes[link.u], diagram.nodes[link.u].shape, centerOf(boxes[link.v]));
    const end = clipToBorder(boxes[link.v], diagram.nodes[link.v].shape, centerOf(boxes[link.u]));
    return {
      from,
      to,
      points: [start, end],
      labelPosition: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - LABEL_OFFSET },
      labelAnchor: "middle",
      back: false,
    };
  });

  return { boxes, links: laidOut, headers: [], center: centerOf(boxes[root]) };
}

// --- Assemblage ----------------------------------------------------------------

/** Libellés des liens parallèles décalés pour ne pas se superposer. */
function separateParallelLabels(diagram: Diagram, links: LaidOutLink[]): void {
  const seen = new Map<string, number>();
  links.forEach((link, index) => {
    if (!diagram.links[index].label) return;
    const key = `${link.from}\u0000${link.to}`;
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    link.labelPosition = { x: link.labelPosition.x, y: link.labelPosition.y - rank * (LINK_LABEL_FONT.size + 4) };
  });
}

/** Translate le schéma pour que tout soit en coordonnées positives avec une marge, et calcule ses dimensions. */
function finish(diagram: Diagram, raw: RawLayout, measure: TextMeasure): DiagramLayout {
  separateParallelLabels(diagram, raw.links);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const box of raw.boxes) {
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
  }
  raw.links.forEach((link, index) => {
    for (const point of link.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
    const label = diagram.links[index].label;
    if (label) {
      const width = measure(label, LINK_LABEL_FONT);
      const half = LINK_LABEL_FONT.size * 0.7;
      const start = link.labelAnchor === "start" ? link.labelPosition.x : link.labelPosition.x - width / 2;
      xs.push(start, start + width);
      ys.push(link.labelPosition.y - half, link.labelPosition.y + half);
    }
  });
  for (const header of raw.headers) {
    xs.push(header.x, header.x + header.width);
    ys.push(header.y, header.y + HEADER_HEIGHT);
  }

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (raw.center) {
    const halfW = Math.max(raw.center.x - minX, maxX - raw.center.x);
    const halfH = Math.max(raw.center.y - minY, maxY - raw.center.y);
    minX = raw.center.x - halfW;
    maxX = raw.center.x + halfW;
    minY = raw.center.y - halfH;
    maxY = raw.center.y + halfH;
  }
  const dx = LAYOUT_PADDING - minX;
  const dy = LAYOUT_PADDING - minY;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });

  return {
    nodes: raw.boxes.map((box, index) => ({
      id: diagram.nodes[index].id,
      x: box.x + dx,
      y: box.y + dy,
      width: box.width,
      height: box.height,
    })),
    links: raw.links.map((link) => ({ ...link, points: link.points.map(move), labelPosition: move(link.labelPosition) })),
    headers: raw.headers.map((header) => ({ ...header, x: header.x + dx, y: header.y + dy })),
    width: Math.ceil(maxX - minX + 2 * LAYOUT_PADDING),
    height: Math.ceil(maxY - minY + 2 * LAYOUT_PADDING),
  };
}

/**
 * Calcule le placement d'un schéma. `measure` donne la largeur d'un texte ;
 * par défaut, l'estimation déterministe `estimateTextWidth`.
 */
export function layoutDiagram(diagram: Diagram, measure: TextMeasure = estimateTextWidth): DiagramLayout {
  const { links } = indexLinks(diagram);
  const sizes = diagram.nodes.map((node) => nodeSize(node, measure));
  switch (diagram.kind) {
    case "flow":
      return finish(diagram, layoutFlow(diagram, sizes, links, measure), measure);
    case "layers":
      return finish(diagram, layoutLayers(diagram, sizes, links, measure), measure);
    case "mindmap":
      return finish(diagram, layoutMindmap(diagram, sizes, links), measure);
  }
}
