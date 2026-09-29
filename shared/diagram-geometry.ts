/**
 * Contrôle géométrique d'un tracé de schéma : liens qui se croisent et liens
 * qui traversent un nœud qu'ils ne relient pas. Fonctions pures, sans
 * dépendance, utilisées par la disposition (choix de l'ordre des nœuds) et par
 * `diagram-quality.ts`.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tracé d'un lien : ligne brisée entre les nœuds d'indices `u` et `v`. */
export interface Route {
  u: number;
  v: number;
  points: Point[];
}

/** Problèmes d'un tracé : paires d'indices de liens qui se croisent, liens qui traversent un nœud. */
export interface RouteIssues {
  crossings: Array<[number, number]>;
  overlaps: Array<{ link: number; node: number }>;
}

/** Tolérance des tests d'orientation et de colinéarité. */
const EPSILON = 1e-6;
/** Retrait des bords d'un nœud : un lien qui longe ou effleure un bord ne le traverse pas. */
const NODE_INSET = 1;

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return value > EPSILON ? 1 : value < -EPSILON ? -1 : 0;
}

/** Vrai quand `p`, colinéaire à [a, b], est compris entre a et b. */
function within(a: Point, b: Point, p: Point): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - EPSILON &&
    p.x <= Math.max(a.x, b.x) + EPSILON &&
    p.y >= Math.min(a.y, b.y) - EPSILON &&
    p.y <= Math.max(a.y, b.y) + EPSILON
  );
}

/** Croisement franc : les segments se coupent en un point intérieur à chacun, de part et d'autre. */
export function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  return (
    orientation(p1, p2, q1) * orientation(p1, p2, q2) < 0 && orientation(q1, q2, p1) * orientation(q1, q2, p2) < 0
  );
}

/** Contact quelconque : croisement franc, extrémité posée sur l'autre segment ou recouvrement colinéaire. */
export function segmentsTouch(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (o1 === 0 && within(p1, p2, q1)) ||
    (o2 === 0 && within(p1, p2, q2)) ||
    (o3 === 0 && within(q1, q2, p1)) ||
    (o4 === 0 && within(q1, q2, p2))
  );
}

/** Vrai quand le segment [p, q] passe par l'intérieur du rectangle (découpage de Liang-Barsky). */
export function segmentEntersRect(p: Point, q: Point, rect: Rect, inset = NODE_INSET): boolean {
  const x0 = rect.x + inset;
  const x1 = rect.x + rect.width - inset;
  const y0 = rect.y + inset;
  const y1 = rect.y + rect.height - inset;
  if (x0 >= x1 || y0 >= y1) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [step, room] of [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ]) {
    if (step === 0) {
      if (room <= 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > EPSILON;
}

function segments(points: Point[]): Array<[Point, Point]> {
  const list: Array<[Point, Point]> = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (Math.abs(a.x - b.x) > EPSILON || Math.abs(a.y - b.y) > EPSILON) list.push([a, b]);
  }
  return list;
}

/**
 * Relevé des problèmes d'un tracé. Deux liens qui ne partagent aucun nœud
 * posent problème dès qu'ils se touchent. Deux liens qui partagent un nœud
 * (départ ou arrivée commune, liens parallèles) peuvent se rejoindre ou
 * partager un tronçon à ce nœud : seul un croisement franc compte.
 */
export function routeIssues(boxes: Rect[], routes: Route[]): RouteIssues {
  const pieces = routes.map((route) => segments(route.points));
  const crossings: RouteIssues["crossings"] = [];
  for (let a = 0; a < routes.length; a++) {
    for (let b = a + 1; b < routes.length; b++) {
      const ra = routes[a];
      const rb = routes[b];
      const shared = ra.u === rb.u || ra.u === rb.v || ra.v === rb.u || ra.v === rb.v;
      const test = shared ? segmentsCross : segmentsTouch;
      if (pieces[a].some(([p1, p2]) => pieces[b].some(([q1, q2]) => test(p1, p2, q1, q2)))) crossings.push([a, b]);
    }
  }
  const overlaps: RouteIssues["overlaps"] = [];
  routes.forEach((route, link) => {
    boxes.forEach((box, node) => {
      if (node === route.u || node === route.v) return;
      if (pieces[link].some(([p, q]) => segmentEntersRect(p, q, box))) overlaps.push({ link, node });
    });
  });
  return { crossings, overlaps };
}

/** Nombre total de problèmes d'un tracé : croisements et traversées de nœuds. */
export function issueCount(issues: RouteIssues): number {
  return issues.crossings.length + issues.overlaps.length;
}
