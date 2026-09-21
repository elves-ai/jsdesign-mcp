import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesignStore, DEFAULT_ASSET_MAX_AGE_MS } from './store.js';
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
    const got = store.get();
    assert.ok(got);
    assert.equal(got!.root.name, 'Frame');
    assert.ok(Array.isArray(got!.meta.assets));
    assert.equal(got!.meta.assetsDir, path.join(tmpDir, 'assets'));
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'latest.json'), 'utf8')
    );
    assert.equal(onDisk.root.name, 'Frame');
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

  it('attachAsset 回填节点路径、去重并持久化', () => {
    store.set(samplePayload());
    const item = store.attachAsset({
      nodeId: '1:1',
      nodeName: 'Frame',
      field: 'slice',
      key: '1:1',
      kind: 'icon_slice',
      path: path.join(tmpDir, 'assets', 'Frame-abc.svg'),
      mimeType: 'image/svg+xml',
      byteLength: 120,
      svg: '<svg/>',
    });
    assert.ok(item);
    assert.equal(store.get()!.root.slice?.path, item!.path);
    assert.equal(store.get()!.root.svg, '<svg/>');
    assert.equal(store.getAssets().length, 1);

    // 同一 key 重复回填不产生重复项
    store.attachAsset({
      nodeId: '1:1',
      nodeName: 'Frame',
      field: 'slice',
      key: '1:1',
      kind: 'icon_slice',
      path: path.join(tmpDir, 'assets', 'Frame-abc.svg'),
      mimeType: 'image/svg+xml',
    });
    assert.equal(store.getAssets().length, 1);

    const assetsOnDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'assets.json'), 'utf8')
    );
    assert.equal(assetsOnDisk.assets.length, 1);
  });

  it('findAssetByKey 只复用文件仍在的资产', () => {
    store.set(samplePayload());
    assert.equal(store.findAssetByKey('hash-1'), undefined);

    const file = path.join(tmpDir, 'assets', 'Frame-hash1.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from('x'));
    store.attachAsset({
      nodeId: '1:1',
      field: 'image',
      key: 'hash-1',
      ref: 'hash-1',
      path: file,
      mimeType: 'image/png',
    });
    assert.ok(store.findAssetByKey('hash-1'));

    // 文件被删掉后不再命中，避免返回失效路径
    fs.rmSync(file);
    assert.equal(store.findAssetByKey('hash-1'), undefined);
  });
});

const DAY = 24 * 60 * 60 * 1000;

function writeAgedFile(filePath: string, ageMs: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('xxxx'));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, when, when);
}

describe('DesignStore.pruneAssets', () => {
  let tmpDir: string;
  let store: DesignStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-prune-'));
    store = new DesignStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('删掉超过 7 天的切图，保留新文件与隐藏文件', () => {
    const assetsDir = path.join(tmpDir, 'assets');
    const stale = path.join(assetsDir, 'Old-hash1.png');
    const fresh = path.join(assetsDir, 'New-hash2.png');
    const hidden = path.join(assetsDir, '.DS_Store');
    writeAgedFile(stale, 8 * DAY);
    writeAgedFile(fresh, 1 * DAY);
    writeAgedFile(hidden, 30 * DAY);

    const report = store.pruneAssets(DEFAULT_ASSET_MAX_AGE_MS);

    assert.equal(report.removedFiles, 1);
    assert.equal(report.removedBytes, 4);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(hidden), true);
  });

  it('摘掉索引与节点上指向已删文件的引用，保留 ref 等元信息', () => {
    const assetsDir = path.join(tmpDir, 'assets');
    const stale = path.join(assetsDir, 'Icon-abc.svg');
    writeAgedFile(stale, 9 * DAY);

    const payload = samplePayload();
    payload.root.slice = {
      kind: 'icon_slice',
      ref: '1:1',
      mimeType: 'image/svg+xml',
      byteLength: 4,
      path: stale,
    };
    payload.root.svg = '<svg/>';
    store.set(payload);
    assert.equal(store.getAssets().length, 1);

    const report = store.pruneAssets(DEFAULT_ASSET_MAX_AGE_MS);

    assert.equal(report.removedFiles, 1);
    assert.equal(report.removedEntries, 1);
    assert.equal(report.clearedPaths, 1);
    assert.equal(store.getAssets().length, 0);
    // 节点上不再有失效 path，但 ref / mimeType 仍在，可按 ref 重新取图
    assert.equal(store.get()!.root.slice?.path, undefined);
    assert.equal(store.get()!.root.slice?.ref, '1:1');
    assert.equal(store.get()!.root.slice?.mimeType, 'image/svg+xml');
    assert.equal(store.get()!.root.svg, '<svg/>');

    // 清理结果落盘
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'assets.json'), 'utf8')
    );
    assert.equal(manifest.assets.length, 0);
  });

  it('顺带摘掉文件已被外部删除的悬空索引项', () => {
    const file = path.join(tmpDir, 'assets', 'Gone-hash9.png');
    writeAgedFile(file, 1 * DAY);
    store.set(samplePayload());
    store.attachAsset({
      nodeId: '1:1',
      field: 'image',
      key: 'hash-9',
      ref: 'hash-9',
      path: file,
      mimeType: 'image/png',
    });
    assert.equal(store.getAssets().length, 1);

    fs.rmSync(file);
    const report = store.pruneAssets(DEFAULT_ASSET_MAX_AGE_MS);

    assert.equal(report.removedFiles, 0);
    assert.equal(report.removedEntries, 1);
    assert.equal(store.getAssets().length, 0);
  });

  it('maxAgeMs <= 0 时不动任何文件', () => {
    const stale = path.join(tmpDir, 'assets', 'Old-hash1.png');
    writeAgedFile(stale, 400 * DAY);

    const report = store.pruneAssets(0);

    assert.deepEqual(report, {
      removedFiles: 0,
      removedBytes: 0,
      removedEntries: 0,
      clearedPaths: 0,
    });
    assert.equal(fs.existsSync(stale), true);
  });

  it('env 传入非法值时按跳过处理，不误删', () => {
    const stale = path.join(tmpDir, 'assets', 'Old-hash1.png');
    writeAgedFile(stale, 400 * DAY);

    assert.equal(store.pruneAssets(Number('oops')).removedFiles, 0);
    assert.equal(fs.existsSync(stale), true);
  });
});
