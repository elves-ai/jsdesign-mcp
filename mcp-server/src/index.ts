import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DesignStore } from './store.js';
import { createHttpApp, DEFAULT_HTTP_PORT } from './http.js';
import { handleToolCall, toolDefinitions } from './tools.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);
const store = new DesignStore();

function startHttp(): void {
  const app = createHttpApp(store);
  app.listen(port, '127.0.0.1', () => {
    console.error(`[jsdesign-mcp] HTTP on http://127.0.0.1:${port}`);
    console.error(`[jsdesign-mcp] ingest: POST /ingest  health: GET /health`);
  });
}

async function startMcp(): Promise<void> {
  const server = new Server(
    { name: 'jsdesign-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(
      request.params.name,
      (request.params.arguments || {}) as Record<string, unknown>,
      store.get()
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[jsdesign-mcp] MCP stdio connected');
}

startHttp();
await startMcp();
