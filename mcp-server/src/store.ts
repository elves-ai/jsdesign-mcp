import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  AssetBinary,
  AssetManifestItem,
  DesignNode,
  DesignPayload,
} from './types.js';
import { isDesignPayload } from './types.js';
import {
  BINARY_FIELDS,
  materializePayloadAssets,
  assetKey,
  readInlineSvg,
} from './assets.js';
import { findNode } from './query.js';

export function defaultStoreDir(): string {
  return path.join(os.homedir(), '.jsdesign-mcp');
}

/** 切图缓存保留时长：超过即视为过期，启动时清掉 */
export const DEFAULT_ASSET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PruneReport = {
  /** 按 mtime 删掉的过期文件数 */
  removedFiles: number;
  /** 删掉的字节数 */
  removedBytes: number;
  /** 从索引里摘掉的条目数（含文件已不在的悬空项） */
  removedEntries: number;
  /** 从 payload 节点上摘掉的失效 path 数 */
  clearedPaths: number;
};

function fileExists(filePath: string | undefined): boolean {
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export class DesignStore {
  private payload: DesignPayload | null = null;
  private assets: AssetManifestItem[] = [];
  private readonly dir: string;
  private readonly filePath: string;
  private readonly assetsDir: string;
  private readonly assetsManifestPath: string;

  constructor(dir: string = defaultStoreDir()) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'latest.json');
    this.assetsDir = path.join(dir, 'assets');
    this.assetsManifestPath = path.join(dir, 'assets.json');
    fs.mkdirSync(this.assetsDir, { recursive: true });
    this.loadFromDisk();
  }

  get(): DesignPayload | null {
    return this.payload;
  }

  getAssets(): AssetManifestItem[] {
    return this.assets;
  }

  getAssetsDir(): string {
    return this.assetsDir;
  }

  set(payload: DesignPayload): void {
    const { payload: cleaned, assets } = materializePayloadAssets(
      payload,
      this.assetsDir
    );
    this.payload = cleaned;
    this.assets = assets;
    this.persist();
  }

  /**
   * 按需切图落盘后回填：把本地路径写到对应节点的 image/slice 字段（SVG 另写 svg 源码），
   * 并合并进资产清单。同一 key 或同一路径重复调用是幂等的。
   */
  attachAsset(
    item: AssetManifestItem & { svg?: string }
  ): AssetManifestItem | undefined {
    // 没有结构缓存时（例如只按 refs 要图）也照样登记清单，文件本身已经落盘
    const field = item.field;
    const target = this.payload
      ? item.nodeId
        ? findNode(this.payload, { id: item.nodeId })
        : null
      : null;

    if (target) {
      const bin: AssetBinary = {
        kind: item.kind,
        ref: item.ref,
        mimeType: item.mimeType,
        byteLength: item.byteLength,
        path: item.path,
        width: item.width,
        height: item.height,
      };
      target[field] = bin;
      if (field === 'slice') {
        const svg = item.svg || readInlineSvg(bin);
        if (svg) target.svg = svg;
      }
    }

    const key = item.key || assetKey({ ref: item.ref, nodeId: item.nodeId, field });
    const deduped = this.assets.filter(
      (existing) =>
        existing.path !== item.path && !(key && existing.key === key)
    );
    deduped.push({
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      field: item.field,
      key,
      kind: item.kind,
      path: item.path,
      mimeType: item.mimeType,
      byteLength: item.byteLength,
      width: item.width,
      height: item.height,
      ref: item.ref,
    });
    this.assets = deduped;
    this.persist();
    return this.assets[this.assets.length - 1];
  }

  /**
   * 检查某个 key（图片 hash 或节点 id）是否已经落盘且文件仍在，命中则零代价复用。
   * 注意：只适合按内容 hash 复用（图片 ref）。节点 id 相同不代表像素相同，切图不要用它跳过导出。
   */
  findAssetByKey(key: string): AssetManifestItem | undefined {
    const hit = this.assets.find(
      (item) => item.key === key || item.ref === key
    );
    if (!hit) return undefined;
    try {
      return fs.existsSync(hit.path) ? hit : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 清理过期切图：assetsDir 里超过 maxAgeMs 未改动的文件直接删，
   * 索引与 payload 里指向已删文件的 path 一并摘掉，不留悬空引用。
   * maxAgeMs <= 0 或非有限值时跳过，便于按需关掉。
   */
  pruneAssets(maxAgeMs: number = DEFAULT_ASSET_MAX_AGE_MS): PruneReport {
    const report: PruneReport = {
      removedFiles: 0,
      removedBytes: 0,
      removedEntries: 0,
      clearedPaths: 0,
    };
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return report;

    const cutoff = Date.now() - maxAgeMs;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.assetsDir, { withFileTypes: true });
    } catch {
      return report;
    }

    for (const entry of entries) {
      // 只碰普通文件：不动子目录，也不动 .DS_Store 这类隐藏文件
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const filePath = path.join(this.assetsDir, entry.name);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs >= cutoff) continue;
        fs.rmSync(filePath);
        report.removedFiles += 1;
        report.removedBytes += stat.size;
      } catch {
        // 并发删除或权限问题：跳过这一个，不打断整轮清理
      }
    }

    const kept = this.assets.filter((item) => fileExists(item.path));
    report.removedEntries = this.assets.length - kept.length;
    this.assets = kept;

    report.clearedPaths = this.clearDanglingPaths(this.payload?.root);

    if (report.removedFiles || report.removedEntries || report.clearedPaths) {
      this.persist();
    }
    return report;
  }

  /**
   * 节点上 image/slice/preview 的 path 若已不在磁盘，只摘掉 path，
   * 保留 ref / mimeType / 尺寸——ref 还能让 export_assets 重新取回同一张图。
   */
  private clearDanglingPaths(node: DesignNode | undefined): number {
    if (!node) return 0;
    let cleared = 0;
    for (const field of BINARY_FIELDS) {
      const bin = node[field] as AssetBinary | undefined;
      if (bin && typeof bin === 'object' && bin.path && !fileExists(bin.path)) {
        delete bin.path;
        cleared += 1;
      }
    }
    for (const child of node.children || []) {
      cleared += this.clearDanglingPaths(child);
    }
    return cleared;
  }

  private persist(): void {
    if (this.payload) {
      this.payload.meta = {
        ...this.payload.meta,
        assetsDir: this.assetsDir,
        assets: this.assets,
      };
    }
    try {
      if (this.payload) {
        fs.writeFileSync(
          this.filePath,
          JSON.stringify(this.payload, null, 2),
          'utf8'
        );
      }
      fs.writeFileSync(
        this.assetsManifestPath,
        JSON.stringify({ assetsDir: this.assetsDir, assets: this.assets }, null, 2),
        'utf8'
      );
    } catch {
      // 落盘失败不阻塞调用方，内存态仍然可用
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (isDesignPayload(raw)) {
        this.payload = raw;
        this.assets = Array.isArray(raw.meta.assets) ? raw.meta.assets : [];
      }
    } catch {
      // ignore corrupt cache
    }

    if (this.assets.length === 0 && fs.existsSync(this.assetsManifestPath)) {
      try {
        const manifest = JSON.parse(
          fs.readFileSync(this.assetsManifestPath, 'utf8')
        ) as { assets?: AssetManifestItem[] };
        if (Array.isArray(manifest.assets)) this.assets = manifest.assets;
      } catch {
        // ignore
      }
    }
  }
}
