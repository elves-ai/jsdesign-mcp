import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DesignStore } from './store.js';
import { handleToolCall, toolDefinitions } from './tools.js';
import { isBridgeUp, DEFAULT_HTTP_PORT } from './server.js';
import {
  createRemoteToolContext,
  fetchHealth,
  fetchLatest,
} from './remote.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new DesignStore();

async function ensureBridge(): Promise<void> {
  if (await isBridgeUp(port)) {
    console.error(
      `[jsdesign-mcp] using existing bridge http://127.0.0.1:${port}`
    );
    return;
  }

  const bridgeMain = path.join(__dirname, 'bridge-main.js');
  spawn(process.execPath, [bridgeMain], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, JSDESIGN_MCP_PORT: String(port) },
  }).unref();

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 120));
    if (await isBridgeUp(port)) {
      console.error('[jsdesign-mcp] spawned standalone bridge');
      return;
    }
  }

  console.error(
    '[jsdesign-mcp] WARNING: bridge not up; run: npm run bridge'
  );
}

function startBridgeHeartbeat(): void {
  const tick = () => {
    fetchHealth(port).catch(() => {});
  };
  tick();
  const timer = setInterval(tick, 20_000);
  timer.unref();
}

async function startMcp(): Promise<void> {
  const server = new Server(
    { name: 'jsdesign-mcp', version: '0.3.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments || {}) as Record<string, unknown>;

    if (name !== 'get_node_by_url' && name !== 'get_plugin_status') {
      const latest = await fetchLatest(port);
      if (latest) store.set(latest);
    }

    if (name === 'get_plugin_status') {
      try {
        const health = await fetchHealth(port);
        const latest = await fetchLatest(port);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  pluginConnected: health.pluginConnected,
                  connectionCount: health.connectionCount,
                  hasCachedData: latest !== null,
                  cachedRoot: latest?.root.name ?? health.rootName,
                  bridge: `http://127.0.0.1:${port}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  pluginConnected: false,
                  error: 'bridge unreachable; run npm run bridge',
                  bridge: `http://127.0.0.1:${port}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    const ctx = createRemoteToolContext(port, store);
    try {
      const health = await fetchHealth(port);
      Object.defineProperty(ctx.bridge, 'pluginConnected', {
        get: () => health.pluginConnected,
      });
      Object.defineProperty(ctx.bridge, 'connectionCount', {
        get: () => health.connectionCount,
      });
    } catch {
      // leave defaults
    }

    return handleToolCall(name, args, ctx);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  startBridgeHeartbeat();
  console.error('[jsdesign-mcp] MCP stdio connected (HTTP client → bridge)');
}

await ensureBridge();
await startMcp();
