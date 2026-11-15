import fs from "fs";
import path from "path";

/** Dossier de stockage des analyses : DATA_DIR, obligatoire. Il est créé s'il n'existe pas encore. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DATA_DIR?.trim();
  if (!configured) {
    throw new Error("DATA_DIR is not set. It is the folder where the analyses are stored.");
  }
  const dataDir = path.resolve(configured);
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
