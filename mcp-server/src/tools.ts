import type { DesignPayload } from './types.js';
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
    description: '查看即时设计插件是否已连接到本地 MCP。',
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
        return textResult(
          JSON.stringify(
            {
              link: parsed,
              overview: buildOverview(result),
              root: result.root,
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
