# JsDesign MCP Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用即时设计官方插件读取选中 Frame，经本机 HTTP 推送到 MCP Server，供 Cursor 查询结构化设计数据并做 design-to-code。

**Architecture:** `plugin/` 运行在即时设计宿主（`jsDesign.*` API），导出规范化 `DesignPayload` 后 `POST http://127.0.0.1:3847/ingest`。`mcp-server/` 同时跑 Express（仅绑定 127.0.0.1）与 MCP stdio；工具从内存缓存（并落盘 `~/.jsdesign-mcp/latest.json`）读取最近一次推送。

**Tech Stack:** TypeScript、Node 20+、Express、`@modelcontextprotocol/sdk`、即时设计 Plugin API（`jsDesign`，参考 `@jsdesigndeveloper/plugin-typings`）、原生 JS 插件（`plugin/code.js` + `ui.html`，宿主环境无 npm bundler 要求）。

**Spec:** `docs/superpowers/specs/2026-07-29-jsdesign-mcp-design.md`

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `mcp-server/package.json` | Server 依赖与脚本 |
| `mcp-server/tsconfig.json` | TS 编译配置 |
| `mcp-server/src/types.ts` | `DesignPayload` / `DesignNode` 类型与校验 |
| `mcp-server/src/store.ts` | 内存缓存 + `~/.jsdesign-mcp/latest.json` 读写 |
| `mcp-server/src/query.ts` | overview / find / tokens / list 纯函数 |
| `mcp-server/src/http.ts` | Express：`/health`、`/ingest` |
| `mcp-server/src/tools.ts` | MCP tool 定义与 handler |
| `mcp-server/src/index.ts` | 启动 HTTP + MCP stdio |
| `mcp-server/src/*.test.ts` | Node 内置 test runner 单测 |
| `plugin/manifest.json` | 即时设计本地插件清单 |
| `plugin/code.js` | 选中导出与规范化 |
| `plugin/ui.html` | 侧栏 UI：发送 / 端口配置 / 状态 |
| `README.md` | 安装、Cursor 配置、使用流程 |
| `.gitignore` | `node_modules`、`dist`、本地缓存等 |

---

### Task 1: Scaffold mcp-server

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `.gitignore`
- Create: `mcp-server/src/types.ts`

- [ ] **Step 1: Write package.json and tsconfig**

`mcp-server/package.json`:

```json
{
  "name": "jsdesign-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js",
    "test": "tsc && node --test dist/**/*.test.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "cors": "^2.8.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

`mcp-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

`.gitignore`:

```
node_modules/
dist/
.DS_Store
design-data.json
*.log
```

- [ ] **Step 2: Add shared types**

`mcp-server/src/types.ts`:

```ts
export type Box = { x: number; y: number; w: number; h: number };

export type Padding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type DesignNode = {
  id: string;
  name: string;
  type: string;
  box: Box;
  layout?: {
    mode?: string;
    gap?: number;
    padding?: Padding;
    align?: string;
    justify?: string;
  };
  fills?: unknown[];
  strokes?: unknown[];
  cornerRadius?: number | number[];
  opacity?: number;
  text?: {
    characters: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number | string;
    lineHeight?: number | string;
    color?: string;
  };
  image?: { ref?: string };
  children: DesignNode[];
};

export type DesignTokens = {
  colors: string[];
  fontSizes: number[];
  fontFamilies: string[];
  radii: number[];
  spacings: number[];
};

export type DesignPayload = {
  meta: {
    fileName?: string;
    pageName?: string;
    exportedAt: string;
    truncated?: boolean;
  };
  tokens: DesignTokens;
  root: DesignNode;
};

export function isDesignPayload(value: unknown): value is DesignPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v.meta || !v.tokens || !v.root) return false;
  const meta = v.meta as Record<string, unknown>;
  const root = v.root as Record<string, unknown>;
  return (
    typeof meta.exportedAt === 'string' &&
    typeof root.id === 'string' &&
    typeof root.name === 'string' &&
    typeof root.type === 'string' &&
    Array.isArray(root.children)
  );
}

export const EMPTY_TOKENS: DesignTokens = {
  colors: [],
  fontSizes: [],
  fontFamilies: [],
  radii: [],
  spacings: [],
};
```

