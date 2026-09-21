import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleToolCall, toolDefinitions } from './tools.js';
import { DesignStore } from './store.js';
import { PluginBridge } from './bridge.js';
import type { DesignPayload } from './types.js';

const payload: DesignPayload = {
  meta: { exportedAt: '2026-07-29T00:00:00.000Z', pageName: 'Home' },
  tokens: {
    colors: ['#000000'],
    fontSizes: [14],
    fontFamilies: ['Arial'],
    radii: [],
    spacings: [8],
  },
  root: {
    id: '1:1',
    name: 'Card',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 100, h: 100 },
    children: [
      {
        id: '1:2',
        name: 'Label',
        type: 'TEXT',
        box: { x: 0, y: 0, w: 40, h: 20 },
        text: { characters: 'Hi', fontSize: 14 },
        children: [],
      },
    ],
  },
};

describe('MCP tools', () => {
  let tmp: string;
  let store: DesignStore;
  let bridge: PluginBridge;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-tools-'));
    store = new DesignStore(tmp);
    bridge = new PluginBridge();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists primary url tool', () => {
    assert.ok(toolDefinitions.some((t) => t.name === 'get_node_by_url'));
    assert.ok(toolDefinitions.some((t) => t.name === 'get_plugin_status'));
    assert.ok(toolDefinitions.some((t) => t.name === 'list_assets'));
    assert.ok(toolDefinitions.some((t) => t.name === 'export_assets'));
  });

  it('export_assets 需要 ids 或 refs', async () => {
    const result = await handleToolCall('export_assets', {}, { store, bridge });
    assert.match(result.content[0].text, /请提供 ids/);
  });

  it('export_assets 在插件未连接时给出提示', async () => {
    const result = await handleToolCall(
      'export_assets',
      { ids: ['1:2'] },
      { store, bridge }
    );
    assert.match(result.content[0].text, /未连接/);
  });

  it('export_assets 返回 bridge 落盘清单', async () => {
    const item = {
      nodeId: '1:2',
      nodeName: 'Label',
      field: 'slice' as const,
      key: '1:2',
      path: path.join(tmp, 'assets', 'Label-abc.svg'),
      mimeType: 'image/svg+xml',
      byteLength: 42,
    };
    bridge.fetchAssets = async () => [item];
    const result = await handleToolCall(
      'export_assets',
      { ids: ['1:2'] },
      { store, bridge }
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.assets[0].path, item.path);
  });

  it('export_assets 对已落盘的图片 ref 直接复用磁盘，不往返插件', async () => {
    store.set(payload);
    const file = path.join(tmp, 'assets', 'Cached-abc.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from('x'));
    store.attachAsset({
      nodeId: '1:2',
      nodeName: 'Photo',
      field: 'image',
      key: 'hash-cached',
      ref: 'hash-cached',
      path: file,
      mimeType: 'image/png',
    });

    let called = 0;
    bridge.fetchAssets = async () => {
      called += 1;
      return [];
    };
    const result = await handleToolCall(
      'export_assets',
      { refs: ['hash-cached'] },
      { store, bridge }
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(called, 0);
    assert.equal(parsed.cached, true);
    assert.equal(parsed.count, 1);
  });

  it('prompts when no cached data', async () => {
    const result = await handleToolCall('get_selection_overview', {}, {
      store,
      bridge,
    });
    assert.match(result.content[0].text, /get_node_by_url/);
  });

  it('returns overview from cache', async () => {
    store.set(payload);
    const result = await handleToolCall('get_selection_overview', {}, {
      store,
      bridge,
    });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.root.name, 'Card');
  });

  it('get_node by name from cache', async () => {
    store.set(payload);
    const result = await handleToolCall(
      'get_node',
      { name: 'Label' },
      { store, bridge }
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.text.characters, 'Hi');
  });

  it('get_node_by_url fails when plugin disconnected', async () => {
    const result = await handleToolCall(
      'get_node_by_url',
      {
        url: 'https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142',
      },
      { store, bridge }
    );
    assert.match(result.content[0].text, /未连接/);
  });

  it('rejects bad url', async () => {
    const result = await handleToolCall(
      'get_node_by_url',
      { url: 'https://js.design/f/tFH0Pj' },
      { store, bridge }
    );
    assert.match(result.content[0].text, /无法解析/);
  });

  it('插件给了可读文件名时不被链接里的 fileKey 覆盖', async () => {
    bridge.fetchNode = async () => ({
      ...payload,
      meta: { ...payload.meta, fileName: '临沂大屏' },
    });
    const result = await handleToolCall(
      'get_node_by_url',
      { url: 'https://js.design/f/pEgzR6?p=Op09Jw7BeD&mode=design&linkelement=32-23' },
      { store, bridge }
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.overview.meta.fileName, '临沂大屏');
    assert.equal(parsed.link.fileKey, 'pEgzR6');
  });

  it('插件没给文件名时退回链接里的 fileKey', async () => {
    bridge.fetchNode = async () => payload;
    const result = await handleToolCall(
      'get_node_by_url',
      { url: 'https://js.design/f/pEgzR6?p=Op09Jw7BeD&mode=design&linkelement=32-23' },
      { store, bridge }
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.overview.meta.fileName, 'pEgzR6');
  });

  it('list_assets returns empty after cache without binaries', async () => {
    store.set(payload);
    const result = await handleToolCall('list_assets', {}, { store, bridge });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.count, 0);
    assert.ok(parsed.assetsDir.includes('jsdesign-tools-') || parsed.assetsDir);
  });
});
