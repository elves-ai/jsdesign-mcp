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

describe('按需切图 HTTP 链路', () => {
  let server: Server;
  let base: string;
  let store: DesignStore;
  let bridge: PluginBridge;
  let tmp: string;

  const PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function payloadWithImage() {
    return {
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
        name: 'Card',
        type: 'FRAME',
        box: { x: 0, y: 0, w: 100, h: 100 },
        children: [
          {
            id: '1:2',
            name: 'Hero',
            type: 'RECTANGLE',
            box: { x: 0, y: 0, w: 40, h: 40 },
            image: { ref: 'hash-hero' },
            children: [],
          },
        ],
      },
    };
  }

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-assets-http-'));
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

  it('插件未连接时 /internal/export-assets 返回 503', async () => {
    const res = await fetch(`${base}/internal/export-assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeIds: ['1:2'] }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /未连接/);
  });

  it('缺 nodeIds/refs 时 400', async () => {
    const res = await fetch(`${base}/internal/export-assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('插件直传原始字节：落盘并回填节点路径', async () => {
    store.set(payloadWithImage() as never);
    const bytes = Buffer.from(PNG_B64, 'base64');
    const query = new URLSearchParams({
      requestId: 'req-direct',
      key: 'hash-hero',
      nodeId: '1:2',
      nodeName: 'Hero',
      field: 'image',
      kind: 'image_fill',
      mime: 'image/png',
    });
    const res = await fetch(`${base}/plugin/asset-bin?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.item.path.endsWith('.png'));
    assert.equal(fs.readFileSync(body.item.path).length, bytes.length);
    assert.equal(store.get()!.root.children[0].image?.path, body.item.path);
    assert.equal(store.getAssets().length, 1);
  });

  it('asset-bin 拒绝空 body', async () => {
    const res = await fetch(`${base}/plugin/asset-bin?key=empty`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(0),
    });
    assert.equal(res.status, 400);
  });

  it('任务全链路：直传项与兜底 base64 项都由 bridge 落盘', async () => {
    store.set(payloadWithImage() as never);
    const { sessionId } = bridge.connect();

    const pending = fetch(`${base}/internal/export-assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeIds: ['1:2'], refs: ['hash-hero'] }),
    });

    const waited = await (
      await fetch(
        `${base}/plugin/wait?sessionId=${encodeURIComponent(sessionId)}`
      )
    ).json();
    assert.equal(waited.job.kind, 'assets');
    assert.deepEqual(waited.job.nodeIds, ['1:2']);
    assert.deepEqual(waited.job.refs, ['hash-hero']);

    // 第一项走直传
    const bytes = Buffer.from(PNG_B64, 'base64');
    const direct = await (
      await fetch(
        `${base}/plugin/asset-bin?${new URLSearchParams({
          requestId: waited.job.requestId,
          key: 'hash-hero',
          nodeId: '1:2',
          nodeName: 'Hero',
          field: 'image',
          kind: 'image_fill',
          mime: 'image/png',
        })}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes,
        }
      )
    ).json();
    assert.equal(direct.ok, true);

    // 第二项走兜底 base64
    const result = await (
      await fetch(`${base}/plugin/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'export-assets-result',
          requestId: waited.job.requestId,
          ok: true,
          assets: [
            {
              key: 'hash-hero',
              nodeId: '1:2',
              nodeName: 'Hero',
              field: 'image',
              kind: 'image_fill',
              mimeType: 'image/png',
              path: direct.item.path,
            },
            {
              key: '1:1',
              nodeId: '1:1',
              nodeName: 'Card',
              field: 'slice',
              kind: 'icon_slice',
              mimeType: 'image/png',
              data: PNG_B64,
            },
          ],
          skipped: [{ key: '4:4', reason: '未找到节点' }],
        }),
      })
    ).json();
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 2);

    const body = await (await pending).json();
    assert.equal(body.ok, true);
    assert.equal(body.items.length, 2);
    for (const item of body.items as Array<{ path: string }>) {
      assert.ok(fs.existsSync(item.path), `${item.path} should exist`);
    }
    assert.equal(store.getAssets().length, 2);
    assert.equal(store.get()!.root.slice?.path, result.items[1].path);
  });
});
