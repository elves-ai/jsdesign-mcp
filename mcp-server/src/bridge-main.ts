import {
  startBridgeServer,
  DEFAULT_HTTP_PORT,
  DEFAULT_BRIDGE_IDLE_MS,
} from './server.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);
const idleRaw = process.env.JSDESIGN_MCP_BRIDGE_IDLE_MS;
const idleMs =
  idleRaw === undefined ? DEFAULT_BRIDGE_IDLE_MS : Number(idleRaw);

try {
  await startBridgeServer(port, undefined, undefined, { idleMs });
  console.error(
    `[jsdesign-mcp] bridge ready (HTTP long-poll, no MCP stdio)${
      idleMs > 0 ? `; idle exit ${idleMs}ms` : ''
    }`
  );
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
