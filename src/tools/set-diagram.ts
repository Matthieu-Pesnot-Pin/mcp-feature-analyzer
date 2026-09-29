import type { AnalysisStore } from "../core/analysis-store.js";
import { AnalysisError } from "../core/errors.js";
import { itemId } from "../core/ids.js";
import {
  DIAGRAM_KINDS,
  NODE_SHAPES,
  NODE_STATUSES,
  type Diagram,
  type DiagramLink,
  type DiagramNode,
  type DiagramNodeLocation,
  type FileEntry,
  type NodeShape,
  type NodeStatus,
} from "../../shared/schemas/analysis.schema.js";
import { layoutDiagram } from "../../shared/diagram-layout.js";
import { diagramQuality, type DiagramQuality, type LinkRef } from "../../shared/diagram-quality.js";
import { mindmapProblems, type MindmapProblem } from "../../shared/mindmap-tree.js";
import { readItemId } from "./inputs.js";
import {
  has,
  nullableString,
  optionalEnum,
  optionalPositiveInt,
  optionalString,
  rejectUnknownFields,
  requireArray,
  requireEnum,
  requireObject,
  requireString,
  requireStringArray,
  textResult,
  type Args,
  type MutationResult,
} from "./types.js";

export const NODE_INPUT_FIELDS = ["id", "label", "shape", "status", "layer", "detail", "path", "line"] as const;
export const LINK_INPUT_FIELDS = ["from", "to", "label"] as const;

/** Forme d'un nœud quand l'agent n'en donne pas. */
export const DEFAULT_NODE_SHAPE: NodeShape = "box";
/** Statut d'un nœud quand l'agent n'en donne pas. */
export const DEFAULT_NODE_STATUS: NodeStatus = "existing";

/**
 * Vérifie l'emplacement d'un nœud : un fichier modifié de l'analyse et, quand
 * `line` est fournie, une ligne du côté « nouveau » de ce fichier.
 */
function assertNodeLocation(files: FileEntry[], location: DiagramNodeLocation): void {
  const file = files.find((entry) => entry.path === location.path);
  if (!file) {
    throw new Error(
      `"${location.path}" is not a changed file of this analysis, so the GUI cannot open it. ` +
        `Omit path for code outside the diff and name the file in detail instead.`
    );
  }
  if (location.line === null) return;
  if (!file.contentAvailable) {
    throw new Error(`"${location.path}" has no new-side content (deleted, binary or too large): omit line and keep path only.`);
  }
  if (location.line > file.lineCount) {
    throw new Error(
      `line ${location.line} is out of range for "${location.path}", which has ${file.lineCount} line(s) on the new side (see get_diff).`
    );
  }
}

/** Nombre de nœuds au-delà duquel un schéma devient difficile à lire. */
const MAX_READABLE_NODES = 12;

/** Description anglaise d'un problème d'arborescence d'une carte mentale. */
function mindmapProblemText(problem: MindmapProblem): string {
  const list = (ids: string[]) => ids.map((id) => `"${id}"`).join(", ");
  switch (problem.kind) {
    case "self_loop":
      return `node "${problem.node}" links to itself.`;
    case "no_root":
      return "every node has an incoming link, so there is no root: the central subject must have none.";
    case "several_roots":
      return `${problem.roots.length} nodes have no incoming link (${list(problem.roots)}); keep one root and link the others below it.`;
    case "several_parents":
      return `node "${problem.node}" has ${problem.parents.length} parents (${list(problem.parents)}); keep a single link into it.`;
    case "cycle":
      return `the links form a cycle ${problem.nodes.join(" -> ")}.`;
    case "unreachable":
      return `node(s) ${list(problem.nodes)} cannot be reached from the root "${problem.root}".`;
  }
}

function linkLabel(ref: LinkRef): string {
  return `links[${ref.index}] ${ref.from} -> ${ref.to}`;
}

