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
