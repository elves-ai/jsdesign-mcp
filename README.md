# JsDesign → Cursor MCP

从[即时设计](https://js.design)选中 Frame，导出精确结构/样式，经本地 MCP 提供给 Cursor，用于 design-to-code。

## 架构

```
即时设计编辑器                    本机                         Cursor
┌─────────────────┐          ┌──────────────────┐          ┌────────────┐
│ plugin/         │──HTTP──►│ mcp-server        │◄──stdio──│ AI Agent   │
│ 读选中 Frame     │ 127.0.0.1│ 缓存 DesignPayload│   MCP    │ 按当前项目改│
└─────────────────┘  :3847   └──────────────────┘          └────────────┘
```

## 1. 启动 MCP Server

```bash
cd mcp-server
npm install --registry https://registry.npmjs.org/
npm run build
npm start
```

探活：

```bash
curl -s http://127.0.0.1:3847/health
```

端口可用环境变量覆盖：`JSDESIGN_MCP_PORT=3848 npm start`。

## 2. 配置 Cursor MCP

在 Cursor MCP 设置中加入（路径按本机调整）：

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

重启 MCP 后应看到工具：

| Tool | 说明 |
|------|------|
| `get_selection_overview` | 树概览 + tokens |
| `get_node` | 按 id / name 取节点 |
| `get_design_tokens` | 颜色 / 字体 / 间距 / 圆角 |
| `list_nodes` | 扁平节点列表 |

## 3. 导入即时设计插件

1. 打开即时设计编辑器  
2. 菜单 → 插件 → 开发者模式 → 导入本地插件  
3. 选择本仓库的 `plugin/` 目录（含 `manifest.json`）

## 4. 使用流程

1. `npm start` 保持 MCP 运行  
2. 在即时设计中选中一个 Frame  
3. 运行插件 → 点击「发送选中到 Cursor」  
4. 在 Cursor 对话中让 AI 先调用 `get_selection_overview`，再按当前项目生成代码  

## 开发

```bash
cd mcp-server
npm test
```

缓存文件默认写在 `~/.jsdesign-mcp/latest.json`。

## 故障排查

| 现象 | 处理 |
|------|------|
| 插件提示发送失败 | 确认 `npm start` 已运行，URL 为 `http://127.0.0.1:3847` |
| MCP 工具提示暂无数据 | 先在插件里成功发送一次 |
| 端口占用 | `JSDESIGN_MCP_PORT=3848`，并在插件里改 URL |
| `npm install` 403 | 使用 `npm install --registry https://registry.npmjs.org/` |
| health `hasData: false` | 尚未 ingest，或缓存被清空 |

## License

MIT
