import http from 'node:http';
import { createHttpApp, DEFAULT_HTTP_PORT } from './http.js';
import { DesignStore } from './store.js';
import { PluginBridge } from './bridge.js';

export { DEFAULT_HTTP_PORT };

export type BridgeRuntime = {
  store: DesignStore;
  bridge: PluginBridge;
  server: http.Server;
  port: number;
};

/** Start HTTP long-poll bridge for the Instant Design plugin. */
export function startBridgeServer(
  port = DEFAULT_HTTP_PORT,
  store = new DesignStore(),
  bridge = new PluginBridge()
): Promise<BridgeRuntime> {
  const app = createHttpApp(store, bridge);
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.error(`[jsdesign-mcp] HTTP on http://127.0.0.1:${port}`);
      console.error(
        `[jsdesign-mcp] plugin connect: POST /plugin/connect  wait: GET /plugin/wait`
      );
      resolve({ store, bridge, server, port });
    });
  });
}

export async function isBridgeUp(port = DEFAULT_HTTP_PORT): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}
