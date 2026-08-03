import express from 'express';
import cors from 'cors';
import type { DesignStore } from './store.js';
import type { PluginBridge } from './bridge.js';
import { isDesignPayload } from './types.js';

export function createHttpApp(store: DesignStore, bridge: PluginBridge) {
  const app = express();
  app.use(cors());
  // 插件回传切图 base64 可能较大，落盘前需足够 body 上限
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => {
    const data = store.get();
    res.json({
      ok: true,
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

  /** Long-poll: returns a fetch-node job or { job: null } on timeout. */
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

  app.post('/plugin/result', (req, res) => {
    const requestId = String(req.body?.requestId || '');
    if (!requestId) {
      res.status(400).json({ ok: false, error: 'requestId required' });
      return;
    }
    if (req.body?.ok) {
      if (!isDesignPayload(req.body.payload)) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const accepted = bridge.completeJob(requestId, {
        ok: true,
        payload: req.body.payload,
      });
      res.json({ ok: accepted });
      return;
    }
    const accepted = bridge.completeJob(requestId, {
      ok: false,
      error: String(req.body?.error || 'plugin error'),
    });
    res.json({ ok: accepted });
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
