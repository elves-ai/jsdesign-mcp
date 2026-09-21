import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import type { DesignStore } from './store.js';
import type { PluginBridge } from './bridge.js';
import type { AssetBinary, AssetManifestItem, AssetWriteMeta } from './types.js';
import { isDesignPayload } from './types.js';
import { writeAssetBytes, writeAssetFromBase64 } from './assets.js';

const ASSET_KINDS: Array<AssetBinary['kind']> = [
  'image_fill',
  'export_setting',
  'icon_slice',
  'preview',
];

export function createHttpApp(store: DesignStore, bridge: PluginBridge) {
  const app = express();
  app.use(cors());
  // 插件回传切图 base64 可能较大（仅兜底路径会走 JSON），落盘前需足够 body 上限
  app.use(express.json({ limit: '50mb' }));

  function queryString(req: express.Request, name: string): string | undefined {
    const raw = req.query[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value ? value : undefined;
  }

  function queryNumber(req: express.Request, name: string): number | undefined {
    const value = Number(queryString(req, name));
    return Number.isFinite(value) ? value : undefined;
  }

  function queryField(req: express.Request): AssetWriteMeta['field'] {
    const value = queryString(req, 'field');
    return value === 'image' || value === 'preview' ? value : 'slice';
  }

  function queryKind(req: express.Request): AssetBinary['kind'] | undefined {
    const value = queryString(req, 'kind');
    return ASSET_KINDS.find((kind) => kind === value);
  }

  app.get('/health', (_req, res) => {
    const data = store.get();
    res.json({
      ok: true,
      role: 'bridge',
      pluginConnected: bridge.pluginConnected,
      connectionCount: bridge.connectionCount,
      hasData: data !== null,
      exportedAt: data?.meta.exportedAt ?? null,
      pageName: data?.meta.pageName ?? null,
      rootName: data?.root.name ?? null,
    });
  });

  app.post('/plugin/connect', (_req, res) => {
    const { sessionId } = bridge.connect();
    res.json({ ok: true, sessionId });
  });

  app.post('/plugin/disconnect', (req, res) => {
    const sessionId =
      typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    bridge.disconnect(sessionId);
    res.json({ ok: true });
  });

  /** Long-poll: returns a fetch job or { job: null } on timeout. */
  app.get('/plugin/wait', async (req, res) => {
    const sessionId = String(req.query.sessionId || '');
    if (!sessionId || !bridge.touch(sessionId)) {
      res.status(401).json({ ok: false, error: 'not connected' });
      return;
    }
    try {
      const job = await bridge.waitForJob(sessionId, 25000);
      res.json({ ok: true, job });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  /**
   * 插件直传原始字节：请求体就是文件内容，bridge 从 socket 直接写盘。
   * 元信息走 query，避免 base64 与整包 JSON 序列化（大图的性能关键路径）。
   */
  app.post(
    '/plugin/asset-bin',
    express.raw({ type: () => true, limit: '50mb' }),
    (req, res) => {
      const key = queryString(req, 'key');
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!key) {
        res.status(400).json({ ok: false, error: 'key required' });
        return;
      }
      if (!body.length) {
        res.status(400).json({ ok: false, error: 'empty body' });
        return;
      }

      const item = writeAssetBytes(
        {
          key,
          nodeId: queryString(req, 'nodeId'),
          nodeName: queryString(req, 'nodeName'),
          field: queryField(req),
          kind: queryKind(req),
          mimeType: queryString(req, 'mime'),
          width: queryNumber(req, 'width'),
          height: queryNumber(req, 'height'),
          ref: queryString(req, 'ref'),
        },
        body,
        store.getAssetsDir()
      );
      if (!item) {
        res.status(500).json({ ok: false, error: 'write failed' });
        return;
      }

      const attached = store.attachAsset(item) || item;
      const requestId = queryString(req, 'requestId');
      if (requestId) bridge.addAssetResult(requestId, attached);
      res.json({ ok: true, item: attached });
    }
  );

  app.post('/plugin/result', (req, res) => {
    const requestId = String(req.body?.requestId || '');
    if (!requestId) {
      res.status(400).json({ ok: false, error: 'requestId required' });
      return;
    }

    if (isDesignPayload(req.body.payload)) {
      const accepted = bridge.completePayload(requestId, {
        ok: true,
        payload: req.body.payload,
      });
      res.json({ ok: accepted });
      return;
    }

    if (!req.body?.ok) {
      const error = String(req.body?.error || 'plugin error');
      const accepted =
        bridge.completeAssets(requestId, { ok: false, error }) ||
        bridge.completePayload(requestId, { ok: false, error });
      res.json({ ok: accepted });
      return;
    }

    // 按需切图结果：data 项是兜底 base64，path 项已在 /plugin/asset-bin 落盘
    const incoming: Array<Record<string, unknown>> = Array.isArray(req.body.assets)
      ? req.body.assets
      : [];
    const items: Array<AssetManifestItem & { svg?: string }> = [];

    for (const entry of incoming) {
      const meta: AssetWriteMeta = {
        key: typeof entry.key === 'string' ? entry.key : undefined,
        nodeId: typeof entry.nodeId === 'string' ? entry.nodeId : undefined,
        nodeName: typeof entry.nodeName === 'string' ? entry.nodeName : undefined,
        field:
          entry.field === 'image' || entry.field === 'preview' ? entry.field : 'slice',
        kind: ASSET_KINDS.find((kind) => kind === entry.kind),
        mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : undefined,
        byteLength:
          typeof entry.byteLength === 'number' ? entry.byteLength : undefined,
        width: typeof entry.width === 'number' ? entry.width : undefined,
        height: typeof entry.height === 'number' ? entry.height : undefined,
        ref: typeof entry.ref === 'string' ? entry.ref : undefined,
      };

      let item: AssetManifestItem | undefined;
      if (typeof entry.data === 'string') {
        item = writeAssetFromBase64(
          { ...meta, data: entry.data },
          store.getAssetsDir()
        );
      } else if (typeof entry.path === 'string') {
        item = { ...(entry as unknown as AssetManifestItem) };
      }
      if (!item) continue;

      const carried: AssetManifestItem & { svg?: string } = { ...item };
      if (typeof entry.svg === 'string') carried.svg = entry.svg;
      const attached = store.attachAsset(carried) || carried;
      items.push(attached);
      bridge.addAssetResult(requestId, attached);
    }

    const accepted = bridge.completeAssets(requestId, { ok: true });
    res.json({ ok: accepted, items });
  });

  app.post('/ingest', (req, res) => {
    if (!isDesignPayload(req.body)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid DesignPayload. Expect meta/tokens/root.',
      });
      return;
    }
    store.set(req.body);
    res.json({
      ok: true,
      rootName: req.body.root.name,
      truncated: Boolean(req.body.meta.truncated),
    });
  });

  app.post('/internal/fetch-node', async (req, res) => {
    const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId : '';
    if (!nodeId) {
      res.status(400).json({ ok: false, error: 'nodeId required' });
      return;
    }
    try {
      const payload = await bridge.fetchNode(nodeId, req.body?.meta || {});
      store.set(payload);
      res.json({ ok: true, payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    }
  });

  /** 按需切图：MCP 指定节点 id / 图片 hash，插件导出后字节直接落盘 */
  app.post('/internal/export-assets', async (req, res) => {
    const nodeIds = Array.isArray(req.body?.nodeIds)
      ? req.body.nodeIds.map((v: unknown) => String(v))
      : [];
    const refs = Array.isArray(req.body?.refs)
      ? req.body.refs.map((v: unknown) => String(v))
      : [];
    if (nodeIds.length === 0 && refs.length === 0) {
      res.status(400).json({ ok: false, error: 'nodeIds or refs required' });
      return;
    }
    try {
      const items = await bridge.fetchAssets({ nodeIds, refs });
      res.json({ ok: true, assetsDir: store.getAssetsDir(), items });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ ok: false, error: message });
    }
  });

  app.get('/internal/latest', (_req, res) => {
    const data = store.get();
    if (!data) {
      res.status(404).json({ ok: false, error: 'no cached data' });
      return;
    }
    res.json({ ok: true, payload: data });
  });

  return app;
}

export const DEFAULT_HTTP_PORT = 3847;