- [ ] **Step 3: Install and verify build empty package**

Run:

```bash
cd mcp-server && npm install && npx tsc --noEmit
```

Expected: install succeeds; `tsc --noEmit` exits 0 (only types file, no emit issues).

- [ ] **Step 4: Commit**

```bash
git add .gitignore mcp-server/package.json mcp-server/package-lock.json mcp-server/tsconfig.json mcp-server/src/types.ts
git commit -m "chore: scaffold mcp-server package and shared types"
```

---

### Task 2: Store (memory + disk)

**Files:**
- Create: `mcp-server/src/store.ts`
- Create: `mcp-server/src/store.test.ts`

- [ ] **Step 1: Write failing tests**

`mcp-server/src/store.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesignStore } from './store.js';
import type { DesignPayload } from './types.js';

function samplePayload(): DesignPayload {
  return {
    meta: { exportedAt: '2026-07-29T00:00:00.000Z', pageName: 'Home' },
    tokens: {
      colors: ['#ffffff'],
      fontSizes: [14],
      fontFamilies: ['PingFang SC'],
      radii: [8],
      spacings: [16],
    },
    root: {
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      box: { x: 0, y: 0, w: 375, h: 812 },
      children: [],
    },
  };
}

describe('DesignStore', () => {
  let tmpDir: string;
  let store: DesignStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-mcp-'));
    store = new DesignStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when empty', () => {
    assert.equal(store.get(), null);
  });

  it('stores payload in memory and disk', () => {
    const payload = samplePayload();
    store.set(payload);
    assert.deepEqual(store.get(), payload);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'latest.json'), 'utf8')
    );
    assert.deepEqual(onDisk, payload);
  });

  it('loads from disk on construct', () => {
    const payload = samplePayload();
    fs.writeFileSync(
      path.join(tmpDir, 'latest.json'),
      JSON.stringify(payload)
    );
    const reloaded = new DesignStore(tmpDir);
    assert.deepEqual(reloaded.get(), payload);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd mcp-server && npm test
```

Expected: FAIL — `DesignStore` not found / cannot resolve `./store.js`.

- [ ] **Step 3: Implement store**

`mcp-server/src/store.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DesignPayload } from './types.js';
import { isDesignPayload } from './types.js';

export function defaultStoreDir(): string {
  return path.join(os.homedir(), '.jsdesign-mcp');
}

export class DesignStore {
  private payload: DesignPayload | null = null;
  private readonly filePath: string;

  constructor(dir: string = defaultStoreDir()) {
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'latest.json');
    this.loadFromDisk();
  }

  get(): DesignPayload | null {
    return this.payload;
  }

  set(payload: DesignPayload): void {
    this.payload = payload;
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (isDesignPayload(raw)) this.payload = raw;
    } catch {
      // ignore corrupt cache
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd mcp-server && npm test
```

Expected: all `DesignStore` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/store.ts mcp-server/src/store.test.ts
git commit -m "feat: add design payload store with disk cache"
```

---

### Task 3: Query helpers

**Files:**
- Create: `mcp-server/src/query.ts`
- Create: `mcp-server/src/query.test.ts`

- [ ] **Step 1: Write failing tests**

`mcp-server/src/query.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverview,
  findNode,
  listNodes,
  flattenTokens,
} from './query.js';
import type { DesignPayload } from './types.js';

const payload: DesignPayload = {
  meta: { exportedAt: '2026-07-29T00:00:00.000Z', pageName: 'P', truncated: false },
  tokens: {
    colors: ['#111111', '#ffffff'],
    fontSizes: [12, 16],
    fontFamilies: ['Inter'],
    radii: [4],
    spacings: [8, 16],
  },
  root: {
    id: '1:1',
    name: 'Home',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 375, h: 200 },
    children: [
      {
        id: '1:2',
        name: 'Title',
        type: 'TEXT',
        box: { x: 16, y: 16, w: 200, h: 24 },
        text: { characters: 'Hello', fontSize: 16, color: '#111111' },
        children: [],
      },
    ],
  },
};