/** Compte rendu du contrôle de tracé et conseils pour supprimer les croisements. */
function qualityLines(quality: DiagramQuality, kind: Diagram["kind"], nodeCount: number): string[] {
  const lines: string[] = [];
  if (quality.crossings.length === 0 && quality.nodeOverlaps.length === 0) {
    lines.push("Layout check: No crossing.");
  } else {
    lines.push(
      `Layout check: ${quality.crossings.length} link crossing(s), ${quality.nodeOverlaps.length} link(s) through a node. ` +
        `The diagram is saved, but the reviewer expects none; fix it and send it again:`,
      ...quality.crossings.map((crossing) => `- ${linkLabel(crossing.a)} crosses ${linkLabel(crossing.b)}`),
      ...quality.nodeOverlaps.map((overlap) => `- ${linkLabel(overlap.link)} passes through node "${overlap.node}"`),
      "How to fix:",
      "- Reorder the nodes: the declaration order is the initial order of each rank or column, so declare them in reading order, " +
        "with the nodes that link to each other next to each other.",
      "- Split the diagram: one subject per diagram, 5 to 12 nodes each."
    );
    if (kind === "flow") {
      lines.push("- Drop shortcut links that skip steps and loops back to earlier steps, or show dependencies as a layers diagram instead.");
    } else if (kind === "layers") {
      lines.push(
        "- Order the layers so links run between neighbouring columns, move a node to the layer it belongs to, " +
          "and avoid links between nodes of the same column that are not adjacent."
      );
    }
  }
  if (nodeCount > MAX_READABLE_NODES) {
    lines.push(`Note: ${nodeCount} nodes; keep a diagram between 5 and ${MAX_READABLE_NODES} nodes and split a bigger picture into several diagrams.`);
  }
  return lines;
}

/**
 * Crée ou remplace entièrement un schéma. Nœuds, couches et liens sont validés
 * ensemble, une carte mentale doit former un arbre ; toutes les erreurs sont
 * renvoyées d'un coup et rien n'est écrit. Le résultat rend compte des
 * croisements du tracé, sans refuser l'écriture.
 */
