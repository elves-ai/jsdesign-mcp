import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createHttpApp } from './http.js';
import { DesignStore } from './store.js';
import { PluginBridge } from './bridge.js';

describe('HTTP API', () => {
  let server: Server;
  let base: string;
  let store: DesignStore;
  let bridge: PluginBridge;
  let tmp: string;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-http-'));
    store = new DesignStore(tmp);
    bridge = new PluginBridge();
    const app = createHttpApp(store, bridge);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('GET /health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.role, 'bridge');
    assert.equal(body.hasData, false);
    assert.equal(body.pluginConnected, false);
  });

  it('POST /ingest rejects invalid body', async () => {
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 1 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST /ingest accepts payload', async () => {
    const payload = {
      meta: { exportedAt: '2026-07-29T00:00:00.000Z' },
      tokens: {
        colors: [],
        fontSizes: [],
        fontFamilies: [],
        radii: [],
        spacings: [],
      },
      root: {
        id: '1:1',
        name: 'A',
        type: 'FRAME',
        box: { x: 0, y: 0, w: 1, h: 1 },
        children: [],
      },
    };
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    assert.equal(store.get()?.root.name, 'A');
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.hasData, true);
  });
});
