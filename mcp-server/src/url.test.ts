import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNodeId, parseJsDesignUrl } from './url.js';

describe('parseJsDesignUrl', () => {
  it('parses linkelement from editor url', () => {
    const link = parseJsDesignUrl(
      'https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142'
    );
    assert.ok(link);
    assert.equal(link!.fileKey, 'tFH0Pj');
    assert.equal(link!.pageId, 'jku4Hd4Ps7');
    assert.equal(link!.linkElement, '82-2142');
    assert.equal(link!.nodeId, '82:2142');
  });

  it('accepts bare node id', () => {
    const link = parseJsDesignUrl('82:2142');
    assert.ok(link);
    assert.equal(link!.nodeId, '82:2142');
  });

  it('normalizes hyphen id', () => {
    assert.equal(normalizeNodeId('82-2142'), '82:2142');
    assert.equal(normalizeNodeId('82:2142'), '82:2142');
  });

  it('returns null without linkelement', () => {
    assert.equal(
      parseJsDesignUrl('https://js.design/f/tFH0Pj?p=jku4Hd4Ps7'),
      null
    );
  });
});
