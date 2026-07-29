import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { DesignPayload } from './types.js';
import { isDesignPayload } from './types.js';

type Pending = {
  resolve: (payload: DesignPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type BridgeClientMessage =
  | { type: 'hello'; role: 'plugin' }
  | {
      type: 'fetch-node-result';
      requestId: string;
      ok: true;
      payload: DesignPayload;
    }
  | {
      type: 'fetch-node-result';
      requestId: string;
      ok: false;
      error: string;
    };

export class PluginBridge {
  private sockets = new Set<WebSocket>();
  private pending = new Map<string, Pending>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 20000) {
    this.timeoutMs = timeoutMs;
  }

  get pluginConnected(): boolean {
    return this.sockets.size > 0;
  }

  get connectionCount(): number {
    return this.sockets.size;
  }

  addClient(ws: WebSocket): void {
    this.sockets.add(ws);
    ws.on('close', () => {
      this.sockets.delete(ws);
    });
    ws.on('message', (data) => {
      this.onMessage(String(data));
    });
    this.send(ws, {
      type: 'welcome',
      pluginConnected: true,
      message: '已连接到 jsdesign-mcp',
    });
  }

  /** Ask connected plugin to export a node by id. */
  fetchNode(nodeId: string, meta?: { fileKey?: string; pageId?: string; url?: string }): Promise<DesignPayload> {
    if (!this.pluginConnected) {
      return Promise.reject(
        new Error(
          '即时设计插件未连接。请在桌面端打开本插件并点击「连接」。'
        )
      );
    }

    const requestId = randomUUID();
    return new Promise<DesignPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `拉取节点超时（${this.timeoutMs}ms）。请确认插件保持打开且已连接，文件中存在节点 ${nodeId}。`
          )
        );
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.broadcast({
        type: 'fetch-node',
        requestId,
        nodeId,
        meta: meta || {},
      });
    });
  }

  private onMessage(raw: string): void {
    let msg: BridgeClientMessage;
    try {
      msg = JSON.parse(raw) as BridgeClientMessage;
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      return;
    }

    if (msg.type !== 'fetch-node-result') return;

    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.requestId);

    if (!msg.ok) {
      pending.reject(new Error(msg.error || '插件返回失败'));
      return;
    }
    if (!isDesignPayload(msg.payload)) {
      pending.reject(new Error('插件返回的数据不是合法 DesignPayload'));
      return;
    }
    pending.resolve(msg.payload);
  }

  private broadcast(data: unknown): void {
    const raw = JSON.stringify(data);
    for (const ws of this.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  }

  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  }
}
