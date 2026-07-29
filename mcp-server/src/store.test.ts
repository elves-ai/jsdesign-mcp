import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesignStore } from './store.js';
import type { DesignPayload } from './types.js';

function samplePayload(): DesignPayload {
  return {
    meta: { exportedAt: '2026-07-29T00:00:00.000Z', pageName: 'Home' },
    tokens: {
      colors: ['#ffffff'],
      fontSizes: [14],
      fontFamilies: ['PingFang SC'],
      radii: [8],
      spacings: [16],
    },
    root: {
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      box: { x: 0, y: 0, w: 375, h: 812 },
      children: [],
    },
  };
}

describe('DesignStore', () => {
  let tmpDir: string;
  let store: DesignStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-mcp-'));
    store = new DesignStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when empty', () => {
    assert.equal(store.get(), null);
  });

  it('stores payload in memory and disk', () => {
    const payload = samplePayload();
    store.set(payload);
    assert.deepEqual(store.get(), payload);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'latest.json'), 'utf8')
    );
    assert.deepEqual(onDisk, payload);
  });

  it('loads from disk on construct', () => {
    const payload = samplePayload();
    fs.writeFileSync(
      path.join(tmpDir, 'latest.json'),
      JSON.stringify(payload)
    );
    const reloaded = new DesignStore(tmpDir);
    assert.deepEqual(reloaded.get(), payload);
  });
});
