import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AssetBinary,
  AssetManifestItem,
  AssetWriteMeta,
  DesignNode,
  DesignPayload,
} from './types.js';

export const BINARY_FIELDS = ['image', 'slice', 'preview'] as const;

function extForMime(mimeType?: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    case 'image/png':
    default:
      return '.png';
  }
}

function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || 'asset';
}

function shortId(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 10);
}

/** 落盘文件名：<节点名>-<key 摘要><扩展名>，mimeType 决定扩展名 */
export function assetFileName(
  nodeName: string | undefined,
  key: string,
  mimeType?: string
): string {
  return `${sanitizeName(nodeName || 'asset')}-${shortId(key)}${extForMime(mimeType)}`;
}

/** SVG 小于此值时把源码回填到节点的 svg 字段 */
export const MAX_INLINE_SVG_BYTES = 256 * 1024;

/**
 * 从落盘的 .svg 读回源码，用于回填节点的 svg 字段。
 * 插件直传路径只传字节，源码统一由文件读回，两个进程（bridge / MCP）行为一致。
 */
export function readInlineSvg(item: {
  path?: string;
  mimeType?: string;
}): string | undefined {
  if (item.mimeType !== 'image/svg+xml' || !item.path) return undefined;
  try {
    if (fs.statSync(item.path).size > MAX_INLINE_SVG_BYTES) return undefined;
    return fs.readFileSync(item.path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * 去重键：图片填充用 ref（hash），切图用节点 id，其余退回 nodeId:field。
 * 两条落盘路径（插件直传 / payload 兜底重建）必须用同一规则，否则重建成清单后 key 会漂移。
 */
export function assetKey(input: {
  ref?: string;
  nodeId?: string;
  field: AssetManifestItem['field'];
}): string | undefined {
  if (input.ref) return input.ref;
  if (!input.nodeId) return undefined;
  return input.field === 'slice' ? input.nodeId : `${input.nodeId}:${input.field}`;
}

function defaultKindFor(field: AssetManifestItem['field']): AssetBinary['kind'] {
  if (field === 'preview') return 'preview';
  if (field === 'image') return 'image_fill';
  return 'icon_slice';
}

function buildItem(
  meta: AssetWriteMeta,
  filePath: string,
  byteLength: number,
  mimeType: string
): AssetManifestItem {  return {
    nodeId: meta.nodeId,
    nodeName: meta.nodeName,
    field: meta.field,
    key: meta.key,
    kind: meta.kind || defaultKindFor(meta.field),
    path: filePath,
    mimeType,
    byteLength,
    width: meta.width,
    height: meta.height,
    ref: meta.ref,
  };
}

/**
 * 把原始字节写到 assetsDir。插件直传（/plugin/asset-bin）走这里，
 * 一路从 socket 到磁盘，不经过 base64 与 JSON。
 */
export function writeAssetBytes(
  meta: AssetWriteMeta,
  bytes: Buffer,
  assetsDir: string
): AssetManifestItem | undefined {
  if (!bytes.length) return undefined;
  const mimeType = meta.mimeType || 'image/png';
  const key = meta.key || meta.ref || meta.nodeId || `${meta.field}:${Date.now()}`;
  try {
    fs.mkdirSync(assetsDir, { recursive: true });
    const filePath = path.join(assetsDir, assetFileName(meta.nodeName, key, mimeType));
    fs.writeFileSync(filePath, bytes);
    return buildItem(meta, filePath, bytes.length, mimeType);
  } catch {
    return undefined;
  }
}

/** base64 兜底路径（宿主无 jsDesign.fetch 或直传失败时用） */
export function writeAssetFromBase64(
  meta: AssetWriteMeta & { data?: string },
  assetsDir: string
): AssetManifestItem | undefined {
  if (!meta.data || typeof meta.data !== 'string') return undefined;
  try {
    return writeAssetBytes(meta, Buffer.from(meta.data, 'base64'), assetsDir);
  } catch {
    return undefined;
  }
}

function materializeField(
  node: DesignNode,
  field: (typeof BINARY_FIELDS)[number],
  assetsDir: string,
  assets: AssetManifestItem[]
): void {
  const bin = node[field] as AssetBinary | undefined;
  if (!bin || typeof bin !== 'object') return;

  if (bin.path && fs.existsSync(bin.path) && !bin.data) {
    assets.push({
      nodeId: node.id,
      nodeName: node.name,
      field,
      key: assetKey({ ref: bin.ref, nodeId: node.id, field }),
      kind: bin.kind,
      path: bin.path,
      mimeType: bin.mimeType,
      byteLength: bin.byteLength,
      width: bin.width,
      height: bin.height,
      ref: bin.ref,
    });
    return;
  }

  if (!bin.data || typeof bin.data !== 'string') {
    delete bin.data;
    delete bin.dataUri;
    return;
  }

  const mimeType = bin.mimeType || 'image/png';
  const key = assetKey({ ref: bin.ref, nodeId: node.id, field }) || `${node.id}:${field}`;
  const fileName = assetFileName(node.name, key, mimeType);
  const filePath = path.join(assetsDir, fileName);

  try {
    const bytes = Buffer.from(bin.data, 'base64');
    fs.writeFileSync(filePath, bytes);
    bin.path = filePath;
    bin.byteLength = bytes.length;
    bin.mimeType = mimeType;
    if (!bin.kind) {
      bin.kind =
        field === 'preview'
          ? 'preview'
          : field === 'slice'
            ? 'icon_slice'
            : 'image_fill';
    }
    delete bin.data;
    delete bin.dataUri;

    assets.push({
      nodeId: node.id,
      nodeName: node.name,
      field,
      key,
      kind: bin.kind,
      path: filePath,
      mimeType: bin.mimeType,
      byteLength: bin.byteLength,
      width: bin.width,
      height: bin.height,
      ref: bin.ref,
    });
  } catch {
    delete bin.data;
    delete bin.dataUri;
  }
}

function walkMaterialize(
  node: DesignNode,
  assetsDir: string,
  assets: AssetManifestItem[]
): void {
  for (const field of BINARY_FIELDS) {
    materializeField(node, field, assetsDir, assets);
  }
  for (const child of node.children || []) {
    walkMaterialize(child, assetsDir, assets);
  }
}

/**
 * 将 payload 中的 base64 图片落盘到 assetsDir，节点上只保留 path 引用。
 */
export function materializePayloadAssets(
  payload: DesignPayload,
  assetsDir: string
): { payload: DesignPayload; assets: AssetManifestItem[] } {
  fs.mkdirSync(assetsDir, { recursive: true });
  const assets: AssetManifestItem[] = [];
  walkMaterialize(payload.root, assetsDir, assets);

  payload.meta = {
    ...payload.meta,
    assetsDir,
    assets,
  };

  return { payload, assets };
}
