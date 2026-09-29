/**
 * Placement des schémas : position et taille de chaque nœud, tracé de chaque
 * lien, pour les trois sortes de schéma (`flow`, `layers`, `mindmap`).
 * Fonctions pures et déterministes, sans dépendance, partagées par la GUI et
 * les tests. Un schéma incohérent lève une erreur explicite.
 */
import { routeIssues, issueCount, type Point } from "./diagram-geometry.js";
import { mindmapProblems, type MindmapProblem } from "./mindmap-tree.js";
import type { Diagram, DiagramNode } from "./schemas/analysis.schema.js";

export type { Point };

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
/** Écart horizontal minimal entre deux rangs d'un flux : longueur d'une flèche droite. */
const RANK_GAP = 40;
/** Écart vertical entre deux nœuds d'un même rang ou d'une même colonne. */
const NODE_GAP = 36;
/** Écart vertical autour d'un point de passage d'un lien long. */
const DUMMY_GAP = 18;
/** Écart minimal entre deux couloirs verticaux de liens dans un intervalle de rangs. */
const CHANNEL_SPACING = 12;
/** Écart vertical entre un nœud et la branche suspendue sous lui. */
const HANG_GAP = 36;
/** Distance horizontale minimale entre un nœud suspendu qui déborde de son rang et un nœud d'un autre rang. */
const HANG_CLEARANCE = 24;
/** Marge verticale autour d'un lien ou d'un nœud qu'un nœud suspendu ne doit pas recouvrir. */
const LINK_CLEARANCE = 16;
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
/** Passes maximales d'échange de deux voisins d'un rang ou d'une colonne. */
const TRANSPOSE_PASSES = 6;
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

interface RawLayout {
  boxes: Box[];
  links: LaidOutLink[];
  headers: LayerHeader[];
  /** Point qui doit rester au centre du schéma (racine d'une carte mentale). */
  center: Point | null;
}

// --- Choix de l'ordre des nœuds --------------------------------------------------

/** Note d'un tracé : problèmes (croisements, traversées de nœuds), puis étirement vertical des liens. */
interface OrderScore {
  issues: number;
  stretch: number;
}

function scoreLayout(raw: RawLayout, links: IndexedLink[]): OrderScore {
  const issues = issueCount(routeIssues(raw.boxes, raw.links.map((link, k) => ({ u: links[k].u, v: links[k].v, points: link.points }))));
  let stretch = 0;
  for (const link of raw.links) {
    for (let i = 1; i < link.points.length; i++) stretch += Math.abs(link.points[i].y - link.points[i - 1].y);
  }
  return { issues, stretch };
}

function better(a: OrderScore, b: OrderScore): boolean {
  return a.issues < b.issues || (a.issues === b.issues && a.stretch < b.stretch - 1e-6);
}

/**
 * Ordre des éléments de chaque rang ou colonne : le candidat dont le tracé
 * final a le moins de problèmes (à égalité, le moins étiré, puis le premier),
 * puis, tant qu'il reste des problèmes, échanges de deux voisins d'un même rang
 * conservés quand ils en retirent. `score` trace le schéma pour un ordre donné.
 */
