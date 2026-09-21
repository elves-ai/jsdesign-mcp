import type { AssetManifestItem, DesignPayload } from './types.js';
import type { DesignStore } from './store.js';
import type { PluginBridge } from './bridge.js';
import {
  buildOverview,
  findNode,
  flattenTokens,
  listNodes,
} from './query.js';
import { parseJsDesignUrl } from './url.js';

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolContext = {
  store: DesignStore;
  bridge: PluginBridge;
};

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'get_node_by_url',
    description:
      '从用户粘贴的即时设计链接拉取节点设计数据。链接需含 linkelement（如 https://js.design/f/xxx?p=yyy&linkelement=82-2142）。要求即时设计插件已点击「连接」。也可直接传节点 id（82:2142 或 82-2142）。',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            '即时设计链接或节点 id。例：https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_plugin_status',
    description: '查看即时设计插件是否已连接到本地 bridge。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_selection_overview',
    description:
      '获取最近一次成功拉取的设计概览（meta、tokens、树摘要）。通常在 get_node_by_url 之后调用。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_node',
    description:
      '在最近一次拉取的数据中，按 id 或 name 查找节点（不访问插件）。需要新节点请用 get_node_by_url。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '节点 ID' },
        name: { type: 'string', description: '节点名称（部分匹配）' },
      },
    },
  },
  {
    name: 'get_design_tokens',
    description: '获取最近一次拉取数据中的设计 token 列表。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_nodes',
    description: '扁平列出最近一次拉取数据中的节点 id/name/type。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_assets',
    description:
      '列出已落盘的图片/切图（本机绝对路径）。get_node_by_url 只拉结构不带字节，资产要靠 export_assets 按需导出后才会出现在这里。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'export_assets',
    description:
      '按需切图：把设计里的图片/切图导出成本机文件并返回路径。ids 传节点 id（82:2142 或 82-2142），refs 传图片哈希（节点的 image.ref）。字节由插件经 jsDesign.fetch 直传 bridge 落盘，不经过 base64；落盘后对应节点会带上 path，SVG 切图另带 svg 源码。单次最多 20 项，超出的会提示再调一次。',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: '节点 id 列表，例如 ["82:2142"]',
        },
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: '图片 hash 列表（节点上的 image.ref）',
        },
      },
      required: [],
    },
  },
];

function needCache(payload: DesignPayload | null) {
  if (payload) return null;
  return textResult(
    '暂无缓存设计数据。请先让用户粘贴含 linkelement 的即时设计链接，并调用 get_node_by_url（插件需已连接）。'
  );
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
) {
  const payload = ctx.store.get();

  switch (name) {
    case 'get_plugin_status':
      return textResult(
        JSON.stringify(
          {
            pluginConnected: ctx.bridge.pluginConnected,
            connectionCount: ctx.bridge.connectionCount,
            hasCachedData: payload !== null,
            cachedRoot: payload?.root.name ?? null,
          },
          null,
          2
        )
      );

    case 'get_node_by_url': {
      const url = typeof args.url === 'string' ? args.url : '';
      const parsed = parseJsDesignUrl(url);
      if (!parsed) {
        return textResult(
          '无法解析链接。请提供含 linkelement 的即时设计 URL，例如：https://js.design/f/xxx?p=yyy&mode=design&linkelement=82-2142'
        );
      }
      try {
        const result = await ctx.bridge.fetchNode(parsed.nodeId, {
          fileKey: parsed.fileKey,
          pageId: parsed.pageId,
          url: parsed.url,
        });
        // Enrich meta from URL
        result.meta = {
          ...result.meta,
          fileName: result.meta.fileName || parsed.fileKey,
        };
        ctx.store.set(result);
        const stored = ctx.store.get()!;
        return textResult(
          JSON.stringify(
            {
              link: parsed,
              overview: buildOverview(stored),
              assets: {
                dir: ctx.store.getAssetsDir(),
                count: ctx.store.getAssets().length,
                items: ctx.store.getAssets(),
              },
              root: stored.root,
            },
            null,
            2
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(message);
      }
    }

    case 'export_assets': {
      const ids = Array.isArray(args.ids) ? args.ids.map((v) => String(v)) : [];
      const refs = Array.isArray(args.refs) ? args.refs.map((v) => String(v)) : [];
      if (ids.length === 0 && refs.length === 0) {
        return textResult(
          '请提供 ids（节点 id）或 refs（图片 hash）至少其一。节点 id 可用 list_nodes / get_node 获取，图片 hash 是节点上的 image.ref。'
        );
      }

      // 图片按 ref（内容 hash）命中磁盘就不再往返；切图按节点 id 可能是旧像素，一律重导
      const cached: AssetManifestItem[] = [];
      const missingRefs: string[] = [];
      for (const ref of refs) {
        const hit = ctx.store.findAssetByKey(ref);
        if (hit) cached.push(hit);
        else missingRefs.push(ref);
      }

      if (ids.length === 0 && missingRefs.length === 0) {
        return textResult(
          JSON.stringify(
            {
              assetsDir: ctx.store.getAssetsDir(),
              count: cached.length,
              assets: cached,
              cached: true,
            },
            null,
            2
          )
        );
      }

      try {
        const fetched = await ctx.bridge.fetchAssets({
          nodeIds: ids,
          refs: missingRefs,
        });
        const items = [...cached, ...fetched];
        return textResult(
          JSON.stringify(
            {
              assetsDir: ctx.store.getAssetsDir(),
              count: items.length,
              assets: items,
              cached: false,
            },
            null,
            2
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(message);
      }
    }

    case 'get_selection_overview': {
      const miss = needCache(payload);
      if (miss) return miss;
      return textResult(JSON.stringify(buildOverview(payload!), null, 2));
    }

    case 'get_design_tokens': {
      const miss = needCache(payload);
      if (miss) return miss;
      return textResult(JSON.stringify(flattenTokens(payload!), null, 2));
    }

    case 'list_nodes': {
      const miss = needCache(payload);
      if (miss) return miss;
      return textResult(JSON.stringify(listNodes(payload!), null, 2));
    }

    case 'list_assets': {
      const miss = needCache(payload);
      if (miss) return miss;
      return textResult(
        JSON.stringify(
          {
            assetsDir: ctx.store.getAssetsDir(),
            count: ctx.store.getAssets().length,
            assets: ctx.store.getAssets(),
          },
          null,
          2
        )
      );
    }

    case 'get_node': {
      const miss = needCache(payload);
      if (miss) return miss;
      const id = typeof args.id === 'string' ? args.id : undefined;
      const nodeName = typeof args.name === 'string' ? args.name : undefined;
      if (!id && !nodeName) {
        return textResult('请提供 id 或 name 参数。');
      }
      const node = findNode(payload!, { id, name: nodeName });
      if (!node) {
        return textResult(
          `未找到节点：id=${id ?? ''} name=${nodeName ?? ''}`
        );
      }
      return textResult(JSON.stringify(node, null, 2));
    }

    default:
      return textResult(`未知工具：${name}`);
  }
}
