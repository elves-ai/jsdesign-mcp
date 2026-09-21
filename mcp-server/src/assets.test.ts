import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { materializePayloadAssets, writeAssetBytes, writeAssetFromBase64 } from './assets.js';
import type { DesignPayload } from './types.js';

// 1x1 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function payloadWithImage(): DesignPayload {
  return {
    meta: { exportedAt: '2026-07-30T00:00:00.000Z', pageName: 'P' },
    tokens: {
      colors: [],
      fontSizes: [],
      fontFamilies: [],
      radii: [],
      spacings: [],
    },
    root: {
      id: '1:1',
      name: 'Root',
      type: 'FRAME',
      box: { x: 0, y: 0, w: 100, h: 100 },
      preview: {
        kind: 'preview',
        mimeType: 'image/png',
        data: PNG_B64,
        byteLength: 70,
      },
      children: [
        {
          id: '1:2',
          name: 'Photo',
          type: 'RECTANGLE',
          box: { x: 0, y: 0, w: 40, h: 40 },
          image: {
            kind: 'image_fill',
            ref: 'hash123',
            mimeType: 'image/png',
            data: PNG_B64,
          },
          children: [],
        },
        {
          id: '1:3',
          name: 'icon_home',
          type: 'FRAME',
          box: { x: 0, y: 0, w: 24, h: 24 },
          slice: {
            kind: 'icon_slice',
            mimeType: 'image/png',
            data: PNG_B64,
            width: 24,
            height: 24,
          },
          children: [],
        },
      ],
    },
  };
}

describe('materializePayloadAssets', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-assets-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes files and strips base64', () => {
    const { payload, assets } = materializePayloadAssets(
      payloadWithImage(),
      tmp
    );

    assert.equal(assets.length, 3);
    assert.ok(payload.root.preview?.path);
    assert.equal(payload.root.preview?.data, undefined);
    assert.ok(payload.root.children[0].image?.path);
    assert.equal(payload.root.children[0].image?.data, undefined);
    assert.ok(payload.root.children[1].slice?.path);
    assert.equal(payload.meta.assetsDir, tmp);
    assert.equal(payload.meta.assets?.length, 3);

    for (const a of assets) {
      assert.ok(fs.existsSync(a.path));
      assert.ok(fs.statSync(a.path).size > 0);
    }
  });

  it('reuses existing path without data', () => {
    const first = materializePayloadAssets(payloadWithImage(), tmp);
    const pathKeep = first.payload.root.children[0].image!.path!;
    const again = materializePayloadAssets(first.payload, tmp);
    assert.equal(again.payload.root.children[0].image?.path, pathKeep);
    assert.ok(again.assets.some((a) => a.path === pathKeep));
  });

  it('writes svg slice as .svg', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M0 0h16v16H0z" fill="#fff"/></svg>';
    const payload: DesignPayload = {
      meta: { exportedAt: '2026-07-30T00:00:00.000Z', pageName: 'P' },
      tokens: {
        colors: [],
        fontSizes: [],
        fontFamilies: [],
        radii: [],
        spacings: [],
      },
      root: {
        id: '2:1',
        name: 'Icon',
        type: 'FRAME',
        box: { x: 0, y: 0, w: 16, h: 16 },
        slice: {
          kind: 'icon_slice',
          mimeType: 'image/svg+xml',
          data: Buffer.from(svg, 'utf8').toString('base64'),
          width: 16,
          height: 16,
        },
        children: [],
      },
    };

    const { assets } = materializePayloadAssets(payload, tmp);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].mimeType, 'image/svg+xml');
    assert.ok(assets[0].path.endsWith('.svg'));
    assert.equal(fs.readFileSync(assets[0].path, 'utf8'), svg);
  });
});

describe('按需切图落盘', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-asset-write-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writeAssetBytes 把原始字节写盘并返回清单项', () => {
    const bytes = Buffer.from(PNG_B64, 'base64');
    const item = writeAssetBytes(
      {
        key: 'hash-1',
        nodeId: '1:2',
        nodeName: 'Photo',
        field: 'image',
        kind: 'image_fill',
        mimeType: 'image/png',
        width: 40,
        height: 40,
        ref: 'hash-1',
      },
      bytes,
      tmp
    );
    assert.ok(item);
    assert.equal(item!.key, 'hash-1');
    assert.equal(item!.byteLength, bytes.length);
    assert.ok(item!.path.endsWith('.png'));
    assert.equal(fs.readFileSync(item!.path).length, bytes.length);
  });

  it('writeAssetBytes 拒绝空字节', () => {
    const item = writeAssetBytes(
      { key: 'k', field: 'slice' },
      Buffer.alloc(0),
      tmp
    );
    assert.equal(item, undefined);
  });

  it('writeAssetFromBase64 兜底写出 SVG 源码', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const item = writeAssetFromBase64(
      {
        key: '3:1',
        nodeId: '3:1',
        field: 'slice',
        kind: 'icon_slice',
        mimeType: 'image/svg+xml',
        data: Buffer.from(svg, 'utf8').toString('base64'),
      },
      tmp
    );
    assert.ok(item);
    assert.ok(item!.path.endsWith('.svg'));
    assert.equal(fs.readFileSync(item!.path, 'utf8'), svg);
  });
});