function chooseOrder(candidates: number[][][], score: (order: number[][]) => OrderScore): number[][] {
  let best = candidates[0];
  let bestScore = score(best);
  for (const candidate of candidates.slice(1)) {
    const current = score(candidate);
    if (better(current, bestScore)) {
      best = candidate;
      bestScore = current;
    }
  }
  const order = best.map((layer) => [...layer]);
  for (let pass = 0; pass < TRANSPOSE_PASSES && bestScore.issues > 0; pass++) {
    let improved = false;
    for (const layer of order) {
      for (let i = 0; i + 1 < layer.length && bestScore.issues > 0; i++) {
        [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
        const current = score(order);
        if (current.issues < bestScore.issues) {
          bestScore = current;
          improved = true;
        } else {
          [layer[i], layer[i + 1]] = [layer[i + 1], layer[i]];
        }
      }
    }
    if (!improved) break;
  }
  return order;
}

// --- Flux (flow) ---------------------------------------------------------------

/**
 * Élément d'un rang : un nœud réel avec sa branche suspendue, ou un point de passage (`node` null)
 * d'un lien long. `above` est la distance entre le haut de l'élément et l'ordonnée de ses liens horizontaux.
 */
interface RankItem {
  node: number | null;
  rank: number;
  width: number;
  height: number;
  above: number;
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

  // Branches suspendues : une branche secondaire sans jonction, ou le nœud terminal d'une chaîne,
  // descend verticalement sous le nœud qui la précède au lieu d'occuper un rang de plus.
  const fwdSuccs: number[][] = Array.from({ length: count }, () => []);
  const fwdPreds: number[][] = Array.from({ length: count }, () => []);
  const looped = new Array<boolean>(count).fill(false);
  links.forEach((link, k) => {
    if (link.u === link.v || back[k]) {
      looped[link.u] = true;
      looped[link.v] = true;
      return;
    }
    if (!fwdSuccs[link.u].includes(link.v)) fwdSuccs[link.u].push(link.v);
    if (!fwdPreds[link.v].includes(link.u)) fwdPreds[link.v].push(link.u);
  });
  /** Chaîne linéaire issue de `start` (un prédécesseur, au plus un successeur, sans cycle), ou null. */
  const chainFrom = (start: number): number[] | null => {
    const chain: number[] = [];
    for (let node = start; ; node = fwdSuccs[node][0]) {
      if (fwdPreds[node].length !== 1 || looped[node] || fwdSuccs[node].length > 1) return null;
      chain.push(node);
      if (fwdSuccs[node].length === 0) return chain;
    }
  };
  const hanging: number[][] = Array.from({ length: count }, () => []);
  const hung = new Array<boolean>(count).fill(false);
  for (let node = 0; node < count; node++) {
    const succs = fwdSuccs[node];
    let chain: number[] | null = null;
    for (let i = 1; i < succs.length && chain === null; i++) chain = chainFrom(succs[i]);
    if (chain === null && succs.length === 1 && fwdPreds[node].length > 0 && fwdSuccs[succs[0]].length === 0) {
      chain = chainFrom(succs[0]);
    }
    if (chain === null) continue;
    hanging[node] = chain;
    for (const member of chain) hung[member] = true;
  }
  for (let node = 0; node < count; node++) if (hung[node]) hanging[node] = [];
  const spine = [...diagram.nodes.keys()].filter((node) => !hung[node]);

  // Rangs : plus long chemin depuis les sources, sur le graphe sans liens de retour ni branches suspendues.
  const forward = links.map((link, k) => ({ ...link, k })).filter((link) => link.u !== link.v && !back[link.k] && !hung[link.v]);
  const preds: number[][] = Array.from({ length: count }, () => []);
  const succs: number[][] = Array.from({ length: count }, () => []);
  for (const link of forward) {
    succs[link.u].push(link.v);
    preds[link.v].push(link.u);
  }
  const rank = new Array<number>(count).fill(0);
  const remaining = preds.map((list) => list.length);
  const ready = spine.filter((node) => remaining[node] === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => visitOrder[a] - visitOrder[b]);
    const node = ready.shift()!;
    for (const next of succs[node]) {
      rank[next] = Math.max(rank[next], rank[node] + 1);
      if (--remaining[next] === 0) ready.push(next);
    }
  }
  // Une source se place juste avant son premier successeur.
  for (const node of spine) {
    if (preds[node].length === 0 && succs[node].length > 0) {
      rank[node] = Math.min(...succs[node].map((next) => rank[next])) - 1;
    }
  }
  const rankCount = Math.max(...spine.map((node) => rank[node])) + 1;
  hanging.forEach((chain, node) => chain.forEach((member) => (rank[member] = rank[node])));

  // Éléments des rangs : un nœud porte sa branche suspendue ; ses liens horizontaux partent à `above` de son bord haut.
  const stackHeight = (node: number) => hanging[node].reduce((total, member) => total + HANG_GAP + sizes[member].height, sizes[node].height);
  const items: RankItem[] = diagram.nodes.map((_, node) => ({
    node,
    rank: rank[node],
    width: sizes[node].width,
    height: stackHeight(node),
    above: sizes[node].height / 2,
  }));
  const chains = new Map<number, number[]>();
  for (const link of forward) {
    const chain = [link.u];
    for (let r = rank[link.u] + 1; r < rank[link.v]; r++) {
      items.push({ node: null, rank: r, width: 0, height: 0, above: 0 });
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

  // Ordres candidats dans chaque rang : ordre de déclaration (ordre de visite), puis l'ordre obtenu
  // après chaque balayage barycentrique, alternativement vers l'aval et vers l'amont.
  let layers: number[][] = Array.from({ length: rankCount }, () => []);
  stableSortBy(spine, (node) => visitOrder[node]).forEach((node) => layers[rank[node]].push(node));
  for (let item = count; item < items.length; item++) layers[items[item].rank].push(item);
  const position = new Array<number>(items.length).fill(0);
  const refresh = () => layers.forEach((layer) => layer.forEach((item, index) => (position[item] = index)));
  refresh();
  const reorder = (r: number, neighbours: number[][]) => {
    layers[r] = stableSortBy(layers[r], (item) => {
      const list = neighbours[item];
      return list.length > 0 ? list.reduce((sum, other) => sum + position[other], 0) / list.length : position[item];
    });
    layers[r].forEach((item, index) => (position[item] = index));
  };
  const candidates = [layers.map((layer) => [...layer])];
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    if (sweep % 2 === 0) for (let r = 1; r < rankCount; r++) reorder(r, itemPreds);
    else for (let r = rankCount - 2; r >= 0; r--) reorder(r, itemSuccs);
    candidates.push(layers.map((layer) => [...layer]));
  }

  /** Trace le flux pour un ordre donné des éléments de chaque rang. */
  const build = (order: number[][]): RawLayout => {
    layers = order.map((layer) => [...layer]);
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

    // Placement vertical : passes alternées vers l'aval et vers l'amont. `port[item]` est l'ordonnée
    // de ses liens horizontaux ; `shift` passe du port au centre de l'élément empilé.
    const above = (item: number) => items[item].above;
    const below = (item: number) => items[item].height - items[item].above;
    const shift = (item: number) => items[item].height / 2 - items[item].above;
    const gapsOf = (layer: number[]) =>
      layer.slice(0, -1).map((item, index) => (items[item].node === null || items[layer[index + 1]].node === null ? DUMMY_GAP : NODE_GAP));
    const port = new Array<number>(items.length).fill(0);
    for (const layer of layers) {
      stackCenters(layer.map((item) => items[item].height), gapsOf(layer)).forEach((value, index) => (port[layer[index]] = value - shift(layer[index])));
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
          const values = neighbours.map((other) => ({ value: port[other], weight: hopWeight(item, other) }));
          const mean = weightedMean(values);
          desired.push((mean ?? port[item]) + shift(item));
          weights.push(mean === null ? FREE_WEIGHT : values.reduce((sum, entry) => sum + entry.weight, 0));
        }
        placeStack(layer.map((item) => items[item].height), gapsOf(layer), desired, weights).forEach(
          (value, index) => (port[layer[index]] = value - shift(layer[index]))
        );
      }
    }

    // Redressement : un élément aligné presque à hauteur de son voisin s'y cale exactement ; ses voisins de rang s'écartent d'autant.
    for (let r = 1; r < rankCount; r++) {
      const layer = layers[r];
      const gaps = gapsOf(layer);
      layer.forEach((item, index) => {
        const partner = itemPreds[item].find((other) => aligned.has(`${other}>${item}`));
        if (partner === undefined || Math.abs(port[partner] - port[item]) > SNAP_DISTANCE) return;
        port[item] = port[partner];
        for (let j = index + 1; j < layer.length; j++) {
          const minimum = port[layer[j - 1]] + below(layer[j - 1]) + gaps[j - 1] + above(layer[j]);
          if (port[layer[j]] < minimum) port[layer[j]] = minimum;
        }
        for (let j = index - 1; j >= 0; j--) {
          const maximum = port[layer[j + 1]] - above(layer[j + 1]) - gaps[j] - below(layer[j]);
          if (port[layer[j]] > maximum) port[layer[j]] = maximum;
        }
      });
    }

    // Ordonnées des boîtes : un nœud du flux principal centré sur son port, sa branche suspendue empilée dessous.
    const boxY = new Array<number>(count).fill(0);
    for (const node of spine) {
      boxY[node] = port[node] - sizes[node].height / 2;
      let bottom = boxY[node] + sizes[node].height;
      for (const member of hanging[node]) {
        boxY[member] = bottom + HANG_GAP;
        bottom = boxY[member] + sizes[member].height;
      }
    }

    // Couloirs verticaux des liens coudés, par intervalle entre deux rangs : un couloir par élément
    // de départ, qui descend ou monte vers chacune de ses cibles coudées.
    const isElbow = (a: number, b: number) => Math.abs(port[a] - port[b]) >= STRAIGHT_TOLERANCE;
    const channels: number[][] = Array.from({ length: rankCount }, () => []);
    const elbowTargets = new Map<number, number[]>();
    for (const chain of chains.values()) {
      for (let i = 1; i < chain.length; i++) {
        const [a, b] = [chain[i - 1], chain[i]];
        if (!isElbow(a, b)) continue;
        if (!channels[items[a].rank].includes(a)) channels[items[a].rank].push(a);
        const targets = elbowTargets.get(a) ?? [];
        if (!targets.includes(b)) targets.push(b);
        elbowTargets.set(a, targets);
      }
    }
    /**
     * Croisements dans l'intervalle quand le couloir de `left` est à gauche de celui de `right` :
     * les liens sortants de `left` qui coupent le couloir de `right` (hors cible commune), plus
     * le lien entrant de `right` quand il coupe le couloir de `left`.
     */
    const spanOf = (a: number) => {
      const ys = [port[a], ...elbowTargets.get(a)!.map((b) => port[b])];
      return [Math.min(...ys), Math.max(...ys)];
    };
    const inside = (y: number, [low, high]: number[]) => y > low + STRAIGHT_TOLERANCE && y < high - STRAIGHT_TOLERANCE;
    const channelCost = (left: number, right: number) => {
      const rightTargets = elbowTargets.get(right)!;
      const exits = elbowTargets.get(left)!.filter((b) => !rightTargets.includes(b) && inside(port[b], spanOf(right))).length;
      return exits + (inside(port[right], spanOf(left)) ? 1 : 0);
    };
    // Insertion un à un, par ordonnée de départ, à la place qui coûte le moins de croisements ;
    // à égalité, la place la plus à droite, ce qui garde l'ordre des ordonnées.
    channels.forEach((list, r) => {
      const ordered: number[] = [];
      for (const item of stableSortBy(list, (entry) => port[entry])) {
        let bestPosition = ordered.length;
        let bestCost = Infinity;
        for (let position = ordered.length; position >= 0; position--) {
          const cost = ordered.reduce((sum, other, k) => sum + (k < position ? channelCost(other, item) : channelCost(item, other)), 0);
          if (cost < bestCost) {
            bestCost = cost;
            bestPosition = position;
          }
        }
        ordered.splice(bestPosition, 0, item);
      }
      channels[r] = ordered;
    });
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

    // Tranches verticales occupées par des liens de part et d'autre de chaque rang :
    // `occupied[b]` pour la frontière `b`, entre les rangs `b - 1` et `b`.
    const occupied: Array<Array<[number, number]>> = Array.from({ length: rankCount + 1 }, () => []);
    for (const chain of chains.values()) {
      for (let i = 1; i < chain.length; i++) {
        const [a, b] = [chain[i - 1], chain[i]];
        occupied[items[a].rank + 1].push([Math.min(port[a], port[b]), Math.max(port[a], port[b])]);
      }
    }
    links.forEach((link, k) => {
      if (link.u === link.v) occupied[rank[link.u] + 1].push([boxY[link.u] - LOOP_SIZE, port[link.u]]);
      else if (back[k]) {
        occupied[rank[link.u] + 1].push([port[link.u], Infinity]);
        occupied[rank[link.v]].push([port[link.v], Infinity]);
      }
    });
    const crossesLinks = (boundary: number, top: number, bottom: number) =>
      occupied[boundary].some(([low, high]) => low - LINK_CLEARANCE < bottom && high + LINK_CLEARANCE > top);

    // Emprise horizontale de chaque nœud autour de l'axe de son rang. Un nœud suspendu inclut le
    // libellé du lien vertical qui l'atteint, à droite de ce lien, dans l'écart au-dessus de lui.
    interface Extent {
      rank: number;
      top: number;
      bottom: number;
      left: number;
      right: number;
      hung: boolean;
    }
    const extents: Extent[] = diagram.nodes.map((_, node) => {
      const half = sizes[node].width / 2;
      if (!hung[node]) return { rank: rank[node], top: boxY[node], bottom: boxY[node] + sizes[node].height, left: half, right: half, hung: false };
      const labels = links.filter((link) => link.v === node && link.label).map((link) => LABEL_OFFSET + measure(link.label!, LINK_LABEL_FONT) + LABEL_MARGIN);
      return {
        rank: rank[node],
        top: boxY[node] - HANG_GAP,
        bottom: boxY[node] + sizes[node].height,
        left: half,
        right: Math.max(half, ...labels),
        hung: true,
      };
    });

    // Demi-largeurs des rangs : celle des nœuds du flux principal, élargie là où un nœud suspendu
    // plus large croiserait un lien ; ailleurs, il déborde sur l'intervalle voisin.
    const halfLeft = layers.map((layer) => Math.max(0, ...layer.map((item) => items[item].width / 2)));
    const halfRight = [...halfLeft];
    for (const extent of extents) {
      if (!extent.hung) continue;
      if (crossesLinks(extent.rank, extent.top, extent.bottom)) halfLeft[extent.rank] = Math.max(halfLeft[extent.rank], extent.left);
      if (crossesLinks(extent.rank + 1, extent.top, extent.bottom)) halfRight[extent.rank] = Math.max(halfRight[extent.rank], extent.right);
    }

    // Axe de chaque rang : après l'intervalle qui le sépare du précédent, et assez loin de tout nœud
    // suspendu qui déborde à la même hauteur.
    const byRank: Extent[][] = Array.from({ length: rankCount }, () => []);
    extents.forEach((extent) => byRank[extent.rank].push(extent));
    const axis: number[] = [];
    for (let r = 0; r < rankCount; r++) {
      let x = r === 0 ? halfLeft[0] : axis[r - 1] + halfRight[r - 1] + gapWidth[r - 1] + halfLeft[r];
      for (const current of byRank[r]) {
        for (let earlier = 0; earlier < r; earlier++) {
          for (const other of byRank[earlier]) {
            if (!current.hung && !other.hung) continue;
            if (current.top >= other.bottom + LINK_CLEARANCE || other.top >= current.bottom + LINK_CLEARANCE) continue;
            x = Math.max(x, axis[earlier] + other.right + HANG_CLEARANCE + current.left);
          }
        }
      }
      axis.push(x);
    }
    const rankLeft = (r: number) => axis[r] - halfLeft[r];
    const rankRight = (r: number) => axis[r] + halfRight[r];

    const boxes: Box[] = diagram.nodes.map((_, node) => ({
      x: axis[rank[node]] - sizes[node].width / 2,
      y: boxY[node],
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
        const outX = rankRight(rank[link.u]) + BACK_OFFSET;
        const inX = rankLeft(rank[link.v]) - BACK_OFFSET;
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

      if (hung[link.v]) {
        const x = axis[rank[link.v]];
        const top = boxes[link.u].y + boxes[link.u].height;
        const end = boxes[link.v].y;
        return {
          from,
          to,
          points: [
            { x, y: top },
            { x, y: end },
          ],
          labelPosition: { x: x + LABEL_OFFSET, y: (top + end) / 2 },
          labelAnchor: "start",
          back: false,
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
        const entry = real ? leftMid(boxes[b]) : { x: rankLeft(items[b].rank), y: port[b] };
        if (isElbow(a, b)) {
          const r = items[a].rank;
          const channelX = rankRight(r) + gapWidth[r] * channelFraction(r, a);
          points.push({ x: channelX, y: exit.y }, { x: channelX, y: entry.y });
          labelPosition = { x: channelX + LABEL_OFFSET, y: (exit.y + entry.y) / 2 };
          labelAnchor = "start";
        } else {
          labelPosition = { x: (exit.x + entry.x) / 2, y: entry.y - LABEL_OFFSET };
          labelAnchor = "middle";
        }
        points.push(entry);
        if (!real) points.push({ x: rankRight(items[b].rank), y: port[b] });
      }
      return { from, to, points: simplify(points), labelPosition, labelAnchor, back: false };
    });

    return { boxes, links: laidOut, headers: [], center: null };
  };

  return build(chooseOrder(candidates, (order) => scoreLayout(build(order), links)));
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

  let columns: number[][] = diagram.layers.map((_, c) => [...diagram.nodes.keys()].filter((node) => column[node] === c));
  const gaps = (list: number[]) => list.slice(0, -1).map(() => NODE_GAP);
  const center = new Array<number>(diagram.nodes.length).fill(0);
  const restack = (c: number) =>
    stackCenters(columns[c].map((node) => height[node]), gaps(columns[c])).forEach((value, index) => (center[columns[c][index]] = value));
  columns.forEach((_, c) => restack(c));
  const desiredOf = (node: number) => {
    const values = neighbours[node].map(({ other, delta }) => ({ value: center[other] + delta, weight: 1 }));
    return { mean: weightedMean(values), weight: values.length };
  };

  // Ordres candidats dans chaque colonne : ordre de déclaration, puis l'ordre obtenu après chaque
  // balayage barycentrique, alternativement de gauche à droite et de droite à gauche.
  const candidates = [columns.map((list) => [...list])];
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep++) {
    const order = sweep % 2 === 0 ? [...columns.keys()] : [...columns.keys()].reverse();
    for (const c of order) {
      columns[c] = stableSortBy(columns[c], (node) => desiredOf(node).mean ?? center[node]);
      restack(c);
    }
    candidates.push(columns.map((list) => [...list]));
  }

  /** Trace le schéma pour un ordre donné des nœuds de chaque colonne. */
  const build = (orderOfColumns: number[][]): RawLayout => {
    columns = orderOfColumns.map((list) => [...list]);
    columns.forEach((_, c) => restack(c));

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
  };

  return build(chooseOrder(candidates, (order) => scoreLayout(build(order), links)));
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

/** Description française d'un problème d'arborescence. */
function mindmapProblemText(problem: MindmapProblem): string {
  const list = (ids: string[]) => ids.map((id) => `« ${id} »`).join(", ");
  switch (problem.kind) {
    case "self_loop":
      return `le nœud « ${problem.node} » est relié à lui-même`;
    case "no_root":
      return "aucun nœud n'est sans lien entrant, il n'y a pas de racine";
    case "several_roots":
      return `plusieurs nœuds sans lien entrant (${list(problem.roots)}) au lieu d'une seule racine`;
    case "several_parents":
      return `le nœud « ${problem.node} » a plusieurs parents (${list(problem.parents)})`;
    case "cycle":
      return `cycle ${problem.nodes.join(" → ")}`;
    case "unreachable":
      return `${list(problem.nodes)} inaccessible(s) depuis la racine « ${problem.root} »`;
  }
}

function layoutMindmap(diagram: Diagram, sizes: Size[], links: IndexedLink[]): RawLayout {
  const problems = mindmapProblems(diagram);
  if (problems.length > 0) {
    throw new Error(`La carte mentale « ${diagram.title} » n'est pas un arbre : ${problems.map(mindmapProblemText).join(" ; ")}.`);
  }
  const count = diagram.nodes.length;
  const hasIncoming = new Array<boolean>(count).fill(false);
  const outgoing: number[][] = Array.from({ length: count }, () => []);
  for (const link of links) {
    hasIncoming[link.v] = true;
    outgoing[link.u].push(link.v);
  }
  const root = hasIncoming.indexOf(false);

  // Arbre parcouru en largeur depuis la racine, enfants dans l'ordre des liens.
  const children = outgoing;
  const depth = new Array<number>(count).fill(0);
  const bfsOrder: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    bfsOrder.push(node);
    for (const next of children[node]) {
      depth[next] = depth[node] + 1;
      queue.push(next);
    }
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