export function setDiagram(store: AnalysisStore, args: Args): MutationResult {
  rejectUnknownFields(args, ["analysis_id", "diagram_id", "title", "kind", "layers", "nodes", "links"]);
  const id = requireString(args, "analysis_id");
  const requestedId = readItemId(args, "diagram_id");
  const title = requireString(args, "title");
  const kind = requireEnum(args, "kind", DIAGRAM_KINDS);
  const nodeItems = requireArray(args, "nodes", 1);
  const linkItems = has(args, "links") ? requireArray(args, "links") : [];

  let layers: string[] = [];
  if (kind === "layers") {
    if (!has(args, "layers")) {
      throw new Error(`"layers" is required when kind is layers: list the column names from left to right.`);
    }
    layers = requireStringArray(args, "layers", 1);
    const repeated = layers.filter((layer, index) => layers.indexOf(layer) !== index);
    if (repeated.length > 0) throw new Error(`"layers" lists ${[...new Set(repeated)].join(", ")} more than once.`);
  } else if (has(args, "layers")) {
    throw new Error(`"layers" is only used when kind is layers (kind is ${kind}): remove it.`);
  }

  const analysis = store.get(id);
  const errors: string[] = [];
  const nodes: DiagramNode[] = [];
  const nodeIds = new Set<string>();

  nodeItems.forEach((raw, index) => {
    const where = `nodes[${index}]`;
    try {
      const item = requireObject(raw, where);
      rejectUnknownFields(item, NODE_INPUT_FIELDS, `${where}.`);
      const nodeId = readItemId(item, "id", `${where}.`);
      if (nodeId === undefined) throw new Error(`"${where}.id" is required: links refer to nodes by id.`);
      if (nodeIds.has(nodeId)) throw new Error(`node id "${nodeId}" appears twice.`);
      nodeIds.add(nodeId);

      const label = requireString(item, "label", `${where}.`);
      const shape = optionalEnum(item, "shape", NODE_SHAPES, `${where}.`) ?? DEFAULT_NODE_SHAPE;
      const status = optionalEnum(item, "status", NODE_STATUSES, `${where}.`) ?? DEFAULT_NODE_STATUS;
      const detail = nullableString(item, "detail", `${where}.`) ?? null;
      const layer = optionalString(item, "layer", `${where}.`) ?? null;
      if (kind === "layers") {
        if (layer === null) throw new Error(`"${where}.layer" is required when kind is layers: use one of ${layers.join(", ")}.`);
        if (!layers.includes(layer)) {
          throw new Error(`"${where}.layer" is "${layer}", which is not declared in layers (${layers.join(", ")}).`);
        }
      } else if (layer !== null) {
        throw new Error(`"${where}.layer" is only used when kind is layers (kind is ${kind}): remove it.`);
      }

      const path = optionalString(item, "path", `${where}.`);
      const line = optionalPositiveInt(item, "line", `${where}.`);
      if (path === undefined && line !== undefined) {
        throw new Error(`"${where}.line" needs "${where}.path": give the file it refers to.`);
      }
      const location = path === undefined ? null : { path, line: line ?? null };
      if (location) assertNodeLocation(analysis.files, location);

      nodes.push({ id: nodeId, label, shape, status, layer, detail, location });
    } catch (err) {
      errors.push(`- ${where}: ${(err as Error).message}`);
    }
  });

  const links: DiagramLink[] = [];
  linkItems.forEach((raw, index) => {
    const where = `links[${index}]`;
    try {
      const item = requireObject(raw, where);
      rejectUnknownFields(item, LINK_INPUT_FIELDS, `${where}.`);
      const from = requireString(item, "from", `${where}.`);
      const to = requireString(item, "to", `${where}.`);
      const label = nullableString(item, "label", `${where}.`) ?? null;
      const unknown = [from, to].filter((end) => !nodeIds.has(end));
      if (unknown.length > 0) {
        throw new Error(`links ${from} -> ${to}, but node(s) ${[...new Set(unknown)].join(", ")} are not in "nodes".`);
      }
      links.push({ from, to, label });
    } catch (err) {
      errors.push(`- ${where}: ${(err as Error).message}`);
    }
  });

  const treeProblems = kind === "mindmap" ? mindmapProblems({ nodes, links }) : [];
  for (const problem of treeProblems) errors.push(`- mindmap: ${mindmapProblemText(problem)}`);

  if (errors.length > 0) {
    const tree =
      treeProblems.length > 0
        ? "\nA mindmap is a tree: one root (the central subject), exactly one incoming link for every other node, no cycle. " +
          "Use a flow or layers diagram for a graph."
        : "";
    throw new AnalysisError(
      `The diagram was not saved: ${errors.length} problem(s). Fix them and send the whole diagram again.\n${errors.join("\n")}${tree}`
    );
  }

  const draft: Diagram = { id: requestedId ?? "draft", title, kind, layers, nodes, links, updatedAt: new Date().toISOString() };
  let quality: DiagramQuality;
  try {
    quality = diagramQuality(draft, layoutDiagram(draft));
  } catch (err) {
    throw new AnalysisError(`The diagram was not saved: it cannot be laid out (${(err as Error).message}).`);
  }

  let replaced = false;
  let diagramId = "";
  const updated = store.mutate(id, "agent", (draft) => {
    diagramId = requestedId ?? itemId("diagram", new Set(draft.diagrams.map((diagram) => diagram.id)));
    const diagram: Diagram = { id: diagramId, title, kind, layers, nodes, links, updatedAt: new Date().toISOString() };
    const index = draft.diagrams.findIndex((entry) => entry.id === diagramId);
    replaced = index !== -1;
    if (replaced) draft.diagrams[index] = diagram;
    else draft.diagrams.push(diagram);
  });

  const lines = [
    `${replaced ? "Replaced" : "Created"} diagram ${diagramId} "${title}" (${kind}, ${nodes.length} node(s), ${links.length} link(s)) ` +
      `in "${updated.title}" (${updated.id}).`,
    ...qualityLines(quality, kind, nodes.length),
    `To change it, call set_diagram again with diagram_id "${diagramId}" and the complete diagram.`,
  ];
  return { result: textResult(lines.join("\n")), analysisId: updated.id };
}
