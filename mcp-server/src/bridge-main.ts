import { startBridgeServer, DEFAULT_HTTP_PORT } from './server.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);

try {
  await startBridgeServer(port);
  console.error('[jsdesign-mcp] bridge ready (HTTP long-poll, no MCP stdio)');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('EADDRINUSE')) {
    console.error(
      `[jsdesign-mcp] port ${port} already in use — bridge may already be running`
    );
    process.exit(0);
  }
  console.error('[jsdesign-mcp] failed to start bridge:', message);
  process.exit(1);
}
