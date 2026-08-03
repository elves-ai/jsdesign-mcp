# JsDesign → Cursor MCP

从[即时设计](https://js.design)按**设计链接**拉取精确节点数据，经本地 MCP 提供给 Cursor 做 design-to-code。

## 工作方式

1. Cursor 启动 MCP（含本机 HTTP + WebSocket）  
2. 即时设计桌面端打开本插件 → 点 **连接**  
3. 复制带 `linkelement` 的链接发给 AI，例如：  
   `https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142`  
4. AI 调用 `get_node_by_url` → MCP 经 WebSocket 让插件 `getNodeById('82:2142')` → 返回结构/样式  

```
即时设计插件 (已连接)          本机 MCP                    Cursor
┌─────────────────┐  WS     ┌──────────────────┐  stdio  ┌────────┐
│ 连接 / 断开      │◄──────►│ :3847 /plugin     │◄───────►│ Agent  │
│ 按 nodeId 导出   │        │ get_node_by_url   │         │ 贴链接 │
└─────────────────┘        └──────────────────┘         └────────┘
```

## 1. 启动本地 bridge（插件「连接」依赖它）

插件用 HTTP 连 `127.0.0.1:3847`（不用 WebSocket）。先保证 bridge 在跑：

```bash
cd ~/mywork/jsdesign-mcp/mcp-server
npm run build
npm run bridge
```

探活：`curl -s http://127.0.0.1:3847/health` 应返回 `"ok":true`。

也可只开 Cursor 的 `jsdesign` MCP（会尝试自动拉起 bridge）；不可靠时请手动 `npm run bridge`。

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

改代码后 `npm run build`，再在 Cursor MCP 面板重启 `jsdesign`。

## 3. 导入即时设计插件（桌面端）

1. 安装 [桌面客户端](https://js.design/download)  
2. **插件 → 开发者 → 导入插件**  
3. 选择 `plugin/manifest.json`  
4. 运行插件 → 点 **连接**（状态点变绿）

## 4. MCP 工具

| Tool | 说明 |
|------|------|
| `get_node_by_url` | **主工具**：解析链接/`linkelement`，向已连接插件拉节点（含自动切图） |
| `list_assets` | 列出本次落盘的图片/切图（本机绝对路径） |
| `get_plugin_status` | 插件是否已连接 |
| `get_selection_overview` | 最近一次拉取的概览 |
| `get_node` / `list_nodes` / `get_design_tokens` | 基于最近一次缓存查询 |

### 自动切图

`get_node_by_url` 时插件会导出：

1. **IMAGE 填充** → 节点 `image`（真实图片字节）
2. **图标类切图**（`icon_slice`，或小尺寸且含矢量的 `exportSettings`）→ 节点 `slice`（**优先 SVG**，失败回退 PNG），并附 `svg` 源码
3. **其它 exportSettings 图层** → 节点 `slice`（PNG）
4. **根节点 preview** → `root.preview`（PNG）

MCP 收到后写入 `~/.jsdesign-mcp/assets/`（`.svg` / `.png`），节点上只保留 `path`（去掉 base64）。用 `list_assets` 查看清单。

## 开发

```bash
cd mcp-server
npm install --registry https://registry.npmjs.org/
npm test
npm run build
```

探活：`curl -s http://127.0.0.1:3847/health`（看 `pluginConnected`）。

## 故障排查

| 现象 | 处理 |
|------|------|
| 插件「连接失败」 | Cursor MCP `jsdesign` 需已连接（会监听 3847） |
| `get_node_by_url` 提示未连接 | 插件点「连接」，保持插件窗口打开 |
| 找不到节点 | 链接必须来自**当前打开的文件**；检查 `linkelement` |
| 改插件不生效 | 关掉插件再开，或重新导入 |

## License

MIT
