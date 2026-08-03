import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AssetManifestItem, DesignPayload } from './types.js';
import { isDesignPayload } from './types.js';
import { materializePayloadAssets } from './assets.js';

export function defaultStoreDir(): string {
  return path.join(os.homedir(), '.jsdesign-mcp');
}

export class DesignStore {
  private payload: DesignPayload | null = null;
  private assets: AssetManifestItem[] = [];
  private readonly dir: string;
  private readonly filePath: string;
  private readonly assetsDir: string;
  private readonly assetsManifestPath: string;

  constructor(dir: string = defaultStoreDir()) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, 'latest.json');
    this.assetsDir = path.join(dir, 'assets');
    this.assetsManifestPath = path.join(dir, 'assets.json');
    fs.mkdirSync(this.assetsDir, { recursive: true });
    this.loadFromDisk();
  }

  get(): DesignPayload | null {
    return this.payload;
  }

  getAssets(): AssetManifestItem[] {
    return this.assets;
  }

  getAssetsDir(): string {
    return this.assetsDir;
  }

  set(payload: DesignPayload): void {
    const { payload: cleaned, assets } = materializePayloadAssets(
      payload,
      this.assetsDir
    );
    this.payload = cleaned;
    this.assets = assets;
    fs.writeFileSync(this.filePath, JSON.stringify(cleaned, null, 2), 'utf8');
    fs.writeFileSync(
      this.assetsManifestPath,
      JSON.stringify({ assetsDir: this.assetsDir, assets }, null, 2),
      'utf8'
    );
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (isDesignPayload(raw)) {
        this.payload = raw;
        this.assets = Array.isArray(raw.meta.assets) ? raw.meta.assets : [];
      }
    } catch {
      // ignore corrupt cache
    }

    if (this.assets.length === 0 && fs.existsSync(this.assetsManifestPath)) {
      try {
        const manifest = JSON.parse(
          fs.readFileSync(this.assetsManifestPath, 'utf8')
        ) as { assets?: AssetManifestItem[] };
        if (Array.isArray(manifest.assets)) this.assets = manifest.assets;
      } catch {
        // ignore
      }
    }
  }
}
