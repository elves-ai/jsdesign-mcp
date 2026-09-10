import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldExitIdleBridge } from './server.js';

describe('shouldExitIdleBridge', () => {
  it('does not exit when idle is disabled', () => {
    assert.equal(
      shouldExitIdleBridge({
        idleMs: 0,
        now: 10_000,
        lastActivityAt: 0,
        pluginConnected: false,
      }),
      false
    );
  });

  it('does not exit while plugin is connected', () => {
    assert.equal(
      shouldExitIdleBridge({
        idleMs: 1000,
        now: 10_000,
        lastActivityAt: 0,
        pluginConnected: true,
      }),
      false
    );
  });

  it('does not exit before idle window', () => {
    assert.equal(
      shouldExitIdleBridge({
        idleMs: 5000,
        now: 4999,
        lastActivityAt: 0,
        pluginConnected: false,
      }),
      false
    );
  });

  it('exits after idle window with no plugin', () => {
    assert.equal(
      shouldExitIdleBridge({
        idleMs: 5000,
        now: 5000,
        lastActivityAt: 0,
        pluginConnected: false,
      }),
      true
    );
  });
});
