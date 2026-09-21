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

  it('mcp and preview never call host exportAsync', () => {
    assert.equal(plugin.resolveExportMode({ mode: 'mcp' }), 'mcp');
    assert.equal(plugin.resolveExportMode({ assets: false, light: true }), 'preview');
    assert.equal(plugin.shouldCollectHostExport('mcp'), false);
    assert.equal(plugin.shouldCollectHostExport('preview'), false);
    assert.equal(plugin.shouldCollectHostExport('full'), true);
  });

  it('无显式 mode 时兜底 mcp，不自动打开整树切图', () => {
    assert.equal(plugin.resolveExportMode({}), 'mcp');
    assert.equal(plugin.resolveExportMode(), 'mcp');
  });
});

describe('按需切图', () => {
  it('图片填充节点按 hash 取字节，不切图', () => {
    const plan = plugin.planAssetRequest({
      id: '1:2',
      name: 'Photo',
      type: 'RECTANGLE',
      width: 320,
      height: 200,
      fills: [{ type: 'IMAGE', imageHash: 'hash-abc' }],
    });
    assert.equal(plan.method, 'image');
    assert.equal(plan.key, 'hash-abc');
    assert.equal(plan.field, 'image');
  });

  it('只有图标类走 SVG，其余默认 PNG', () => {
    const iconByName = {
      id: '3:1',
      name: 'icon_close',
      type: 'VECTOR',
      width: 24,
      height: 24,
      fills: [],
      children: [],
    };
    assert.equal(plugin.planAssetRequest(iconByName).method, 'svg');

    // 小尺寸纯矢量（无命名）按图标处理
    const smallVector = {
      id: '3:2',
      name: 'Vector 12',
      type: 'VECTOR',
      width: 20,
      height: 20,
      fills: [],
      children: [],
    };
    assert.equal(plugin.planAssetRequest(smallVector).method, 'svg');

    // 非图标的框、装饰图形、大节点一律 PNG
    const cases = [
      { id: '6:1', name: 'btn', type: 'FRAME', width: 120, height: 40, fills: [], children: [{ id: '6:2', type: 'TEXT', width: 40, height: 16, fills: [], children: [] }] },
      { id: '7:1', name: 'dot', type: 'RECTANGLE', width: 24, height: 24, fills: [], children: [] },
      { id: '7:2', name: 'card', type: 'FRAME', width: 320, height: 200, fills: [], children: [] },
      { id: '9:9', name: 'hero', type: 'FRAME', width: 4000, height: 3000, fills: [], children: [] },
    ];
    for (const node of cases) {
      assert.equal(plugin.planAssetRequest(node).method, 'png', `${node.name} 应该走 PNG`);
    }
  });

  it('尊重设计稿里的导出设置：SVG 给 SVG，PNG/Webp 不改成 SVG', () => {
    const svgSetting = {
      id: '8:1',
      name: 'chart',
      type: 'FRAME',
      width: 300,
      height: 200,
      fills: [],
      exportSettings: [{ format: 'SVG' }],
      children: [],
    };
    assert.equal(plugin.planAssetRequest(svgSetting).method, 'svg');

    const pngSetting = {
      id: '8:2',
      name: 'icon_x',
      type: 'FRAME',
      width: 24,
      height: 24,
      fills: [],
      exportSettings: [{ format: 'PNG' }],
      children: [{ id: '8:3', type: 'VECTOR', width: 20, height: 20, fills: [], children: [] }],
    };
    assert.equal(plugin.planAssetRequest(pngSetting).method, 'png');

    // 官方文档里 Webp 的字面量是 'Webp'，大小写不该影响判断
    const webpSetting = {
      id: '8:4',
      name: 'icon_y',
      type: 'FRAME',
      width: 24,
      height: 24,
      fills: [],
      exportSettings: [{ format: 'Webp' }],
      children: [{ id: '8:5', type: 'VECTOR', width: 20, height: 20, fills: [], children: [] }],
    };
    assert.equal(plugin.planAssetRequest(webpSetting).method, 'png');
  });

  it('超过像素预算时按 scale 降采样，预算内不加约束', () => {
    assert.equal(plugin.slicePixelConstraint({ width: 300, height: 200 }), undefined);
    const constraint = plugin.slicePixelConstraint({ width: 4000, height: 3000 });
    assert.ok(constraint);
    assert.equal(constraint.type, 'SCALE');
    assert.ok(constraint.value < 1);
    assert.ok(4000 * 3000 * constraint.value * constraint.value <= 4 * 1024 * 1024 + 1);
  });

  it('直传 query 带齐元信息并做 URL 编码', () => {
    const query = plugin.buildAssetQuery('req-1', {
      key: 'abc',
      nodeName: '图标 A',
      field: 'slice',
      kind: 'icon_slice',
      mimeType: 'image/svg+xml',
      byteLength: 512,
    });
    assert.match(query, /^requestId=req-1&/);
    assert.match(query, /nodeName=%E5%9B%BE%E6%A0%87%20A/);
    assert.match(query, /mime=image%2Fsvg%2Bxml/);
    assert.match(query, /byteLength=512/);
  });

  it('宿主无 jsDesign.fetch 时能识别，toUint8 兼容多种字节形态', () => {
    assert.equal(plugin.hasHostFetch(), false);
    assert.equal(plugin.toUint8([1, 2, 3]).length, 3);
    assert.equal(plugin.toUint8(new Uint8Array([1, 2, 3])).byteLength, 3);
    assert.equal(plugin.toUint8(null), undefined);
  });
});

describe('fileName 取值优先级', () => {
  it('宿主可读名压过链接里的 fileKey', () => {
    assert.equal(
      plugin.resolveFileName({ fileKey: 'pEgzR6' }, { rootName: '临沂大屏', fileKey: 'pEgzR6' }),
      '临沂大屏'
    );
  });

  it('宿主机读不到名字时退回 fileKey，再退回链接里的 fileKey', () => {
    assert.equal(plugin.resolveFileName({ fileKey: 'pEgzR6' }, { fileKey: 'hostKey' }), 'hostKey');
    assert.equal(plugin.resolveFileName({ fileKey: 'pEgzR6' }, {}), 'pEgzR6');
  });

  it('没有元信息时不产出 fileName', () => {
    assert.equal(plugin.resolveFileName(undefined, {}), undefined);
    assert.equal(plugin.resolveFileName({}, {}), undefined);
  });

  it('无宿主环境下不抛错（Node 里 jsDesign 未定义）', () => {
    assert.equal(plugin.resolveFileName({ fileKey: 'pEgzR6' }), 'pEgzR6');
    assert.equal(plugin.resolveFileName(), undefined);
  });
});
