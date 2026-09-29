/**
 * Lisibilité d'un schéma placé : paires de liens qui se croisent et liens qui
 * traversent un nœud qu'ils ne relient pas, mesurées sur le tracé de
 * `layoutDiagram`. Partagé par les outils (`set_diagram`, `get_analysis`) et la GUI.
 */
import { routeIssues } from "./diagram-geometry.js";
import { layoutDiagram, type DiagramLayout } from "./diagram-layout.js";
import type { Diagram } from "./schemas/analysis.schema.js";

/** Lien désigné par ses extrémités et sa position dans `diagram.links`. */
export interface LinkRef {
  index: number;
  from: string;
  to: string;
}

export interface LinkCrossing {
  a: LinkRef;
  b: LinkRef;
}

export interface NodeOverlap {
  link: LinkRef;
  /** Identifiant du nœud traversé. */
  node: string;
}

export interface DiagramQuality {
  crossings: LinkCrossing[];
  nodeOverlaps: NodeOverlap[];
}

/**
 * Croisements et traversées de nœuds du tracé de `diagram`. Deux liens qui
 * partent du même nœud ou y arrivent ne se croisent pas en s'y rejoignant ;
 * seul un croisement franc entre eux compte. `layout` évite de recalculer un
 * placement déjà connu ; il doit provenir de `layoutDiagram(diagram)`.
 */
export function diagramQuality(diagram: Diagram, layout: DiagramLayout = layoutDiagram(diagram)): DiagramQuality {
  const index = new Map(diagram.nodes.map((node, position) => [node.id, position]));
  const refs: LinkRef[] = diagram.links.map((link, position) => ({ index: position, from: link.from, to: link.to }));
  const issues = routeIssues(
    layout.nodes,
    layout.links.map((link) => ({ u: index.get(link.from)!, v: index.get(link.to)!, points: link.points }))
  );
  return {
    crossings: issues.crossings.map(([a, b]) => ({ a: refs[a], b: refs[b] })),
    nodeOverlaps: issues.overlaps.map(({ link, node }) => ({ link: refs[link], node: diagram.nodes[node].id })),
  };
}

/** Vrai quand le schéma ne présente ni croisement ni traversée de nœud. */
export function isClean(quality: DiagramQuality): boolean {
  return quality.crossings.length === 0 && quality.nodeOverlaps.length === 0;
}
