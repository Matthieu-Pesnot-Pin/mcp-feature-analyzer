import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { McpClient, baseEnv, makeTempDir } from "./helpers.js";

/**
 * Test de bout en bout : un vrai serveur MCP sur stdio et son GUI worker
 * enregistré auprès du proxy. Sans proxy joignable la suite est ignorée.
 */

const PROXY_URL = process.env.E2E_PROXY_URL ?? "http://localhost:3000";
const APP_PATH = "/feature-analyzer-e2e-test";

async function proxyIsUp(): Promise<boolean> {
  try {
    const response = await fetch(PROXY_URL, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  }
}

let client: McpClient | null = null;
let temp: { dir: string; cleanup: () => void } | null = null;
let guiUrl = "";
let available = false;

before(async () => {
  available = await proxyIsUp();
  if (!available) return;

  temp = makeTempDir("mcp-feature-analyzer-e2e-");
  client = new McpClient({
    ...baseEnv(),
    MCP_FEATURE_ANALYZER_DATA_DIR: temp.dir,
    PROXY_URL,
    APP_PATH,
    APP_NAME: "Feature Analyzer E2E",
  });
  await client.initialize("mcp-feature-analyzer-e2e");

  // Le worker n'écoute qu'une fois enregistré auprès du proxy, qui lui assigne
  // son port. Le test interroge ce port en direct : le proxy exige une
  // authentification que le test n'a pas à traverser.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const port = client.stderr.join("").match(/listening on port (\d+)/)?.[1];
    if (port) {
      try {
        const health = await fetch(`http://127.0.0.1:${port}/proxy/health`, { signal: AbortSignal.timeout(2000) });
        if (health.ok) {
          guiUrl = `http://127.0.0.1:${port}`;
          break;
        }
      } catch {
        // Le serveur HTTP n'accepte pas encore de connexion.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

after(async () => {
  await client?.stop();
  if (available) {
    // Sous Windows le worker est tué sans passer par son handler SIGTERM :
    // la route est retirée du proxy ici.
    await fetch(`${PROXY_URL}/proxy/unregister`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: APP_PATH }),
    }).catch(() => undefined);
  }
  temp?.cleanup();
});

function skipUnlessAvailable(t: { skip: (reason: string) => void }): boolean {
  if (!available) {
    t.skip(`proxy unreachable at ${PROXY_URL} — start it to run the end-to-end suite`);
    return true;
  }
  return false;
}

test("the GUI worker registers with the proxy", async (t) => {
  if (skipUnlessAvailable(t)) return;
  assert.notEqual(guiUrl, "", `the GUI never became reachable. stderr:\n${client!.stderr.join("")}`);

  const health = await (await fetch(`${guiUrl}/proxy/health`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.ipc, "connected");
  assert.equal(health.proxy, "connected", "the worker must be registered with the proxy");
});

test("the worker serves /api/config from the master over IPC", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const response = await fetch(`${guiUrl}/api/config`);
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.dataDir, temp!.dir);
  assert.match(config.version, /^\d+\.\d+\.\d+/);
});

test("the worker serves the SPA with the proxy base href", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const html = await (await fetch(`${guiUrl}/review/some/deep/link`)).text();
  assert.match(html, /<base href="\/feature-analyzer-e2e-test\/" \/>/);
  assert.match(html, /<div id="root"><\/div>/);

  const direct = await (await fetch(`${guiUrl}/?__direct=1`)).text();
  assert.match(direct, /<base href="\/" \/>/);

  const asset = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, "index.html must reference a bundled script under ./assets/");
  const script = await fetch(`${guiUrl}/${asset}`);
  assert.equal(script.status, 200);
});

test("the SSE stream pushes the initial state requested from the master", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const controller = new AbortController();
  const response = await fetch(`${guiUrl}/api/events`, { signal: controller.signal });
  assert.equal(response.headers.get("content-type")?.startsWith("text/event-stream"), true);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let received = "";
  const deadline = Date.now() + 5000;
  try {
    while (!received.includes("INITIAL_STATE") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
  } finally {
    controller.abort();
  }
  assert.match(received, /"type":"INITIAL_STATE"/);
});

test("reconnect_gui reports the GUI as already registered", async (t) => {
  if (skipUnlessAvailable(t)) return;

  const result = await client!.callTool("reconnect_gui");
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /already registered/);
});
