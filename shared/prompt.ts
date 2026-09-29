import type { Analysis, Finding, Note, ReviewDecision, Severity } from "./schemas/analysis.schema.js";
import { sortBySeverity } from "./severity.js";
import { lineRange, noteLocationText } from "./text.js";

/** Points retenus pour le prompt et décision du relecteur. */
export interface PromptSelection {
  findingIds: string[];
  noteIds: string[];
  decision: ReviewDecision | null;
}

const SEVERITY_NAMES: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  trivial: "Trivial",
};

const DECISION_LINES: Record<ReviewDecision, string> = {
  approve: "Decision: Approve. The feature can be merged.",
  request_changes: "Decision: Request changes. Rework the feature and address the points below.",
  reject: "Decision: Reject. The feature is abandoned.",
};

const INDENT = "   ";

function indent(text: string): string[] {
  return text.split("\n").map((line) => (line === "" ? "" : `${INDENT}${line}`));
}

function fenced(label: string, text: string): string[] {
  return [`${INDENT}${label}`, `${INDENT}\`\`\``, ...indent(text), `${INDENT}\`\`\``];
}

function refsLabel(analysis: Analysis): string {
  if (analysis.mode === "branch") return `branch ${analysis.base}...${analysis.head}`;
  return "working tree changes against HEAD";
}

function findingLocation(finding: Finding): string | null {
  const location = finding.location;
  if (!location) return null;
  return `${location.path}:${lineRange(location.startLine, location.endLine)}`;
}

function findingBlock(number: number, finding: Finding): string[] {
  const location = findingLocation(finding);
  const title = finding.kind === "requirement_gap" ? `Missing requirement: ${finding.title}` : finding.title;
  const head = `${number}. [${SEVERITY_NAMES[finding.severity]}] ${location ? `${location} — ` : ""}${title}`;

  if (finding.prompt !== null) return [head, ...indent(finding.prompt)];

  const lines = [head];
  if (finding.body.trim() !== "") lines.push(...indent(finding.body));
  if (finding.anchorText !== null) lines.push(...fenced("Current lines:", finding.anchorText));
  if (finding.suggestion !== null) lines.push(...fenced("Proposed replacement:", finding.suggestion));
  return lines;
}

function noteBlock(number: number, note: Note): string[] {
  const where = note.location ? `${noteLocationText(note.location)} — ` : "";
  const [first, ...rest] = note.text.split("\n");
  return [`${number}. [Reviewer note] ${where}${first}`, ...rest.map((line) => (line === "" ? "" : `${INDENT}${line}`))];
}

function pick<T extends { id: string }>(items: T[], ids: string[], label: string): T[] {
  const known = new Set(items.map((item) => item.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`Unknown ${label} id(s): ${unknown.join(", ")}.`);
  const wanted = new Set(ids);
  return items.filter((item) => wanted.has(item.id));
}

/**
 * Prompt de correction destiné à l'agent : en-tête (titre, refs, objectif de la
 * feature quand la vue d'ensemble existe), décision,
 * liste numérotée des constats retenus (du plus grave au moins grave, puis dans
 * l'ordre de l'analyse) suivie des remarques du relecteur. Le `prompt` propre
 * à un constat remplace son corps, ses lignes actuelles et son correctif.
 */
export function buildAgentPrompt(analysis: Analysis, selection: PromptSelection): string {
  const findings = sortBySeverity(pick(analysis.findings, selection.findingIds, "finding"));
  const notes = pick(analysis.notes, selection.noteIds, "note");

  const out: string[] = [`Review feedback on "${analysis.title}" (${refsLabel(analysis)}).`];
  if (analysis.overview !== null) out.push(`Feature objective: ${analysis.overview.objective}`);
  if (selection.decision !== null) out.push(DECISION_LINES[selection.decision]);
  out.push("");

  if (findings.length === 0 && notes.length === 0) {
    out.push("No points to address.");
    return out.join("\n");
  }

  out.push("Address the following points:");
  let number = 1;
  for (const finding of findings) {
    out.push("", ...findingBlock(number++, finding));
  }
  for (const note of notes) {
    out.push("", ...noteBlock(number++, note));
  }
  return out.join("\n");
}

/** Prompt de tous les constats ouverts, sans décision ni remarque. */
export function buildAllOpenFindingsPrompt(analysis: Analysis): string {
  return buildAgentPrompt(analysis, {
    findingIds: analysis.findings.filter((finding) => finding.status === "open").map((finding) => finding.id),
    noteIds: [],
    decision: null,
  });
}
