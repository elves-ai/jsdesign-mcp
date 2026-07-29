# 即时设计 → MCP Design-to-Code 桥接

**日期：** 2026-07-29  
**项目路径：** `~/mywork/jsdesign-mcp`  
**状态：** 设计已确认，待实现

## 背景与目标

即时设计没有现成的 Figma 级 MCP。本项目用**官方插件 API**读取选中 Frame 的精确设计数据，经本地 MCP Server 暴露给 Cursor，用于 design-to-code：AI 基于结构化数值改当前打开的项目，而不是靠截图猜测。

## 范围

### In scope（MVP）

- 即时设计本地插件：读取当前选中，导出规范化节点树与样式
- 本机 MCP Server（stdio + 本机 HTTP ingest）
- Cursor 通过 MCP tools 查询最近一次推送的设计数据
- 输出与前端框架无关；具体写 Vue/React 由 Cursor 按当前项目决定

### Out of scope（MVP）

- Chrome/浏览器扩展抓取页面
- 云端同步、多用户、商店上架
- 像素级复杂特效（复杂阴影/模糊/blend）完整建模
- MCP 自动写入业务仓库文件（只提供数据）

## 架构

```
即时设计编辑器                    本机                         Cursor
┌─────────────────┐          ┌──────────────────┐          ┌────────────┐
│ 官方插件 plugin/ │──HTTP──►│ MCP Server        │◄──stdio──│ AI Agent   │
│ 读选中 Frame     │ 127.0.0.1│ · 缓存最新设计 JSON│   MCP    │ 按当前项目改│
│ 规范化节点树     │  :3847   │ · 暴露查询 tools  │          │            │
└─────────────────┘          └──────────────────┘          └────────────┘
```

### 仓库结构

| 路径 | 职责 |
|------|------|
| `plugin/` | 即时设计本地插件（manifest + UI + 导出逻辑） |
| `mcp-server/` | Node MCP Server（HTTP ingest + stdio MCP tools） |
| `docs/` | 设计与使用说明 |

## 组件设计

### 1. 插件（`plugin/`）

- 入口：侧栏「发送选中到 Cursor」
- 选中规则：优先 Frame；多选时取第一个 Frame，否则取根选中节点及其子树
- 将节点规范化后 `POST http://127.0.0.1:3847/ingest`（端口可在 UI 配置）
- UI 状态：成功 / 未选中 / Server 未启动
- 子节点数超过 2000 时截断，并标记 `truncated: true`

### 2. MCP Server（`mcp-server/`）

- HTTP（仅 `127.0.0.1`）：
  - `POST /ingest` — 接收插件推送的 JSON
  - `GET /health` — 探活
- 缓存：内存保存最近一次成功 ingest；可选落盘 `~/.jsdesign-mcp/latest.json`
- MCP 通过 stdio 暴露给 Cursor；进程同时监听 HTTP

### 3. MCP Tools

| Tool | 说明 |
|------|------|
| `get_selection_overview` | 树概览 + tokens |
| `get_node` | 按 `id` 或 `name` 取节点（可含子树） |
| `get_design_tokens` | 颜色 / 字体 / 间距 / 圆角去重列表 |
| `list_nodes` | 扁平列表（id / name / type）便于定位 |

未 ingest 时，工具返回明确可读错误：请先在即时设计插件中发送选中。

## 数据模型

```ts
type DesignPayload = {
  meta: {
    fileName?: string
    pageName?: string
    exportedAt: string
    truncated?: boolean
  }
  tokens: {
    colors: string[]
    fontSizes: number[]
    fontFamilies: string[]
    radii: number[]
    spacings: number[]
  }
  root: DesignNode
}

type DesignNode = {
  id: string
  name: string
  type: string
  box: { x: number; y: number; w: number; h: number } // 相对父级坐标，单位 px
  layout?: {
    mode?: string
    gap?: number
    padding?: { top: number; right: number; bottom: number; left: number }
    align?: string
    justify?: string
  }
  fills?: unknown[]
  strokes?: unknown[]
  cornerRadius?: number | number[]
  opacity?: number
  text?: {
    characters: string
    fontSize?: number
    fontFamily?: string
    fontWeight?: number | string
    lineHeight?: number | string
    color?: string
  }
  image?: { ref?: string }
  children: DesignNode[]
}
```

MVP 成功标准：稳定拿到节点树、布局（xywh / flex 相关）、颜色/字号/圆角/间距、文案；图片用引用或占位即可。

## 错误处理

| 场景 | 行为 |
|------|------|
| 插件无选中 | 提示先选 Frame/节点，不发请求 |
| Server 未启动 | 插件提示启动 MCP |
| 非法 ingest body | HTTP 400 |
| 尚未 ingest | MCP tools 返回引导文案 |
| 节点过多 | 截断 + `truncated: true` |

## Cursor 配置约定

```json
{
  "mcpServers": {
    "jsdesign": {
      "command": "node",
      "args": ["/Users/lingyun/mywork/jsdesign-mcp/mcp-server/dist/index.js"]
    }
  }
}
```

## 验证计划

1. 启动 MCP Server，`GET /health` 正常
2. 在即时设计选中简单 Frame → 插件发送成功
3. Cursor 调用 `get_selection_overview` 可见树与颜色
4. `get_node` 能按名称取到文案与字号
5. 未发送 / Server 关闭时错误信息可读

## 实现备注

- 优先使用即时设计官方 Plugin API（`@jsdesigndeveloper/plugin-typings`），不采用浏览器扩展注入
- 参考社区形态（如 zhucue/jsdesign-mcp），但本仓库自建、按上述 MVP 裁剪，不直接绑定 Claude Desktop 专用流程
- 技术栈：TypeScript + Node；插件侧按即时设计本地插件规范组织