describe('query', () => {
  it('buildOverview summarizes tree', () => {
    const overview = buildOverview(payload);
    assert.equal(overview.meta.pageName, 'P');
    assert.equal(overview.root.name, 'Home');
    assert.equal(overview.root.childCount, 1);
    assert.deepEqual(overview.tokens.colors, ['#111111', '#ffffff']);
  });

  it('findNode by id and name', () => {
    assert.equal(findNode(payload, { id: '1:2' })?.name, 'Title');
    assert.equal(findNode(payload, { name: 'title' })?.id, '1:2');
    assert.equal(findNode(payload, { name: 'missing' }), null);
  });

  it('listNodes flattens', () => {
    const list = listNodes(payload);
    assert.deepEqual(
      list.map((n) => n.id),
      ['1:1', '1:2']
    );
  });

  it('flattenTokens returns payload tokens', () => {
    assert.deepEqual(flattenTokens(payload), payload.tokens);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd mcp-server && npm test
```

Expected: FAIL — cannot find `./query.js`.

- [ ] **Step 3: Implement query**

`mcp-server/src/query.ts`:

```ts
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
  return {
    meta: payload.meta,
    tokens: payload.tokens,
    root: summarize(payload.root),
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd mcp-server && npm test
```

Expected: query tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/query.ts mcp-server/src/query.test.ts
git commit -m "feat: add design query helpers for MCP tools"
```

---

### Task 4: HTTP ingest server

**Files:**
- Create: `mcp-server/src/http.ts`
- Create: `mcp-server/src/http.test.ts`

- [ ] **Step 1: Write failing tests**

`mcp-server/src/http.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createHttpApp } from './http.js';
import { DesignStore } from './store.js';

describe('HTTP API', () => {
  let server: Server;
  let base: string;
  let store: DesignStore;
  let tmp: string;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdesign-http-'));
    store = new DesignStore(tmp);
    const app = createHttpApp(store);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('GET /health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.hasData, false);
  });

  it('POST /ingest rejects invalid body', async () => {
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 1 }),
    });
    assert.equal(res.status, 400);
  });

  it('POST /ingest accepts payload', async () => {
    const payload = {
      meta: { exportedAt: '2026-07-29T00:00:00.000Z' },
      tokens: {
        colors: [],
        fontSizes: [],
        fontFamilies: [],
        radii: [],
        spacings: [],
      },
      root: {
        id: '1:1',
        name: 'A',
        type: 'FRAME',
        box: { x: 0, y: 0, w: 1, h: 1 },
        children: [],
      },
    };
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);
    assert.equal(store.get()?.root.name, 'A');
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.hasData, true);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd mcp-server && npm test
```

Expected: FAIL — `createHttpApp` missing.

- [ ] **Step 3: Implement HTTP**

`mcp-server/src/http.ts`:

```ts
import express from 'express';
import cors from 'cors';
import type { DesignStore } from './store.js';
import { isDesignPayload } from './types.js';

export function createHttpApp(store: DesignStore) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  app.get('/health', (_req, res) => {
    const data = store.get();
    res.json({
      ok: true,
      hasData: data !== null,
      exportedAt: data?.meta.exportedAt ?? null,
      pageName: data?.meta.pageName ?? null,
      rootName: data?.root.name ?? null,
    });
  });

  app.post('/ingest', (req, res) => {
    if (!isDesignPayload(req.body)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid DesignPayload. Expect meta/tokens/root.',
      });
      return;
    }
    store.set(req.body);
    res.json({
      ok: true,
      rootName: req.body.root.name,
      truncated: Boolean(req.body.meta.truncated),
    });
  });

  return app;
}

export const DEFAULT_HTTP_PORT = 3847;
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd mcp-server && npm test
```

Expected: HTTP tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/http.ts mcp-server/src/http.test.ts
git commit -m "feat: add localhost HTTP health and ingest endpoints"
```

---

### Task 5: MCP tools

**Files:**
- Create: `mcp-server/src/tools.ts`
- Create: `mcp-server/src/tools.test.ts`

- [ ] **Step 1: Write failing tests**

`mcp-server/src/tools.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleToolCall, toolDefinitions } from './tools.js';
import type { DesignPayload } from './types.js';

const payload: DesignPayload = {
  meta: { exportedAt: '2026-07-29T00:00:00.000Z', pageName: 'Home' },
  tokens: {
    colors: ['#000000'],
    fontSizes: [14],
    fontFamilies: ['Arial'],
    radii: [],
    spacings: [8],
  },
  root: {
    id: '1:1',
    name: 'Card',
    type: 'FRAME',
    box: { x: 0, y: 0, w: 100, h: 100 },
    children: [
      {
        id: '1:2',
        name: 'Label',
        type: 'TEXT',
        box: { x: 0, y: 0, w: 40, h: 20 },
        text: { characters: 'Hi', fontSize: 14 },
        children: [],
      },
    ],
  },
};

describe('MCP tools', () => {
  it('lists four tools', () => {
    assert.equal(toolDefinitions.length, 4);
    assert.deepEqual(
      toolDefinitions.map((t) => t.name).sort(),
      [
        'get_design_tokens',
        'get_node',
        'get_selection_overview',
        'list_nodes',
      ]
    );
  });

  it('prompts when no data', () => {
    const result = handleToolCall('get_selection_overview', {}, null);
    assert.match(result.content[0].text, /请先在即时设计插件中发送选中/);
  });

  it('returns overview JSON', () => {
    const result = handleToolCall('get_selection_overview', {}, payload);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.root.name, 'Card');
  });

  it('get_node by name', () => {
    const result = handleToolCall('get_node', { name: 'Label' }, payload);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.text.characters, 'Hi');
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
cd mcp-server && npm test
```

Expected: FAIL — `./tools.js` missing.

- [ ] **Step 3: Implement tools**

`mcp-server/src/tools.ts`:

```ts
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
  '暂无设计数据。请在即时设计中选中 Frame，打开本插件并点击「发送选中到 Cursor」。';

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
      if (!node) return textResult(`未找到节点：id=${id ?? ''} name=${nodeName ?? ''}`);
      return textResult(JSON.stringify(node, null, 2));
    }
    default:
      return textResult(`未知工具：${name}`);
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd mcp-server && npm test
```

Expected: tools tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/src/tools.test.ts
git commit -m "feat: add MCP tool handlers for design queries"
```

---

### Task 6: Wire index.ts (HTTP + MCP stdio)

**Files:**
- Create: `mcp-server/src/index.ts`

- [ ] **Step 1: Implement entrypoint**

`mcp-server/src/index.ts`:

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DesignStore } from './store.js';
import { createHttpApp, DEFAULT_HTTP_PORT } from './http.js';
import { handleToolCall, toolDefinitions } from './tools.js';

const port = Number(process.env.JSDESIGN_MCP_PORT || DEFAULT_HTTP_PORT);
const store = new DesignStore();

function startHttp(): void {
  const app = createHttpApp(store);
  app.listen(port, '127.0.0.1', () => {
    console.error(`[jsdesign-mcp] HTTP on http://127.0.0.1:${port}`);
    console.error(`[jsdesign-mcp] ingest: POST /ingest  health: GET /health`);
  });
}

async function startMcp(): Promise<void> {
  const server = new Server(
    { name: 'jsdesign-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(
      request.params.name,
      (request.params.arguments || {}) as Record<string, unknown>,
      store.get()
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[jsdesign-mcp] MCP stdio connected');
}

startHttp();
await startMcp();
```

- [ ] **Step 2: Build and smoke health**

```bash
cd mcp-server && npm run build
# 临时起 HTTP 探活（MCP stdio 会挂起等待 stdin，用 timeout 或另开方式）
JSDESIGN_MCP_PORT=3847 node --input-type=module -e "
import { DesignStore } from './dist/store.js';
import { createHttpApp } from './dist/http.js';
const app = createHttpApp(new DesignStore('/tmp/jsdesign-mcp-smoke'));
const s = app.listen(3847, '127.0.0.1', async () => {
  const r = await fetch('http://127.0.0.1:3847/health');
  console.log(await r.json());
  s.close();
});
"
```

Expected: `{ ok: true, hasData: false, ... }`（若 3847 被占用，换端口）。

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat: wire MCP stdio server with localhost HTTP ingest"
```

---

### Task 7: Instant Design plugin (UI + exporter)

**Files:**
- Create: `plugin/manifest.json`
- Create: `plugin/ui.html`
- Create: `plugin/code.js`

即时设计宿主 API 与 Figma 类似：`jsDesign.showUI`、`jsDesign.ui.onmessage`、`jsDesign.currentPage.selection`。插件侧用 ES5 风格 JS（宿主兼容性更好）。节点字段参考官方插件文档与社区实现：`x/y/width/height`、`fills`、`strokes`、`cornerRadius`、`layoutMode`、`itemSpacing`、`padding*`、`characters`、`fontSize`、`fontName`。

- [ ] **Step 1: Create manifest**

`plugin/manifest.json`:

```json
{
  "name": "JsDesign → Cursor MCP",
  "id": "jsdesign-cursor-mcp",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html"
}
```

- [ ] **Step 2: Create UI**

`plugin/ui.html` 要求：

- 标题：JsDesign → Cursor
- 主按钮：「发送选中到 Cursor」
- 输入框：Server URL，默认 `http://127.0.0.1:3847`
- 状态区：success / error / info
- 点击主按钮 → `parent.postMessage({ pluginMessage: { type: 'export-selection' } }, '*')`
- 收到 `selection-payload` → `fetch(serverUrl + '/ingest', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(data) })`
- 收到 `error` → 展示 message
- 页面加载时可 `fetch(serverUrl + '/health')` 显示连接状态（失败不阻断）

完整 HTML（实现时写入文件，保持单文件、无外链依赖）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: "PingFang SC", sans-serif; padding: 16px; color: #222; background: #f7f7f8; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    .sub { font-size: 12px; color: #888; margin-bottom: 16px; }
    label { font-size: 12px; color: #666; display: block; margin-bottom: 4px; }
    input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 12px; box-sizing: border-box; }
    button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: #2f6bff; color: #fff; font-size: 14px; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .status { margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 12px; display: none; white-space: pre-wrap; }
    .status.show { display: block; }
    .ok { background: #eefbf0; color: #1b7a2d; }
    .err { background: #feeeee; color: #b42318; }
    .info { background: #eef2ff; color: #2f4bbf; }
  </style>
</head>
<body>
  <h1>JsDesign → Cursor</h1>
  <p class="sub">发送当前选中 Frame 到本地 MCP</p>
  <label>MCP Server</label>
  <input id="url" value="http://127.0.0.1:3847" />
  <button id="send">发送选中到 Cursor</button>
  <div id="status" class="status"></div>
  <script>
    var statusEl = document.getElementById('status');
    var urlEl = document.getElementById('url');
    var sendBtn = document.getElementById('send');

    function show(type, text) {
      statusEl.className = 'status show ' + type;
      statusEl.textContent = text;
    }

    function serverBase() {
      return (urlEl.value || '').replace(/\/$/, '');
    }

    sendBtn.onclick = function () {
      show('info', '正在读取选中…');
      parent.postMessage({ pluginMessage: { type: 'export-selection' } }, '*');
    };

    onmessage = function (event) {
      var msg = event.data && event.data.pluginMessage;
      if (!msg) return;
      if (msg.type === 'error') {
        show('err', msg.message || '未知错误');
        return;
      }
      if (msg.type === 'selection-payload') {
        show('info', '正在发送到 MCP…');
        fetch(serverBase() + '/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(msg.data),
        })
          .then(function (res) { return res.json().then(function (body) { return { res: res, body: body }; }); })
          .then(function (r) {
            if (!r.res.ok) throw new Error((r.body && r.body.error) || ('HTTP ' + r.res.status));
            show('ok', '已发送：' + (r.body.rootName || 'ok') + (r.body.truncated ? '（已截断）' : ''));
          })
          .catch(function (err) {
            show('err', '发送失败：' + (err && err.message ? err.message : err) + '\n请确认已启动 mcp-server（npm run start）');
          });
      }
    };

    fetch(serverBase() + '/health')
      .then(function (r) { return r.json(); })
      .then(function (b) { show('info', b.ok ? 'MCP 已连接' + (b.hasData ? '（已有缓存数据）' : '') : 'MCP 异常'); })
      .catch(function () { show('info', 'MCP 未启动（发送前请先 npm run start）'); });
  </script>
</body>
</html>
```

- [ ] **Step 3: Create code.js exporter**

`plugin/code.js` 必须实现：

1. `jsDesign.showUI(__html__, { width: 360, height: 280 })`
2. `MAX_NODES = 2000`，遍历计数，超限截断并 `meta.truncated = true`
3. 选中规则：`selection = jsDesign.currentPage.selection`；空则 error；优先找 `type === 'FRAME'`，否则用 `selection[0]` 作为 `root`
4. 将宿主节点映射为 spec 中的 `DesignNode`：
   - `box`: `{ x: node.x||0, y: node.y||0, w: node.width||0, h: node.height||0 }`
   - `layout`: 若有 `layoutMode`，映射 `mode/gap/padding/align/justify`（字段：`itemSpacing`、`paddingTop/Right/Bottom/Left`、`primaryAxisAlignItems`、`counterAxisAlignItems`）
   - `fills` / `strokes`：可见 SOLID → `{ type:'SOLID', color:'#rrggbb', opacity }`；IMAGE → `{ type:'IMAGE', ref: imageHash }`
   - TEXT → `text: { characters, fontSize, fontFamily: fontName.family, fontWeight, lineHeight, color }`
   - `children`: 过滤 `visible !== false`
5. 同步 walk 收集 tokens（colors / fontSizes / fontFamilies / radii / spacings）
6. 组装 `DesignPayload`：`meta.exportedAt = new Date().toISOString()`，`meta.pageName = jsDesign.currentPage.name`，若 API 有文件名则填 `fileName`
7. `jsDesign.ui.postMessage({ type: 'selection-payload', data: payload })`

关键辅助（写入 code.js）：

```js
function rgbToHex(r, g, b) {
  function h(v) {
    var s = Math.round(v * 255).toString(16);
    return s.length === 1 ? '0' + s : s;
  }
  return '#' + h(r) + h(g) + h(b);
}
```

消息处理骨架：

```js
jsDesign.showUI(__html__, { width: 360, height: 280 });

jsDesign.ui.onmessage = function (msg) {
  if (!msg || msg.type !== 'export-selection') return;
  var selection = jsDesign.currentPage.selection;
  if (!selection || selection.length === 0) {
    jsDesign.ui.postMessage({ type: 'error', message: '请先选中一个 Frame 或节点' });
    return;
  }
  var root = null;
  for (var i = 0; i < selection.length; i++) {
    if (selection[i].type === 'FRAME') { root = selection[i]; break; }
  }
  if (!root) root = selection[0];
  var state = { count: 0, truncated: false };
  var node = normalizeNode(root, state);
  var tokens = collectTokens(node);
  var payload = {
    meta: {
      pageName: jsDesign.currentPage.name,
      exportedAt: new Date().toISOString(),
      truncated: state.truncated,
    },
    tokens: tokens,
    root: node,
  };
  jsDesign.ui.postMessage({ type: 'selection-payload', data: payload });
};
```

实现时补全 `normalizeNode` / `collectTokens` / fill/stroke/text 提取；保持单文件、无外部依赖。

- [ ] **Step 4: Manual plugin load check（文档级）**

在 README 写明：

1. 即时设计 → 菜单 → 插件 → 开发者模式 → 导入本地插件 → 选择 `plugin/` 目录  
2. 选中 Frame → 打开插件 → 发送  

（本机无头环境无法完整跑宿主；此步以 README + 结构审查为准。）

- [ ] **Step 5: Commit**

```bash
git add plugin/manifest.json plugin/ui.html plugin/code.js
git commit -m "feat: add JsDesign plugin to export selection to MCP"
```

---

### Task 8: README and Cursor config

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

内容必须包括：

1. 项目一句话说明  
2. 架构简图（与 spec 一致）  
3. 安装 MCP：

```bash
cd mcp-server
npm install
npm run build
npm start
```

4. Cursor MCP 配置示例（绝对路径）：

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

5. 导入本地插件步骤  
6. 使用流程：启动 Server → 选中 Frame → 发送 → 在 Cursor 调用 `get_selection_overview`  
7. 工具列表表  
8. 故障排查：端口占用、`hasData:false`、CORS（本机同源/插件 UI fetch localhost）

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add setup and Cursor MCP usage guide"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Unit tests green**

```bash
cd mcp-server && npm test
```

Expected: all PASS.

- [ ] **Step 2: Ingest curl smoke**

```bash
cd mcp-server && npm run build
# 终端 A：npm start（或仅 HTTP smoke）
curl -s http://127.0.0.1:3847/health
curl -s -X POST http://127.0.0.1:3847/ingest \
  -H 'content-type: application/json' \
  -d '{"meta":{"exportedAt":"2026-07-29T00:00:00.000Z","pageName":"Demo"},"tokens":{"colors":["#fff"],"fontSizes":[14],"fontFamilies":["A"],"radii":[4],"spacings":[8]},"root":{"id":"1:1","name":"Demo","type":"FRAME","box":{"x":0,"y":0,"w":100,"h":100},"children":[{"id":"1:2","name":"T","type":"TEXT","box":{"x":0,"y":0,"w":40,"h":20},"text":{"characters":"Hi","fontSize":14},"children":[]}]}}'
curl -s http://127.0.0.1:3847/health
```

Expected: 第二次 health `hasData: true`，`rootName: Demo`。

- [ ] **Step 3: Confirm Cursor wiring checklist in README**

人工确认：重启 Cursor MCP 后 tools 列表出现四个工具；无数据时文案正确。

- [ ] **Step 4: Final commit if any fixups**

```bash
git add -A
git status
# 若有修复：
git commit -m "fix: address e2e smoke issues"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 官方插件读选中 Frame | Task 7 |
| POST `/ingest`、GET `/health`、仅 127.0.0.1 | Task 4, 6 |
| 端口 3847 可配置 | Task 6 env + Task 7 UI |
| 内存 + `~/.jsdesign-mcp/latest.json` | Task 2 |
| Tools：overview / get_node / tokens / list_nodes | Task 5 |
| DesignPayload 模型 | Task 1 types + Task 7 normalize |
| 未选中 / Server 未启动 / 非法 body / 未 ingest 文案 | Task 4, 5, 7 |
| 子节点 >2000 截断 | Task 7 |
| Cursor 配置与 README | Task 8 |
| 验证计划 | Task 9 |

## Self-Review Notes

- 无 TBD/placeholder 步骤  
- 类型名统一：`DesignPayload` / `DesignNode` / `DesignStore`  
- HTTP 路径统一：`/ingest`、`/health`（非参考仓库的 `/api/design-data`）  
- MVP 不做 `get_node_css`、整页导出、浏览器扩展  

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-jsdesign-mcp.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每个 Task 开一个新子代理，Task 间复查，迭代快  
2. **Inline Execution** — 本会话按 Task 顺序直接实现，关键节点停下来确认  

Which approach?
