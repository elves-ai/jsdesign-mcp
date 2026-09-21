import { randomUUID } from 'node:crypto';
import type { AssetManifestItem, DesignPayload } from './types.js';
import { isDesignPayload } from './types.js';

/**
 * 下发给插件的任务。
 * - payload：拉节点结构与样式（不带任何字节）
 * - assets：按需切图，字节由插件经 jsDesign.fetch 直传 /plugin/asset-bin 落盘
 */
export type FetchJob = {
  requestId: string;
  kind: 'payload' | 'assets';
  nodeId?: string;
  nodeIds?: string[];
  refs?: string[];
  meta: Record<string, unknown>;
};

type PendingPayload = {
  resolve: (payload: DesignPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingAssets = {
  resolve: (items: AssetManifestItem[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type WaitingPoller = {
  resolve: (job: FetchJob | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

const PAYLOAD_TIMEOUT_MS = 60_000;
const ASSET_TIMEOUT_MS = 120_000;

/**
 * HTTP long-poll bridge between MCP and Instant Design plugin UI.
 * (Plugin UI often blocks WebSocket; fetch/long-poll works.)
 */
export class PluginBridge {
  private sessions = new Set<string>();
  private pendingPayload = new Map<string, PendingPayload>();
  private pendingAssets = new Map<string, PendingAssets>();
  /** requestId → 插件直传落盘的资产，任务完成时一并返回 */
  private uploaded = new Map<string, AssetManifestItem[]>();
  private queue: FetchJob[] = [];
  private waiters: WaitingPoller[] = [];
  private readonly timeoutMs: number;
  private readonly assetTimeoutMs: number;

  constructor(timeoutMs = PAYLOAD_TIMEOUT_MS, assetTimeoutMs = ASSET_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    this.assetTimeoutMs = assetTimeoutMs;
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
    return this.sessions.has(sessionId);
  }

  /** Plugin long-poll: wait until a fetch job is available. */
  waitForJob(sessionId: string, waitMs = 25000): Promise<FetchJob | null> {
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

  private enqueue(job: FetchJob): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(job);
      return;
    }
    this.queue.push(job);
  }

  private requirePlugin(): void {
    if (!this.pluginConnected) {
      throw new Error('即时设计插件未连接。请在桌面端打开本插件并点击「连接」。');
    }
  }

  /** MCP asks plugin to export a node. */
  fetchNode(
    nodeId: string,
    meta?: { fileKey?: string; pageId?: string; url?: string }
  ): Promise<DesignPayload> {
    if (!this.pluginConnected) {
      return Promise.reject(
        new Error('即时设计插件未连接。请在桌面端打开本插件并点击「连接」。')
      );
    }

    const requestId = randomUUID();
    const metaObj = (meta || {}) as Record<string, unknown>;

    return new Promise<DesignPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPayload.delete(requestId);
        reject(
          new Error(
            `拉取节点超时（${this.timeoutMs}ms）。请确认插件保持打开且已连接，文件中存在节点 ${nodeId}。`
          )
        );
      }, this.timeoutMs);

      this.pendingPayload.set(requestId, { resolve, reject, timer });
      this.enqueue({ requestId, kind: 'payload', nodeId, meta: metaObj });
    });
  }

  /**
   * MCP asks plugin to export assets on demand.
   * nodeIds 走节点切图/图片填充，refs 直接按图片 hash 取字节。
   */
  fetchAssets(req: {
    nodeIds?: string[];
    refs?: string[];
  }): Promise<AssetManifestItem[]> {
    try {
      this.requirePlugin();
    } catch (err) {
      return Promise.reject(err);
    }

    const nodeIds = req.nodeIds || [];
    const refs = req.refs || [];
    if (nodeIds.length === 0 && refs.length === 0) {
      return Promise.reject(new Error('需要 nodeIds 或 refs 至少一项。'));
    }

    const requestId = randomUUID();

    return new Promise<AssetManifestItem[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAssets.delete(requestId);
        this.uploaded.delete(requestId);
        reject(
          new Error(
            `按需切图超时（${this.assetTimeoutMs}ms）。请确认插件保持打开且已连接。`
          )
        );
      }, this.assetTimeoutMs);

      this.pendingAssets.set(requestId, { resolve, reject, timer });
      this.enqueue({ requestId, kind: 'assets', nodeIds, refs, meta: {} });
    });
  }

  /**
   * 登记本次任务的资产：直传项在 /plugin/asset-bin 登记，兜底 base64 项在 /plugin/result 登记。
   * 同一 key/路径重复登记直接忽略（插件会把直传项原样回传一次）。
   */
  addAssetResult(requestId: string, item: AssetManifestItem): void {
    if (!requestId) return;
    const list = this.uploaded.get(requestId) || [];
    const exists = list.some(
      (existing) =>
        existing.path === item.path || Boolean(item.key && existing.key === item.key)
    );
    if (exists) return;
    list.push(item);
    this.uploaded.set(requestId, list);
  }

  completePayload(
    requestId: string,
    result: { ok: true; payload: DesignPayload } | { ok: false; error: string }
  ): boolean {
    const pending = this.pendingPayload.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPayload.delete(requestId);

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

  completeAssets(
    requestId: string,
    result: { ok: true } | { ok: false; error: string }
  ): boolean {
    const pending = this.pendingAssets.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingAssets.delete(requestId);
    const items = this.uploaded.get(requestId) || [];
    this.uploaded.delete(requestId);

    if (!result.ok) {
      pending.reject(new Error(result.error || '插件返回失败'));
      return true;
    }
    pending.resolve(items);
    return true;
  }
}
