# JsDesign → Cursor MCP

从[即时设计](https://js.design)按**设计链接**拉取精确节点数据，经本机 MCP 提供给 Cursor 做 design-to-code。AI 基于结构化样式（坐标、布局、色值、字号、切图路径）改当前项目，而不是靠截图猜。

当前版本：`0.3.0`（MCP 进程名 `jsdesign-mcp`）。

## 工作方式

插件 UI 环境里 WebSocket 常被拦，因此插件与 MCP 之间用 **HTTP 长轮询**，不是 WebSocket。

```
即时设计桌面端插件               本机 HTTP bridge (:3847)              Cursor
┌──────────────────────┐  HTTP   ┌─────────────────────────┐  stdio  ┌────────┐
│ 连接 / 断开           │────────►│ POST /plugin/connect    │◄───────►│ Agent  │
│ 长轮询等 fetch 任务   │◄────────│ GET  /plugin/wait       │         │ 贴链接 │
│ getNodeById + 规范化  │────────►│ POST /plugin/result     │         │        │
│ 选中图层 JSON 预览    │        │ GET  /health            │         │        │
└──────────────────────┘        │ get_node_by_url         │         └────────┘
                                 └─────────────────────────┘
```

1. Cursor 启动 `jsdesign` MCP（会尽量自动拉起 bridge）
2. 即时设计桌面端打开本插件 → 点 **连接**（状态点变绿）
3. 复制带 `linkelement` 的链接发给 AI，例如：  
   `https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142`
4. AI 调用 `get_node_by_url` → MCP 经长轮询让插件 `getNodeById('82:2142')` → 返回结构 / 样式 / tokens / 切图路径

也可直接传节点 id：`82:2142` 或 `82-2142`。链接里的 `node-id` / `nodeId` 同样可解析。

## 仓库结构

| 路径 | 职责 |
|------|------|
| `plugin/` | 即时设计本地插件：连接 bridge、按 id 导出节点、选中预览 |
| `mcp-server/` | Node MCP（stdio）+ HTTP bridge（仅绑定 `127.0.0.1`） |
| `docs/` | 早期设计稿与实现计划（部分描述已过时，以本 README 与源码为准） |

`mcp-server/src` 主要模块：

| 文件 | 职责 |
|------|------|
| `index.ts` | MCP stdio 入口；探测 / 内嵌 / 拉起独立 bridge |
| `bridge-main.ts` | 独立 bridge 进程（`npm run bridge`） |
| `server.ts` / `http.ts` | Express：`/health`、插件长轮询、内部 fetch |
| `bridge.ts` | 会话、任务队列、60s 拉取超时 |
| `tools.ts` | 7 个 MCP 工具 |
| `url.ts` | 解析 js.design 链接 / 裸节点 id |
| `store.ts` | 内存 + `~/.jsdesign-mcp/` 落盘 |
| `assets.ts` | 把插件回传的 base64 切图写成文件 |
| `query.ts` | 缓存上的 overview / find / list / tokens |
| `types.ts` | `DesignPayload` / `DesignNode` |

## 1. 启动本地 bridge

插件用 HTTP 连 `127.0.0.1:3847`。先保证 bridge 在跑：

```bash
cd ~/mywork/jsdesign-mcp/mcp-server
npm install --registry https://registry.npmjs.org/
npm run build
npm run bridge
```

探活：`curl -s http://127.0.0.1:3847/health` 应返回 `"ok":true`。已连接插件时还会有 `"pluginConnected":true`。

Cursor 打开 `jsdesign` MCP 时会按顺序尝试：

1. 复用已在跑的 `:3847`
2. 在 MCP 进程内嵌启动 bridge
3. 拉起独立 `bridge-main` 进程

不可靠时请手动 `npm run bridge`。端口可用环境变量覆盖：`JSDESIGN_MCP_PORT=3847`。

## 2. Cursor MCP 配置

`~/.cursor/mcp.json`：

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

改代码后 `npm run build`，再在 Cursor MCP 面板重启 `jsdesign`。路径按本机仓库位置改。

## 3. 导入即时设计插件（桌面端）

1. 安装 [桌面客户端](https://js.design/download)
2. **插件 → 开发者 → 导入插件**
3. 选择 `plugin/manifest.json`（或整个 `plugin/` 目录）
4. 运行插件 → 点 **连接**（状态点变绿）
5. 保持插件窗口打开；断开或关掉窗口后 MCP 无法拉节点

插件面板还可展开，预览当前选中图层的规范化 JSON（不含 base64），便于核对导出结果。

## 4. MCP 工具

| Tool | 说明 |
|------|------|
| `get_node_by_url` | **主工具**：解析链接 / `linkelement` / 裸 id，向已连接插件拉节点（含自动切图） |
| `get_plugin_status` | 插件是否已连接、缓存里有没有数据 |
| `list_assets` | 列出本次落盘的图片 / 切图（本机绝对路径） |
| `get_selection_overview` | 最近一次拉取的概览（meta、tokens、树摘要，深度 3） |
| `get_node` | 在缓存里按 id 或 name（部分匹配）查节点，不访问插件 |
| `list_nodes` | 扁平列出缓存节点的 id / name / type |
| `get_design_tokens` | 最近一次拉取的颜色 / 字号 / 字体 / 圆角 / 间距 |

`get_node_by_url` 成功后写入缓存。其它查询工具读的是这次缓存，要换节点就再调一次主工具。

## 5. 自动切图与资源

`get_node_by_url` 时插件会导出：

1. **IMAGE 填充** → 节点 `image`（真实图片字节）
2. **图标类切图**（`icon_slice`：8–256px 的 FRAME/GROUP/COMPONENT/INSTANCE，无文字，名称含 icon/图标 或子树含矢量）→ 节点 `slice`（**优先 SVG**，失败回退 PNG），并附 `svg` 源码
3. **带 exportSettings 的图层** → 节点 `slice`；小尺寸矢量同样优先 SVG
4. **矢量节点**（VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE / ELLIPSE）→ 节点 `svg`
5. **根节点 preview** → `root.preview`（PNG）

父级已切图则子容器不再重复切。子树超过 **2000** 个节点会截断，`meta.truncated: true`。

MCP 收到后写入 `~/.jsdesign-mcp/assets/`（`.svg` / `.png` 等），节点上只保留 `path`（去掉 base64）。同时落盘：

| 文件 | 内容 |
|------|------|
| `~/.jsdesign-mcp/latest.json` | 最近一次 `DesignPayload` |
| `~/.jsdesign-mcp/assets.json` | 切图清单 |
| `~/.jsdesign-mcp/assets/` | 实际文件 |

用 `list_assets` 查看清单，再复制到项目的 `public` / `assets` 后引用。

## 6. 节点数据（摘要）

每个 `DesignNode` 尽量对齐即时设计 Plugin API，常见字段：

- 几何：`box`（相对父级 x/y/w/h）、`rotation`、`opacity`、`constraints`
- 布局：`layout.mode/gap/padding/align/justify`、`layoutAlign`、`layoutGrow`、`clipsContent`
- 外观：`fills`（SOLID / IMAGE / 渐变）、`strokes`、`dashPattern`、`cornerRadius`、`effects`（阴影 / 模糊）
- 文本：`text.characters`、字号 / 字体 / 字重 / 行高 / 字距 / 对齐 / 颜色（实例内会回退 `getRangeFills` / 主组件）
- 组件：`component.componentId/Name`、`variantProperties`
- 资源：`image` / `slice` / `preview` / `svg`

坐标单位为 px，颜色为 `#rrggbb`。

## 开发

```bash
cd mcp-server
npm install --registry https://registry.npmjs.org/
npm test
npm run build
```

脚本：

| 命令 | 作用 |
|------|------|
| `npm run build` | `tsc` 输出到 `dist/` |
| `npm start` | 跑 MCP stdio（通常由 Cursor 拉起） |
| `npm run bridge` | 只跑 HTTP bridge，不占 stdio |
| `npm test` | 编译后跑 Node 内置 test runner |
| `npm run dev` / `dev:bridge` | 先编译再启动 |

需要 Node 20+。单测覆盖 store / query / url / http / tools / assets。

## 故障排查

| 现象 | 处理 |
|------|------|
| 插件「连接失败：本机 3847 无服务」 | 先 `npm run bridge`，或确认 Cursor MCP `jsdesign` 已连接 |
| `get_node_by_url` 提示未连接 | 插件点「连接」，保持窗口打开 |
| 拉取超时（60s） | 确认插件仍连接、当前文件里有该节点 |
| 无法解析链接 | 必须带 `linkelement`（或 `node-id` / `nodeId`），或直接传 `82:2142` |
| 找不到节点 | 链接必须来自**当前打开的文件** |
| `meta.truncated: true` | 子树超过 2000 节点，换更小的 Frame 再拉 |
| 改插件不生效 | 关掉插件再开，或重新导入 |
| 改 MCP 不生效 | `npm run build` 后重启 Cursor 里的 `jsdesign` |

## License

MIT
