import type {
  AnalysisMode,
  FileStatus,
  FindingKind,
  FindingStatus,
  NodeStatus,
  ReviewDecision,
  Severity,
} from "./schemas/analysis.schema.js";

/** Libellé et couleurs d'une pastille : texte `color` sur fond `background`. */
export interface BadgeStyle {
  label: string;
  color: string;
  background: string;
}

export const SEVERITY_STYLES: Record<Severity, BadgeStyle> = {
  critical: { label: "Critique", color: "#f0625a", background: "#34191c" },
  major: { label: "Majeur", color: "#e3a33b", background: "#33270f" },
  minor: { label: "Mineur", color: "#6fb3ff", background: "#13243a" },
  trivial: { label: "Détail", color: "#9aa1b1", background: "#1c2029" },
};

/** Pastille des remarques du relecteur. */
export const NOTE_STYLE: BadgeStyle = { label: "Remarque", color: "#c4a8ff", background: "#241d3a" };

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  open: "Ouvert",
  ignored: "Ignoré",
  outdated: "Obsolète",
};

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  issue: "Problème",
  requirement_gap: "Exigence manquante",
};

export const FILE_STATUS_LABELS: Record<FileStatus, string> = {
  added: "Ajouté",
  modified: "Modifié",
  deleted: "Supprimé",
  renamed: "Renommé",
};

export const MODE_LABELS: Record<AnalysisMode, string> = {
  branch: "Branche",
  working_tree: "Copie de travail",
};

export const DECISION_LABELS: Record<ReviewDecision, string> = {
  approve: "Approuver",
  request_changes: "Demander des corrections",
  reject: "Rejeter",
};

/**
 * Apparence d'un nœud de schéma. `fill` null : contour seul.
 */
export interface NodeStyle {
  label: string;
  fill: string | null;
  stroke: string;
}

export const NODE_STATUS_STYLES: Record<NodeStatus, NodeStyle> = {
  new: { label: "Nouveau", fill: "#11201a", stroke: "#2c6b3a" },
  modified: { label: "Modifié", fill: "#151a2b", stroke: "#36407a" },
  impacted: { label: "Impacté", fill: "#13161f", stroke: "#2a2f3d" },
  existing: { label: "Existant", fill: "#13161f", stroke: "#2a2f3d" },
  finding: { label: "Constat", fill: "#221416", stroke: "#6b2a2d" },
  missing: { label: "Manquant", fill: null, stroke: "#6b2a2d" },
};
