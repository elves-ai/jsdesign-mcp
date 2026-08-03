import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AssetBinary,
  AssetManifestItem,
  DesignNode,
  DesignPayload,
} from './types.js';

const BINARY_FIELDS = ['image', 'slice', 'preview'] as const;

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
  const ext = extForMime(mimeType);
  const key = bin.ref || `${node.id}:${field}`;
  const fileName = `${sanitizeName(node.name)}-${shortId(key)}${ext}`;
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
