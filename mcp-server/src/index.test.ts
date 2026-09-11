import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('MCP entry', () => {
  it('does not spawn a detached bridge process', () => {
    const compiled = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'index.js'),
      'utf8'
    );
    assert.doesNotMatch(compiled, /ensureBridge/);
    assert.doesNotMatch(compiled, /detached:\s*true/);
  });
});
