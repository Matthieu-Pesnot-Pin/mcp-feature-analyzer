import { EXPLANATION_SIDES, ITEM_ID_PATTERN, type ExplanationSide } from "../../shared/schemas/analysis.schema.js";
import { has, nullableString, optionalEnum, optionalPositiveInt, type Args } from "./types.js";

/** Emplacement demandé par l'agent : `null` pour retirer l'emplacement, `undefined` s'il n'en donne pas. */
export type LocationInput = { path: string; startLine: number; endLine: number | undefined } | null | undefined;

/**
 * Lit `path`, `start_line` et `end_line`. `path` et `start_line` vont ensemble ;
 * `end_line` vaut `start_line` quand il est omis. `path: null` retire l'emplacement.
 */
export function readLocation(args: Args, prefix = ""): LocationInput {
  const path = nullableString(args, "path", prefix);
  const startLine = optionalPositiveInt(args, "start_line", prefix);
  const endLine = optionalPositiveInt(args, "end_line", prefix);

  if (path === null) {
    if (startLine !== undefined || endLine !== undefined) {
      throw new Error(`"${prefix}path" is null (location removed), so "start_line" and "end_line" cannot be set.`);
    }
    return null;
  }
  if (path === undefined) {
    if (startLine !== undefined || endLine !== undefined) {
      throw new Error(`"${prefix}start_line" and "${prefix}end_line" need "${prefix}path": give the file they refer to.`);
    }
    return undefined;
  }
  if (startLine === undefined) {
    throw new Error(`"${prefix}start_line" is required with "${prefix}path": give the first new-side line (see get_diff).`);
  }
  if (endLine !== undefined && endLine < startLine) {
    throw new Error(`"${prefix}end_line" (${endLine}) must be >= "${prefix}start_line" (${startLine}).`);
  }
  return { path, startLine, endLine };
}

/** Emplacement d'une explication demandé par l'agent ; `undefined` s'il n'en donne pas. */
export type ExplanationLocationInput = { path: string; side: ExplanationSide; startLine: number; endLine: number | undefined } | undefined;

/**
 * Lit `path`, `side`, `start_line` et `end_line` d'une explication. `path` et
 * `start_line` vont ensemble ; `side` vaut `new` quand il est omis ; `end_line`
 * vaut `start_line` quand il est omis. Une explication a toujours un emplacement.
 */
export function readExplanationLocation(args: Args, prefix = ""): ExplanationLocationInput {
  const side = optionalEnum(args, "side", EXPLANATION_SIDES, prefix);
  const location = readLocation(args, prefix);
  if (location === null) {
    throw new Error(`"${prefix}path" cannot be null: an explanation always describes lines of a changed file.`);
  }
  if (location === undefined) {
    if (side !== undefined) throw new Error(`"${prefix}side" needs "${prefix}path" and "${prefix}start_line": give the lines it refers to.`);
    return undefined;
  }
  return { ...location, side: side ?? "new" };
}

/** Lit un identifiant d'élément facultatif fourni par l'agent. */
export function readItemId(args: Args, field: string, prefix = ""): string | undefined {
  if (!has(args, field)) return undefined;
  const value = args![field];
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) {
    throw new Error(`"${prefix}${field}" must contain only letters, digits, '_' or '-' (1 to 64 characters).`);
  }
  return value;
}
