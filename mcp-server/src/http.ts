import express from 'express';
import cors from 'cors';
import type { DesignStore } from './store.js';
import type { PluginBridge } from './bridge.js';
import { isDesignPayload } from './types.js';

export function createHttpApp(store: DesignStore, bridge: PluginBridge) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

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

  // Kept for optional manual ingest / debugging
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

  return app;
}

export const DEFAULT_HTTP_PORT = 3847;
