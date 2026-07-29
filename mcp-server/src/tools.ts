import type { DesignPayload } from './types.js';
import {
  buildOverview,
  findNode,
  flattenTokens,
  listNodes,
} from './query.js';

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const NO_DATA =
  '暂无设计数据。请先在即时设计插件中发送选中：选中 Frame 后打开本插件并点击「发送选中到 Cursor」。';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'get_selection_overview',
    description:
      '获取最近一次从即时设计推送的选中设计概览：meta、tokens、节点树摘要。开始还原页面前先调用。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_node',
    description:
      '按 id 或 name（支持部分匹配、忽略大小写）获取节点完整样式与子树。',
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
    description: '获取颜色、字号、字体、圆角、间距等设计 token 列表。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_nodes',
    description: '扁平列出所有节点的 id/name/type，便于定位。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

export function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  payload: DesignPayload | null
) {
  if (!payload) return textResult(NO_DATA);

  switch (name) {
    case 'get_selection_overview':
      return textResult(JSON.stringify(buildOverview(payload), null, 2));
    case 'get_design_tokens':
      return textResult(JSON.stringify(flattenTokens(payload), null, 2));
    case 'list_nodes':
      return textResult(JSON.stringify(listNodes(payload), null, 2));
    case 'get_node': {
      const id = typeof args.id === 'string' ? args.id : undefined;
      const nodeName = typeof args.name === 'string' ? args.name : undefined;
      if (!id && !nodeName) {
        return textResult('请提供 id 或 name 参数。');
      }
      const node = findNode(payload, { id, name: nodeName });
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
