import {
  startBridgeServer,
  DEFAULT_HTTP_PORT,
  DEFAULT_BRIDGE_IDLE_MS,
} from './server.js';
import { DesignStore, DEFAULT_ASSET_MAX_AGE_MS } from './store.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);
const idleRaw = process.env.JSDESIGN_MCP_BRIDGE_IDLE_MS;
const idleMs =
  idleRaw === undefined ? DEFAULT_BRIDGE_IDLE_MS : Number(idleRaw);
const assetAgeRaw = process.env.JSDESIGN_MCP_ASSET_MAX_AGE_MS;
const assetMaxAgeMs =
  assetAgeRaw === undefined ? DEFAULT_ASSET_MAX_AGE_MS : Number(assetAgeRaw);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 启动时清一次过期切图，避免 assetsDir 无限增长 */
function pruneAssetsOnStart(store: DesignStore): void {
  const report = store.pruneAssets(assetMaxAgeMs);
  if (!report.removedFiles && !report.removedEntries && !report.clearedPaths) {
    return;
  }
  console.error(
    `[jsdesign-mcp] 清理过期切图：删除 ${report.removedFiles} 个文件（${formatSize(
      report.removedBytes
    )}），索引摘除 ${report.removedEntries} 项，节点摘除 ${report.clearedPaths} 个失效 path`
  );
}

const store = new DesignStore();
pruneAssetsOnStart(store);

try {
  await startBridgeServer(port, store, undefined, { idleMs });
  console.error(
    `[jsdesign-mcp] bridge ready (HTTP long-poll, no MCP stdio)${
      idleMs > 0 ? `; idle exit ${idleMs}ms` : ''
    }`
  );
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('EADDRINUSE')) {
    console.error(
      `[jsdesign-mcp] port ${port} already in use — run: npm stop`
    );
    process.exit(1);
  }
  console.error('[jsdesign-mcp] failed to start bridge:', message);
  process.exit(1);
}
