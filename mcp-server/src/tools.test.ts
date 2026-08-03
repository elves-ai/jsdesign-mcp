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

  it('list_assets returns empty after cache without binaries', async () => {
    store.set(payload);
    const result = await handleToolCall('list_assets', {}, { store, bridge });
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.count, 0);
    assert.ok(parsed.assetsDir.includes('jsdesign-tools-') || parsed.assetsDir);
  });
});
