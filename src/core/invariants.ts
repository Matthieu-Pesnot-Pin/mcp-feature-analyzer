import type { Analysis, FileEntry } from "../../shared/schemas/analysis.schema.js";
import { AnalysisError } from "./errors.js";

/** Identifiants présents plusieurs fois dans `ids`. */
function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/**
 * Liste les violations des règles de cohérence d'une analyse :
 * - refs cohérentes avec le mode : `branch` a une ref et un commit de tête ; `working_tree`
 *   compare à HEAD, sans ref ni commit de tête ;
 * - identifiants uniques (fichiers, constats, explications, remarques, schémas, nœuds d'un schéma) ;
 * - un constat `issue` a un emplacement, un `requirement_gap` peut ne pas en avoir ;
 * - un emplacement de constat porte un `anchorText` ; sans emplacement, ni `anchorText` ni `suggestion` ;
 * - un constat `open` vise un fichier de l'analyse dont le contenu est disponible, avec
 *   1 ≤ startLine ≤ endLine ≤ nombre de lignes ; un constat `ignored` ou `outdated` garde
 *   l'emplacement qu'il avait, même si le snapshot a changé depuis ;
 * - une explication `current` vise un fichier de l'analyse ; côté `new`, son contenu est
 *   disponible et endLine ≤ nombre de lignes ;
 * - les liens d'un schéma relient des nœuds existants ; en `layers`, chaque nœud a une couche
 *   déclarée dans `layers`, sans doublon ;
 * - la revue ne sélectionne que des constats et remarques existants, et son état est cohérent.
 */
export function findInvariantViolations(analysis: Analysis): string[] {
  const problems: string[] = [];
  const files = new Map<string, FileEntry>(analysis.files.map((file) => [file.path, file]));

  if (analysis.mode === "branch" && (analysis.head === null || analysis.headCommit === null)) {
    problems.push("a branch analysis needs a head ref and a head commit");
  }
  if (analysis.mode === "working_tree" && (analysis.base !== "HEAD" || analysis.head !== null || analysis.headCommit !== null)) {
    problems.push('a working_tree analysis has base "HEAD" and no head ref nor head commit');
  }

  for (const [label, ids] of [
    ["file path", analysis.files.map((file) => file.path)],
    ["finding id", analysis.findings.map((finding) => finding.id)],
    ["explanation id", analysis.explanations.map((explanation) => explanation.id)],
    ["note id", analysis.notes.map((note) => note.id)],
    ["diagram id", analysis.diagrams.map((diagram) => diagram.id)],
  ] as const) {
    for (const id of duplicates(ids)) problems.push(`duplicate ${label} "${id}"`);
  }

  for (const finding of analysis.findings) {
    const where = `finding "${finding.id}"`;
    const location = finding.location;
    if (location === null) {
      if (finding.kind === "issue") {
        problems.push(`${where} is an issue and needs a location (only requirement_gap findings may have none)`);
      }
      if (finding.anchorText !== null) problems.push(`${where} has anchorText but no location`);
      if (finding.suggestion !== null) problems.push(`${where} has a suggestion but no location to replace`);
      continue;
    }
    if (finding.anchorText === null) problems.push(`${where} has a location but no anchorText`);
    if (location.startLine > location.endLine) {
      problems.push(`${where} has startLine ${location.startLine} after endLine ${location.endLine}`);
    }
    if (finding.status !== "open") continue;
    const file = files.get(location.path);
    if (!file) {
      problems.push(`${where} targets "${location.path}", which is not a changed file of this analysis`);
      continue;
    }
    if (!file.contentAvailable) {
      problems.push(`${where} targets lines of "${location.path}", whose content is not available`);
    } else if (location.endLine > file.lineCount) {
      problems.push(
        `${where} targets lines ${location.startLine}-${location.endLine} of "${location.path}", ` +
          `which has ${file.lineCount} line(s)`
      );
    }
  }

  for (const explanation of analysis.explanations) {
    const where = `explanation "${explanation.id}"`;
    const location = explanation.location;
    if (location.startLine > location.endLine) {
      problems.push(`${where} has startLine ${location.startLine} after endLine ${location.endLine}`);
    }
    if (explanation.status !== "current") continue;
    const file = files.get(location.path);
    if (!file) {
      problems.push(`${where} describes "${location.path}", which is not a changed file of this analysis`);
      continue;
    }
    if (location.side !== "new") continue;
    if (!file.contentAvailable) {
      problems.push(`${where} describes new-side lines of "${location.path}", whose content is not available`);
    } else if (location.endLine > file.lineCount) {
      problems.push(
        `${where} describes lines ${location.startLine}-${location.endLine} of "${location.path}", ` +
          `which has ${file.lineCount} line(s)`
      );
    }
  }

  for (const diagram of analysis.diagrams) {
    const where = `diagram "${diagram.id}"`;
    const nodeIds = new Set(diagram.nodes.map((node) => node.id));
    for (const id of duplicates(diagram.nodes.map((node) => node.id))) problems.push(`${where} has duplicate node id "${id}"`);
    for (const link of diagram.links) {
      for (const end of [link.from, link.to]) {
        if (!nodeIds.has(end)) problems.push(`${where} has a link ${link.from} -> ${link.to} to unknown node "${end}"`);
      }
    }
    if (diagram.kind === "layers") {
      for (const layer of duplicates(diagram.layers)) problems.push(`${where} declares layer "${layer}" twice`);
      const layers = new Set(diagram.layers);
      for (const node of diagram.nodes) {
        if (node.layer === null) problems.push(`${where} node "${node.id}" needs a layer (kind is layers)`);
        else if (!layers.has(node.layer)) {
          problems.push(`${where} node "${node.id}" uses layer "${node.layer}", which is not in layers [${diagram.layers.join(", ")}]`);
        }
      }
    }
  }

  const findingIds = new Set(analysis.findings.map((finding) => finding.id));
  const noteIds = new Set(analysis.notes.map((note) => note.id));
  const review = analysis.review;
  for (const id of review.selectedFindingIds) {
    if (!findingIds.has(id)) problems.push(`review selects unknown finding "${id}"`);
  }
  for (const id of review.selectedNoteIds) {
    if (!noteIds.has(id)) problems.push(`review selects unknown note "${id}"`);
  }
  if (review.state === "submitted" && (review.decision === null || review.submittedAt === null)) {
    problems.push("a submitted review needs a decision and a submittedAt date");
  }
  if (review.state === "pending" && review.submittedAt !== null) {
    problems.push("a pending review cannot have a submittedAt date");
  }

  return problems;
}

