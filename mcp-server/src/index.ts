import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DesignStore } from './store.js';
import { createHttpApp, DEFAULT_HTTP_PORT } from './http.js';
import { handleToolCall, toolDefinitions } from './tools.js';
import { PluginBridge } from './bridge.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);
const store = new DesignStore();
const bridge = new PluginBridge();

function startHttpAndWs(): http.Server {
  const app = createHttpApp(store, bridge);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/plugin' });

  wss.on('connection', (ws) => {
    console.error('[jsdesign-mcp] plugin WebSocket connected');
    bridge.addClient(ws);
    ws.on('close', () => {
      console.error('[jsdesign-mcp] plugin WebSocket disconnected');
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.error(`[jsdesign-mcp] HTTP on http://127.0.0.1:${port}`);
    console.error(`[jsdesign-mcp] plugin WS ws://127.0.0.1:${port}/plugin`);
  });

  return server;
}

async function startMcp(): Promise<void> {
  const server = new Server(
    { name: 'jsdesign-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(
      request.params.name,
      (request.params.arguments || {}) as Record<string, unknown>,
      { store, bridge }
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[jsdesign-mcp] MCP stdio connected');
}

startHttpAndWs();
await startMcp();
