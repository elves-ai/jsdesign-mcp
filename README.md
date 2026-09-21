# JsDesign → Cursor MCP

从[即时设计](https://js.design)按**设计链接**拉取精确节点数据，经本机 MCP 提供给 Cursor 做 design-to-code。AI 基于结构化样式（坐标、布局、色值、字号）改当前项目，需要图片/图标时再按需切图，而不是靠截图猜。

当前版本：`0.3.0`（MCP 进程名 `jsdesign-mcp`）。

## 工作方式

插件 UI 环境里 WebSocket 常被拦，因此插件与 **独立 HTTP bridge** 用长轮询通信。Cursor 的 MCP 只走 stdio，**不监听端口**，需要数据时再 HTTP 去 bridge 取。

```
即时设计桌面端插件               本机 HTTP bridge (:3847)              Cursor MCP
┌──────────────────────┐  HTTP   ┌──────────────────────────┐  HTTP   ┌────────┐
│ 连接 / 断开           │────────►│ POST /plugin/connect     │◄────────│ stdio  │
│ 长轮询等任务          │◄────────│ GET  /plugin/wait        │         │ Agent  │
│ getNodeById + 规范化  │────────►│ POST /plugin/result      │         │ 贴链接 │
│ 选中图层 JSON 预览    │        │ POST /internal/fetch-node│         └────────┘
│ 切图字节直传 (fetch)  │────────►│ POST /plugin/asset-bin   │
└──────────────────────┘        │ POST /internal/export-assets│
                                 │ GET  /health             │
                                 └──────────────────────────┘
```

1. 独立进程 `npm run bridge`（开发用 `npm start`）监听 `:3847`；Cursor **不会**代启
2. 即时设计桌面端打开本插件 → 点 **连接**（连的是 bridge，不是 MCP）
3. 复制带 `linkelement` 的链接发给 AI，例如：  
   `https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142`
4. AI 调用 `get_node_by_url` → MCP 向 bridge 要节点 → bridge 经长轮询让插件 `getNodeById` → 回传结构 / 样式 / tokens（**不带任何图片字节**）
5. 需要图片或切图时 AI 再调 `export_assets`，只导出点名的那些节点

关 Cursor 时 MCP 随 stdio 退出。bridge 在插件已断开且约 5 分钟无访问后自行退出（`JSDESIGN_MCP_BRIDGE_IDLE_MS=0` 可关掉空闲退出）。

也可直接传节点 id：`82:2142` 或 `82-2142`。链接里的 `node-id` / `nodeId` 同样可解析。

## 仓库结构

| 路径 | 职责 |
|------|------|
| `plugin/` | 即时设计本地插件：连接 bridge、按 id 导出节点、选中预览 |
| `mcp-server/` | MCP stdio 客户端 + 独立 HTTP bridge（仅绑定 `127.0.0.1`） |
| `docs/` | 早期设计稿与实现计划（部分描述已过时，以本 README 与源码为准） |

`mcp-server/src` 主要模块：

| 文件 | 职责 |
|------|------|
| `index.ts` | MCP stdio 入口；只向已运行的 bridge HTTP 取数，不启动它 |
| `bridge-main.ts` | 独立 bridge 进程（`npm run bridge`） |
| `server.ts` / `http.ts` | Express：`/health`、插件长轮询、内部 fetch / export-assets、`/plugin/asset-bin` 原始字节落盘 |
| `bridge.ts` | 会话、任务队列（`payload` / `assets` 两类）、超时 |
| `tools.ts` | 8 个 MCP 工具 |
| `url.ts` | 解析 js.design 链接 / 裸节点 id |
| `store.ts` | 内存 + `~/.jsdesign-mcp/` 落盘、按需切图回填、启动时清过期切图 |
| `assets.ts` | 字节/base64 落盘成文件、资产清单 |
| `query.ts` | 缓存上的 overview / find / list / tokens |
| `types.ts` | `DesignPayload` / `DesignNode` |

## 1. 安装并启动 bridge

插件和 MCP 都连 `127.0.0.1:3847`，但只有 **bridge 进程**听这个端口。Cursor 的 MCP 只当 HTTP 客户端，**不会**启动 bridge。

```bash
cd ~/mywork/jsdesign-mcp
npm --prefix mcp-server install --registry https://registry.npmjs.org/
npm run bridge
```

`install` 会编译到 `dist/`，日常使用不用再 `build`。开发调试改用 `npm start`（`tsx watch` 源码）。

探活：`curl -s http://127.0.0.1:3847/health` 应返回 `"ok":true,"role":"bridge"`。已连接插件时还会有 `"pluginConnected":true`。

端口：`JSDESIGN_MCP_PORT=3847`。空闲退出：`JSDESIGN_MCP_BRIDGE_IDLE_MS`（默认 `300000`，`0` 为不退出）。要立刻释放端口用 `npm stop`。

切图缓存：bridge 每次启动会清掉 `~/.jsdesign-mcp/assets/` 里超过 7 天未改动的文件，并把索引与节点上指向它们的 `path` 一并摘掉（保留 `ref`，仍可按 ref 重新取图）。`JSDESIGN_MCP_ASSET_MAX_AGE_MS` 可改保留时长，`0` 为不清理。

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

路径按本机仓库位置改。改了 `mcp-server/src` 之后才需要 `npm run build`，然后在 Cursor MCP 面板重启 `jsdesign`。

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
| `get_node_by_url` | **主工具**：解析链接 / `linkelement` / 裸 id，向已连接插件拉节点。只拉结构与样式，**不带图片字节** |
| `export_assets` | **按需切图**：`ids`（节点 id）或 `refs`（图片 hash）导出成本机文件并返回路径 |
| `get_plugin_status` | 插件是否已连接、缓存里有没有数据 |
| `list_assets` | 列出已落盘的图片 / 切图（本机绝对路径） |
| `get_selection_overview` | 最近一次拉取的概览（meta、tokens、树摘要，深度 3） |
| `get_node` | 在缓存里按 id 或 name（部分匹配）查节点，不访问插件 |
| `list_nodes` | 扁平列出缓存节点的 id / name / type |
| `get_design_tokens` | 最近一次拉取的颜色 / 字号 / 字体 / 圆角 / 间距 |

`get_node_by_url` 成功后写入缓存。其它查询工具读的是这次缓存，要换节点就再调一次主工具。

## 5. 按需切图与资源

`get_node_by_url` **不再导出任何字节**（早先整树自动切图会把宿主主线程占死、画布卡住）。资产改由 `export_assets` 按需触发，只导出你点名的节点：

```
AI: get_node_by_url        → 结构 / 样式 / tokens，图片只有 image.ref（hash）
AI: export_assets {ids,refs} → 插件只导这几项 → 字节直传落盘 → 返回本机路径
```

导出策略（按节点自动选）：

1. **IMAGE 填充** → `getImageByHash().getBytesAsync()`，只读已有图片字节，不触发画布栅格化
2. **图标类 → SVG**（`exportAsync({format:'SVG'})`，失败回退几何拼装）。判据：设计稿里显式设了 SVG 导出设置，或 8–256px 无文字且名称像图标 / 子树含矢量，或 ≤256px 的 VECTOR / 布尔运算
3. **其余一律 PNG**（`exportAsync({format:'PNG', constraint})`）。超过 **4M 像素**预算的按 `SCALE` 降采样，避免一次导出撑住画布。节点显式设了 PNG / JPG / Webp 导出设置时同样走 PNG，不改 SVG
4. 单次最多 **20** 项，超出的会提示再调一次

落盘走文件系统而不是 base64：插件用 `jsDesign.fetch` 把 `Uint8Array` 直接 POST 给 bridge 的 `/plugin/asset-bin`，bridge 从 socket 直接写文件，全程不做 base64 编解码、不进 JSON、不受 payload 体积影响。宿主没有 `jsDesign.fetch` 或直传失败时，才回退到 base64 结果通道（`/plugin/result`），两条路径落盘结果一致。

落盘后：

| 位置 | 内容 |
|------|------|
| `~/.jsdesign-mcp/assets/` | 实际文件（`.svg` / `.png` 等） |
| `~/.jsdesign-mcp/assets.json` | 资产清单（含去重 key） |
| `~/.jsdesign-mcp/latest.json` | 最近一次 `DesignPayload`（节点上带 `path`，SVG 另带 `svg` 源码） |

节点上会出现 `image` / `slice` 的 `path`；用 `list_assets` 看清单，再复制到项目的 `public` / `assets` 后引用。

重复请求同一个图片 hash 时命中磁盘直接复用（`cached: true`），零往返。切图按节点 id **不**做缓存复用——同 id 不代表像素相同。

## 6. 节点数据（摘要）

每个 `DesignNode` 尽量对齐即时设计 Plugin API，常见字段：

- 几何：`box`（相对父级 x/y/w/h）、`rotation`、`opacity`、`constraints`
- 布局：`layout.mode/gap/padding/align/justify`、`layoutAlign`、`layoutGrow`、`clipsContent`
- 外观：`fills`（SOLID / IMAGE / 渐变）、`strokes`、`dashPattern`、`cornerRadius`、`effects`（阴影 / 模糊）
- 文本：`text.characters`、字号 / 字体 / 字重 / 行高 / 字距 / 对齐 / 颜色（实例内会回退 `getRangeFills` / 主组件）
- 组件：`component.componentId/Name`、`variantProperties`
- 资源：`image` / `slice` 的 `ref`（图片 hash、节点 id）随结构拉取返回；调 `export_assets` 后同一字段带上 `path`（本机文件），SVG 切图另带 `svg` 源码

坐标单位为 px，颜色为 `#rrggbb`。

## 开发

```bash
cd mcp-server
npm install --registry https://registry.npmjs.org/
npm start
```

脚本：

| 命令 | 作用 |
|------|------|
| `npm install` | 装依赖；`prepare` 会 `tsc` 到 `dist/` |
| `npm start` | 开发调试：`tsx watch` 跑 `src/bridge-main.ts`，改文件自动重启 |
| `npm stop` | 结束占用 3847 的监听进程（含 Cursor 旧版 `detached` 拉起的孤儿 bridge） |
| `npm run bridge` | 跑打包产物 `dist/bridge-main.js` |
| `npm run build` | 手动 `tsc`（改源码后给 Cursor / `bridge` 用） |
| `npm run mcp` | 跑 MCP stdio 打包产物（通常由 Cursor 拉起） |
| `npm test` | 编译后跑 Node 内置 test runner |

需要 Node 20+。单测覆盖 store / query / url / http / tools / assets，以及插件侧的导出策略与按需切图（`plugin/code.test.js`）。按需切图这条链路有一个端到端测试：起真实 HTTP bridge → 模拟插件 long-poll 领任务 → 直传字节 / 兜底 base64 → 校验文件落盘与节点回填。

## 故障排查

| 现象 | 处理 |
|------|------|
| 插件「连接失败：本机 3847 无服务」 | 先 `npm run bridge`（开发用 `npm start`） |
| `npm start` 后 Ctrl+C 仍占着 3847 | 旧版 MCP 会 `detached` 拉起孤儿 `bridge-main.js`（PPID=1）。`npm stop`，再 `npm run build` 让 Cursor 加载新 dist |
| `lsof -iTCP:3847` 看到 `index.js` 而不是 `bridge-main.js` | 旧版把 HTTP 嵌在 MCP 里了，杀掉该进程后 `npm run bridge` |
| `get_node_by_url` 提示未连接 | 插件点「连接」，保持窗口打开 |
| 拉取超时（60s） | 确认插件仍连接、当前文件里有该节点 |
| `export_assets` 提示未连接 / 超时（120s） | 插件保持打开并已连接；单次要的项少一点（上限 20 项） |
| `export_assets` 返回 `skipped: 导出为空` | 该节点没有可导出的图片或切图（例如纯文本、纯色块），或大节点降采样后导出失败 |
| `export_assets` 走不了直传 | 宿主版本没有 `jsDesign.fetch` 时会自动回退 base64 通道，结果一致但慢一些；看插件返回项的 `data`/`path` 可判断走了哪条 |
| 无法解析链接 | 必须带 `linkelement`（或 `node-id` / `nodeId`），或直接传 `82:2142` |
| 找不到节点 | 链接必须来自**当前打开的文件** |
| `meta.truncated: true` | 子树超过 2000 节点，换更小的 Frame 再拉 |
| 改插件不生效 | 关掉插件再开，或重新导入 |
| 改 MCP 不生效 | `npm run build` 后重启 Cursor 里的 `jsdesign` |

## License

MIT
