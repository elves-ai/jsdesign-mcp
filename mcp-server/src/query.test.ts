import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverview,
  findNode,
  listNodes,
  flattenTokens,
} from './query.js';
import type { DesignPayload } from './types.js';

const payload: DesignPayload = {
  meta: { exportedAt: '2026-07-29T00:00:00.000Z', pageName: 'P', truncated: false },
  tokens: {
    colors: ['#111111', '#ffffff'],
    fontSizes: [12, 16],
    fontFamilies: ['Inter'],
    radii: [4],
    spacings: [8, 16],
  },
  root: {
    id: '1:1',
    name: 'Home',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 375, h: 200 },
    children: [
      {
        id: '1:2',
        name: 'Title',
        type: 'TEXT',
        box: { x: 16, y: 16, w: 200, h: 24 },
        text: { characters: 'Hello', fontSize: 16, color: '#111111' },
        children: [],
      },
    ],
  },
};

describe('query', () => {
  it('buildOverview summarizes tree', () => {
    const overview = buildOverview(payload);
    assert.equal(overview.meta.pageName, 'P');
    assert.equal(overview.root.name, 'Home');
    assert.equal(overview.root.childCount, 1);
    assert.deepEqual(overview.tokens.colors, ['#111111', '#ffffff']);
  });

  it('findNode by id and name', () => {
    assert.equal(findNode(payload, { id: '1:2' })?.name, 'Title');
    assert.equal(findNode(payload, { name: 'title' })?.id, '1:2');
    assert.equal(findNode(payload, { name: 'missing' }), null);
  });

  it('listNodes flattens', () => {
    const list = listNodes(payload);
    assert.deepEqual(
      list.map((n) => n.id),
      ['1:1', '1:2']
    );
  });

  it('flattenTokens returns payload tokens', () => {
    assert.deepEqual(flattenTokens(payload), payload.tokens);
  });
});
