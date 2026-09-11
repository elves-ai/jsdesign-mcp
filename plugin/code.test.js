const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('./code.js');

describe('export policy', () => {
  it('does not exportAsync SVG for decorative ellipses and lines', () => {
    assert.equal(plugin.shouldExportSvg({ type: 'ELLIPSE', width: 20, height: 20 }), false);
    assert.equal(plugin.shouldExportSvg({ type: 'LINE', width: 80, height: 0 }), false);
    assert.equal(plugin.shouldExportSvg({ type: 'STAR', width: 16, height: 16 }), false);
  });

  it('exports small vectors and boolean operations', () => {
    assert.equal(plugin.shouldExportSvg({ type: 'VECTOR', width: 24, height: 24 }), true);
    assert.equal(
      plugin.shouldExportSvg({ type: 'BOOLEAN_OPERATION', width: 32, height: 32 }),
      true
    );
  });

  it('skips large decorative vectors', () => {
    assert.equal(plugin.shouldExportSvg({ type: 'VECTOR', width: 800, height: 600 }), false);
  });

  it('skips huge root PNG preview', () => {
    assert.equal(plugin.shouldExportRootPreview({ width: 4000, height: 3000 }), false);
    assert.equal(plugin.shouldExportRootPreview({ width: 800, height: 600 }), true);
  });
});
