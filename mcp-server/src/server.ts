import http from 'node:http';
import { createHttpApp, DEFAULT_HTTP_PORT } from './http.js';
import { DesignStore } from './store.js';
import { PluginBridge } from './bridge.js';

export { DEFAULT_HTTP_PORT };

/** Unused bridge exits after this; plugin long-poll or MCP heartbeat resets it. 0 disables. */
export const DEFAULT_BRIDGE_IDLE_MS = 300_000;

export type BridgeRuntime = {
  store: DesignStore;
  bridge: PluginBridge;
  server: http.Server;
  port: number;
};

export type StartBridgeOptions = {
  idleMs?: number;
};

export function shouldExitIdleBridge(input: {
  idleMs: number;
  now: number;
  lastActivityAt: number;
  pluginConnected: boolean;
}): boolean {
  if (input.idleMs <= 0) return false;
  if (input.pluginConnected) return false;
  return input.now - input.lastActivityAt >= input.idleMs;
}

/** Start HTTP long-poll bridge for the Instant Design plugin. */
export function startBridgeServer(
  port = DEFAULT_HTTP_PORT,
  store = new DesignStore(),
  bridge = new PluginBridge(),
  options: StartBridgeOptions = {}
): Promise<BridgeRuntime> {
  const app = createHttpApp(store, bridge);
  const server = http.createServer(app);
  const idleMs = options.idleMs ?? 0;
  let lastActivityAt = Date.now();

  server.on('request', () => {
    lastActivityAt = Date.now();
  });

  if (idleMs > 0) {
    const timer = setInterval(() => {
      if (
        shouldExitIdleBridge({
          idleMs,
          now: Date.now(),
          lastActivityAt,
          pluginConnected: bridge.pluginConnected,
        })
      ) {
        console.error(
          `[jsdesign-mcp] bridge idle ${idleMs}ms without plugin, exiting`
        );
        clearInterval(timer);
        server.close(() => process.exit(0));
      }
    }, 5000);
    timer.unref();
  }

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
