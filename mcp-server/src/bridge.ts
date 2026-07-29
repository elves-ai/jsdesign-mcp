import { randomUUID } from 'node:crypto';
import type { DesignPayload } from './types.js';
import { isDesignPayload } from './types.js';

type PendingFetch = {
  resolve: (payload: DesignPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  nodeId: string;
  meta: Record<string, unknown>;
};

type WaitingPoller = {
  resolve: (job: { requestId: string; nodeId: string; meta: Record<string, unknown> } | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * HTTP long-poll bridge between MCP and Instant Design plugin UI.
 * (Plugin UI often blocks WebSocket; fetch/long-poll works.)
 */
export class PluginBridge {
  private sessions = new Set<string>();
  private pending = new Map<string, PendingFetch>();
  private queue: Array<{ requestId: string; nodeId: string; meta: Record<string, unknown> }> = [];
  private waiters: WaitingPoller[] = [];
  private readonly timeoutMs: number;

  constructor(timeoutMs = 20000) {
    this.timeoutMs = timeoutMs;
  }

  get pluginConnected(): boolean {
    return this.sessions.size > 0;
  }

  get connectionCount(): number {
    return this.sessions.size;
  }

  connect(): { sessionId: string } {
    const sessionId = randomUUID();
    this.sessions.add(sessionId);
    return { sessionId };
  }

  disconnect(sessionId?: string): void {
    if (sessionId) this.sessions.delete(sessionId);
    else this.sessions.clear();
    // Wake waiters so clients can exit cleanly
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.resolve(null);
    }
    this.waiters = [];
  }

  touch(sessionId: string): boolean {
    if (!this.sessions.has(sessionId)) return false;
    return true;
  }

  /** Plugin long-poll: wait until a fetch job is available. */
  waitForJob(
    sessionId: string,
    waitMs = 25000
  ): Promise<{ requestId: string; nodeId: string; meta: Record<string, unknown> } | null> {
    if (!this.sessions.has(sessionId)) {
      return Promise.reject(new Error('session invalid; please reconnect'));
    }

    const job = this.queue.shift();
    if (job) return Promise.resolve(job);

    return new Promise((resolve) => {
      const waiter: WaitingPoller = {
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(null);
        }, waitMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** MCP asks plugin to export a node. */
  fetchNode(
    nodeId: string,
    meta?: { fileKey?: string; pageId?: string; url?: string }
  ): Promise<DesignPayload> {
    if (!this.pluginConnected) {
      return Promise.reject(
        new Error(
          '即时设计插件未连接。请在桌面端打开本插件并点击「连接」。'
        )
      );
    }

    const requestId = randomUUID();
    const metaObj = (meta || {}) as Record<string, unknown>;

    return new Promise<DesignPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `拉取节点超时（${this.timeoutMs}ms）。请确认插件保持打开且已连接，文件中存在节点 ${nodeId}。`
          )
        );
      }, this.timeoutMs);

      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        nodeId,
        meta: metaObj,
      });

      const job = { requestId, nodeId, meta: metaObj };
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(job);
      } else {
        this.queue.push(job);
      }
    });
  }

  completeJob(
    requestId: string,
    result:
      | { ok: true; payload: DesignPayload }
      | { ok: false; error: string }
  ): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    if (!result.ok) {
      pending.reject(new Error(result.error || '插件返回失败'));
      return true;
    }
    if (!isDesignPayload(result.payload)) {
      pending.reject(new Error('插件返回的数据不是合法 DesignPayload'));
      return true;
    }
    pending.resolve(result.payload);
    return true;
  }
}
