import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleToolCall, toolDefinitions } from './tools.js';
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
  it('lists four tools', () => {
    assert.equal(toolDefinitions.length, 4);
    assert.deepEqual(
      toolDefinitions.map((t) => t.name).sort(),
      [
        'get_design_tokens',
        'get_node',
        'get_selection_overview',
        'list_nodes',
      ]
    );
  });

  it('prompts when no data', () => {
    const result = handleToolCall('get_selection_overview', {}, null);
    assert.match(result.content[0].text, /请先在即时设计插件中发送选中/);
  });

  it('returns overview JSON', () => {
    const result = handleToolCall('get_selection_overview', {}, payload);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.root.name, 'Card');
  });

  it('get_node by name', () => {
    const result = handleToolCall('get_node', { name: 'Label' }, payload);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.text.characters, 'Hi');
  });
});
