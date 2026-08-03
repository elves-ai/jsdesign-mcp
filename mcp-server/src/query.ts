import type { DesignNode, DesignPayload, DesignTokens } from './types.js';

export type NodeSummary = {
  id: string;
  name: string;
  type: string;
  childCount: number;
  children?: NodeSummary[];
};

export type Overview = {
  meta: DesignPayload['meta'];
  tokens: DesignTokens;
  root: NodeSummary;
  /** 本次落盘切图数量；完整清单用 list_assets */
  assetCount?: number;
};

function summarize(node: DesignNode, depth = 0, maxDepth = 3): NodeSummary {
  const summary: NodeSummary = {
    id: node.id,
    name: node.name,
    type: node.type,
    childCount: node.children.length,
  };
  if (depth < maxDepth && node.children.length > 0) {
    summary.children = node.children.map((c) =>
      summarize(c, depth + 1, maxDepth)
    );
  }
  return summary;
}

export function buildOverview(payload: DesignPayload): Overview {
  const { assets: _assets, ...metaRest } = payload.meta;
  return {
    meta: metaRest,
    tokens: payload.tokens,
    root: summarize(payload.root),
    assetCount: Array.isArray(payload.meta.assets)
      ? payload.meta.assets.length
      : 0,
  };
}

export function findNode(
  payload: DesignPayload,
  opts: { id?: string; name?: string }
): DesignNode | null {
  const needleName = opts.name?.toLowerCase();

  function walk(node: DesignNode): DesignNode | null {
    if (opts.id && node.id === opts.id) return node;
    if (needleName && node.name.toLowerCase().includes(needleName)) return node;
    for (const child of node.children) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  }

  return walk(payload.root);
}

export function listNodes(
  payload: DesignPayload
): Array<{ id: string; name: string; type: string }> {
  const out: Array<{ id: string; name: string; type: string }> = [];
  function walk(node: DesignNode): void {
    out.push({ id: node.id, name: node.name, type: node.type });
    for (const child of node.children) walk(child);
  }
  walk(payload.root);
  return out;
}

export function flattenTokens(payload: DesignPayload): DesignTokens {
  return payload.tokens;
}
