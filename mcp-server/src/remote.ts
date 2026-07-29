import type { DesignPayload } from './types.js';
import { isDesignPayload } from './types.js';
import type { DesignStore } from './store.js';
import type { PluginBridge } from './bridge.js';
import { DEFAULT_HTTP_PORT } from './http.js';

export function bridgeBase(port = DEFAULT_HTTP_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export async function fetchHealth(port = DEFAULT_HTTP_PORT) {
  const res = await fetch(`${bridgeBase(port)}/health`);
  if (!res.ok) throw new Error(`health HTTP ${res.status}`);
  return (await res.json()) as {
    ok: boolean;
    pluginConnected: boolean;
    connectionCount: number;
    hasData: boolean;
    rootName: string | null;
  };
}

export async function fetchLatest(
  port = DEFAULT_HTTP_PORT
): Promise<DesignPayload | null> {
  try {
    const res = await fetch(`${bridgeBase(port)}/internal/latest`);
    if (!res.ok) return null;
    const body = (await res.json()) as { payload?: unknown };
    return isDesignPayload(body.payload) ? body.payload : null;
  } catch {
    return null;
  }
}

export function createRemoteToolContext(
  port: number,
  localStore: DesignStore
): { store: DesignStore; bridge: PluginBridge } {
  const bridge = {
    get pluginConnected() {
      return false; // refreshed via health in get_plugin_status path
    },
    get connectionCount() {
      return 0;
    },
    async fetchNode(
      nodeId: string,
      meta?: { fileKey?: string; pageId?: string; url?: string }
    ) {
      const res = await fetch(`${bridgeBase(port)}/internal/fetch-node`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId, meta }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        payload?: unknown;
        error?: string;
      };
      if (!res.ok || !body.ok || !isDesignPayload(body.payload)) {
        throw new Error(body.error || `bridge error HTTP ${res.status}`);
      }
      localStore.set(body.payload);
      return body.payload;
    },
  } as PluginBridge;

  const store = {
    get: () => localStore.get(),
    set: (p: DesignPayload) => localStore.set(p),
  } as DesignStore;

  return { store, bridge };
}
