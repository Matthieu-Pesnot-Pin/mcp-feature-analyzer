import type {
  AnalysisMode,
  FileStatus,
  FindingKind,
  FindingStatus,
  NodeStatus,
  ReviewDecision,
  ReviewProgressState,
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
  untracked: "Non suivi",
};

/** Lettre de statut d'un fichier, à la manière de `git status --short`. */
export const FILE_STATUS_LETTERS: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
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

/** Pastille de l'état d'avancement d'une revue. */
export const REVIEW_PROGRESS_STYLES: Record<ReviewProgressState, BadgeStyle> = {
  not_started: { label: "Non commencée", color: "#9aa1b1", background: "#1c2029" },
  in_progress: { label: "En cours", color: "#6fb3ff", background: "#13243a" },
  files_reviewed: { label: "Fichiers revus", color: "#8b97ff", background: "#1b1f3d" },
  submitted: { label: "Soumise", color: "#3fb950", background: "#11201a" },
};

/** Pastille de la décision d'une revue soumise, affichée à côté de « Soumise ». */
export const DECISION_STYLES: Record<ReviewDecision, BadgeStyle> = {
  approve: { label: "Approuvée", color: "#3fb950", background: "#11201a" },
  request_changes: { label: "Corrections demandées", color: "#e3a33b", background: "#33270f" },
  reject: { label: "Rejetée", color: "#f0625a", background: "#34191c" },
};

/**
 * Apparence d'un nœud de schéma : fond (`fill` null : contour seul), contour,
 * couleur du libellé et couleur de l'icône.
 */
export interface NodeStyle {
  label: string;
  fill: string | null;
  stroke: string;
  text: string;
  accent: string;
}

export const NODE_STATUS_STYLES: Record<NodeStatus, NodeStyle> = {
  new: { label: "Nouveau", fill: "#11201a", stroke: "#2c6b3a", text: "#bfeccd", accent: "#3fb950" },
  modified: { label: "Modifié", fill: "#151a2b", stroke: "#36407a", text: "#d5daff", accent: "#8b97ff" },
  impacted: { label: "Impacté, non modifié", fill: "#13161f", stroke: "#2a2f3d", text: "#7b8396", accent: "#646b7b" },
  existing: { label: "Existant", fill: "#13161f", stroke: "#2a2f3d", text: "#9aa1b1", accent: "#646b7b" },
  finding: { label: "Constat", fill: "#221416", stroke: "#6b2a2d", text: "#f0a09a", accent: "#f0625a" },
  missing: { label: "Attendu, absent", fill: null, stroke: "#6b2a2d", text: "#f0776f", accent: "#b0605b" },
};