/** Lève une AnalysisError listant toutes les violations, s'il y en a. */
export function assertInvariants(analysis: Analysis): void {
  const problems = findInvariantViolations(analysis);
  if (problems.length > 0) {
    throw new AnalysisError(`Analysis "${analysis.id}" would become inconsistent: ${problems.join("; ")}.`);
  }
}

/** Champ d'un fichier modifiable hors recalcul du snapshot. */
const MUTABLE_FILE_FIELDS = new Set<keyof FileEntry>(["reviewed"]);

/**
 * Vérifie qu'une modification ne touche pas aux champs fixés par le snapshot
 * (identité, dépôt, refs, commits, liste et métadonnées des fichiers hors
 * `reviewed`). Seul le recalcul du snapshot les change.
 */
export function assertSnapshotFieldsUnchanged(before: Analysis, after: Analysis): void {
  const changed: string[] = [];
  for (const field of ["id", "repoPath", "mode", "base", "head", "baseCommit", "headCommit", "snapshotAt", "createdAt"] as const) {
    if (before[field] !== after[field]) changed.push(field);
  }
  if (before.files.length !== after.files.length) {
    changed.push("files");
  } else {
    before.files.forEach((file, index) => {
      const next = after.files[index];
      for (const key of Object.keys(file) as Array<keyof FileEntry>) {
        if (!MUTABLE_FILE_FIELDS.has(key) && file[key] !== next[key]) changed.push(`files[${index}].${key}`);
      }
    });
  }
  if (changed.length > 0) {
    throw new AnalysisError(
      `Cannot change ${changed.join(", ")} of analysis "${before.id}": these fields come from the diff snapshot. ` +
        `Use refresh_analysis to recompute the snapshot.`
    );
  }
}
