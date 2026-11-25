/**
 * Ce que `--migrate-to-manager` sait du Feature Analyzer : ses variables et la
 * copie de son dossier de stockage (cf. `manager-bundle.ts`).
 *
 * La copie reprend les analyses (`analyses/`) et leurs snapshots de diff
 * (`diffs/`), chaque paire sous le verrou de l'analyse. Elle écarte les
 * journaux (`logs/`), les battements des veilleurs (`watchers/`), les verrous
 * et les fichiers temporaires.
 */
import { AnalysisStore } from "../core/analysis-store.js";
import { APP_VERSION } from "../version.js";
import { runManagerExport, type ManagerExportSpec } from "./manager-bundle.js";

async function copyData(source: string, target: string): Promise<void> {
  new AnalysisStore(source).copyTo(target);
}

const spec: ManagerExportSpec = {
  packageName: "@imenam/mcp-feature-analyzer",
  packageVersion: APP_VERSION,
  legacyStorageKeys: ["MCP_FEATURE_ANALYZER_DATA_DIR", "MCP_DATA_DIR"],
  copyData,
};

export function runMigrateToManager(argv: string[], cwd: string): Promise<number> {
  return runManagerExport(argv, cwd, spec);
}
