/**
 * Règle des cartes mentales : les liens forment un arbre. Une seule racine
 * (nœud sans lien entrant), un seul parent pour chaque autre nœud, aucun
 * cycle, tous les nœuds atteignables depuis la racine.
 */
import type { Diagram } from "./schemas/analysis.schema.js";

export type MindmapProblem =
  | { kind: "self_loop"; node: string }
  | { kind: "no_root" }
  | { kind: "several_roots"; roots: string[] }
  | { kind: "several_parents"; node: string; parents: string[] }
  | { kind: "cycle"; nodes: string[] }
  | { kind: "unreachable"; root: string; nodes: string[] };

/** Problèmes qui empêchent `diagram` d'être une carte mentale ; liste vide pour un arbre. */
export function mindmapProblems(diagram: Pick<Diagram, "nodes" | "links">): MindmapProblem[] {
  const ids = diagram.nodes.map((node) => node.id);
  const known = new Set(ids);
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]));
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const problems: MindmapProblem[] = [];

  for (const link of diagram.links) {
    if (!known.has(link.from) || !known.has(link.to)) continue;
    if (link.from === link.to) {
      problems.push({ kind: "self_loop", node: link.from });
      continue;
    }
    parents.get(link.to)!.push(link.from);
    children.get(link.from)!.push(link.to);
  }

  const roots = ids.filter((id) => parents.get(id)!.length === 0);
  if (roots.length === 0 && ids.length > 0) problems.push({ kind: "no_root" });
  if (roots.length > 1) problems.push({ kind: "several_roots", roots });
  for (const id of ids) {
    const list = parents.get(id)!;
    if (list.length > 1) problems.push({ kind: "several_parents", node: id, parents: list });
  }

  // Cycles : parcours en profondeur, un cycle relevé par lien de retour.
  const state = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]));
  const path: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    path.push(id);
    for (const next of children.get(id)!) {
      if (state.get(next) === 1) problems.push({ kind: "cycle", nodes: [...path.slice(path.indexOf(next)), next] });
      else if (state.get(next) === 0) visit(next);
    }
    path.pop();
    state.set(id, 2);
  };
  for (const id of [...roots, ...ids]) if (state.get(id) === 0) visit(id);

  if (roots.length === 1) {
    const reached = new Set<string>([roots[0]]);
    const queue = [roots[0]];
    while (queue.length > 0) {
      for (const next of children.get(queue.shift()!)!) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    const unreachable = ids.filter((id) => !reached.has(id));
    if (unreachable.length > 0) problems.push({ kind: "unreachable", root: roots[0], nodes: unreachable });
  }
  return problems;
}
