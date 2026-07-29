// JsDesign → Cursor MCP exporter (runs in JsDesign host)

var MAX_NODES = 2000;

function isMixed(v) {
  try {
    return typeof v === 'symbol' || v === jsDesign.mixed;
  } catch (e) {
    return typeof v === 'symbol';
  }
}

/** Strip symbols / non-cloneable values before ui.postMessage */
function toJsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, function (_key, v) {
      if (typeof v === 'symbol' || typeof v === 'undefined' || typeof v === 'function') {
        return undefined;
      }
      return v;
    })
  );
}

function safeNumber(v) {
  return typeof v === 'number' && !isNaN(v) ? v : undefined;
}

function safeString(v) {
  return typeof v === 'string' ? v : undefined;
}

function rgbToHex(r, g, b) {
  function h(v) {
    var s = Math.round(v * 255).toString(16);
    return s.length === 1 ? '0' + s : s;
  }
  return '#' + h(r) + h(g) + h(b);
}

function solidColor(paint) {
  if (!paint || paint.type !== 'SOLID' || !paint.color) return null;
  return {
    type: 'SOLID',
    color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
    opacity: paint.opacity !== undefined ? paint.opacity : 1,
  };
}

function extractFills(fills) {
  if (isMixed(fills) || !fills || !Array.isArray(fills)) return [];
  var out = [];
  for (var i = 0; i < fills.length; i++) {
    var fill = fills[i];
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID') {
      var c = solidColor(fill);
      if (c) out.push(c);
    } else if (fill.type === 'IMAGE') {
      out.push({
        type: 'IMAGE',
        ref: safeString(fill.imageHash),
        scaleMode: safeString(fill.scaleMode),
      });
    } else if (
      fill.type === 'GRADIENT_LINEAR' ||
      fill.type === 'GRADIENT_RADIAL'
    ) {
      out.push({
        type: fill.type,
        gradientStops: (fill.gradientStops || []).map(function (stop) {
          return {
            color: rgbToHex(stop.color.r, stop.color.g, stop.color.b),
            position: safeNumber(stop.position),
          };
        }),
      });
    } else if (fill.type) {
      out.push({ type: String(fill.type) });
    }
  }
  return out;
}

function extractStrokes(node) {
  if (
    isMixed(node.strokes) ||
    !node.strokes ||
    !Array.isArray(node.strokes) ||
    node.strokes.length === 0
  ) {
    return undefined;
  }
  var strokes = [];
  for (var i = 0; i < node.strokes.length; i++) {
    var s = node.strokes[i];
    if (s.visible === false) continue;
    var c = solidColor(s);
    if (c) {
      c.weight = node.strokeWeight || 0;
      c.align = node.strokeAlign || 'INSIDE';
      strokes.push(c);
    } else if (s.type) {
      strokes.push({ type: s.type, weight: node.strokeWeight || 0 });
    }
  }
  return strokes.length ? strokes : undefined;
}

function extractLayout(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE' || isMixed(node.layoutMode)) {
    return undefined;
  }
  return {
    mode: String(node.layoutMode),
    gap: safeNumber(node.itemSpacing),
    padding: {
      top: safeNumber(node.paddingTop) || 0,
      right: safeNumber(node.paddingRight) || 0,
      bottom: safeNumber(node.paddingBottom) || 0,
      left: safeNumber(node.paddingLeft) || 0,
    },
    align: isMixed(node.counterAxisAlignItems)
      ? undefined
      : safeString(node.counterAxisAlignItems) || node.counterAxisAlignItems,
    justify: isMixed(node.primaryAxisAlignItems)
      ? undefined
      : safeString(node.primaryAxisAlignItems) || node.primaryAxisAlignItems,
  };
}

function extractText(node) {
  if (node.type !== 'TEXT') return undefined;
  var color;
  var fills = node.fills;
  if (!isMixed(fills) && fills && fills.length) {
    for (var i = 0; i < fills.length; i++) {
      if (fills[i].visible === false) continue;
      var c = solidColor(fills[i]);
      if (c) {
        color = c.color;
        break;
      }
    }
  }
  var fontFamily;
  var fontName = node.fontName;
  if (!isMixed(fontName) && fontName && typeof fontName === 'object') {
    fontFamily = safeString(fontName.family);
  }
  var lineHeight;
  var lh = node.lineHeight;
  if (!isMixed(lh)) {
    if (typeof lh === 'number') lineHeight = lh;
    else if (lh && typeof lh === 'object') {
      lineHeight = {
        unit: safeString(lh.unit),
        value: safeNumber(lh.value),
      };
    }
  }
  var fontWeight = node.fontWeight;
  if (isMixed(fontWeight)) fontWeight = undefined;

  return {
    characters: safeString(node.characters) || '',
    fontSize: safeNumber(node.fontSize),
    fontFamily: fontFamily,
    fontWeight: typeof fontWeight === 'number' || typeof fontWeight === 'string'
      ? fontWeight
      : undefined,
    lineHeight: lineHeight,
    color: color,
  };
}

function extractImage(node, fills) {
  if (!fills) return undefined;
  for (var i = 0; i < fills.length; i++) {
    if (fills[i].type === 'IMAGE') {
      return { ref: fills[i].ref };
    }
  }
  return undefined;
}

function normalizeNode(node, state) {
  state.count += 1;
  if (state.count > MAX_NODES) {
    state.truncated = true;
    return null;
  }

  var fills = extractFills(node.fills);
  var data = {
    id: String(node.id),
    name: node.name || 'Untitled',
    type: node.type || 'UNKNOWN',
    box: {
      x: typeof node.x === 'number' ? node.x : 0,
      y: typeof node.y === 'number' ? node.y : 0,
      w: typeof node.width === 'number' ? node.width : 0,
      h: typeof node.height === 'number' ? node.height : 0,
    },
    children: [],
  };

  var layout = extractLayout(node);
  if (layout) data.layout = layout;

  if (fills.length) data.fills = fills;

  var strokes = extractStrokes(node);
  if (strokes) data.strokes = strokes;

  if (!isMixed(node.cornerRadius) && typeof node.cornerRadius === 'number') {
    data.cornerRadius = node.cornerRadius;
  } else if (
    typeof node.topLeftRadius === 'number' ||
    typeof node.topRightRadius === 'number'
  ) {
    data.cornerRadius = [
      safeNumber(node.topLeftRadius) || 0,
      safeNumber(node.topRightRadius) || 0,
      safeNumber(node.bottomRightRadius) || 0,
      safeNumber(node.bottomLeftRadius) || 0,
    ];
  }

  if (!isMixed(node.opacity) && typeof node.opacity === 'number' && node.opacity !== 1) {
    data.opacity = node.opacity;
  }

  var text = extractText(node);
  if (text) data.text = text;

  var image = extractImage(node, fills);
  if (image) data.image = image;

  if ('children' in node && node.children && node.children.length > 0) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (child.visible === false) continue;
      var normalized = normalizeNode(child, state);
      if (normalized) data.children.push(normalized);
      if (state.truncated) break;
    }
  }

  return data;
}

function collectTokens(root) {
  var colors = {};
  var fontSizes = {};
  var fontFamilies = {};
  var radii = {};
  var spacings = {};

  function addColor(hex) {
    if (hex) colors[hex] = true;
  }

  function walk(node) {
    if (node.fills) {
      for (var i = 0; i < node.fills.length; i++) {
        var f = node.fills[i];
        if (f.type === 'SOLID' && f.color) addColor(f.color);
      }
    }
    if (node.strokes) {
      for (var j = 0; j < node.strokes.length; j++) {
        if (node.strokes[j].color) addColor(node.strokes[j].color);
      }
    }
    if (node.text) {
      if (node.text.color) addColor(node.text.color);
      if (typeof node.text.fontSize === 'number') {
        fontSizes[node.text.fontSize] = true;
      }
      if (node.text.fontFamily) fontFamilies[node.text.fontFamily] = true;
    }
    if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
      radii[node.cornerRadius] = true;
    } else if (Array.isArray(node.cornerRadius)) {
      for (var r = 0; r < node.cornerRadius.length; r++) {
        if (node.cornerRadius[r] > 0) radii[node.cornerRadius[r]] = true;
      }
    }
    if (node.layout) {
      if (typeof node.layout.gap === 'number' && node.layout.gap > 0) {
        spacings[node.layout.gap] = true;
      }
      if (node.layout.padding) {
        var p = node.layout.padding;
        if (p.top > 0) spacings[p.top] = true;
        if (p.right > 0) spacings[p.right] = true;
        if (p.bottom > 0) spacings[p.bottom] = true;
        if (p.left > 0) spacings[p.left] = true;
      }
    }
    for (var c = 0; c < node.children.length; c++) walk(node.children[c]);
  }

  walk(root);

  function sortedNums(obj) {
    return Object.keys(obj)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
  }

  return {
    colors: Object.keys(colors).sort(),
    fontSizes: sortedNums(fontSizes),
    fontFamilies: Object.keys(fontFamilies).sort(),
    radii: sortedNums(radii),
    spacings: sortedNums(spacings),
  };
}

function resolveNode(nodeId) {
  if (!nodeId) return null;
  var candidates = [nodeId];
  if (nodeId.indexOf(':') >= 0) candidates.push(nodeId.replace(/:/g, '-'));
  if (nodeId.indexOf('-') >= 0) candidates.push(nodeId.replace(/-/g, ':'));

  for (var i = 0; i < candidates.length; i++) {
    try {
      var n = jsDesign.getNodeById(candidates[i]);
      if (n) return n;
    } catch (e) {
      // try next
    }
  }
  return null;
}

function buildPayloadFromNode(root, meta) {
  var state = { count: 0, truncated: false };
  var node = normalizeNode(root, state);
  if (!node) return null;

  var payload = {
    meta: {
      pageName: jsDesign.currentPage.name,
      exportedAt: new Date().toISOString(),
      truncated: state.truncated,
      fileName: (meta && meta.fileKey) || undefined,
    },
    tokens: collectTokens(node),
    root: node,
  };

  try {
    if (jsDesign.root && jsDesign.root.name) {
      payload.meta.fileName = payload.meta.fileName || jsDesign.root.name;
    }
    if (jsDesign.fileKey) {
      payload.meta.fileName = payload.meta.fileName || jsDesign.fileKey;
    }
  } catch (e) {
    // optional
  }

  return toJsonSafe(payload);
}

function publishSelectionPreview() {
  var selection = jsDesign.currentPage.selection;
  if (!selection || selection.length === 0) {
    jsDesign.ui.postMessage({
      type: 'selection-preview',
      ok: false,
      message: '未选中元素。在画布点击图层后，这里会显示 JSON。',
    });
    return;
  }

  // Prefer FRAME in multi-select; otherwise first selected
  var root = null;
  for (var i = 0; i < selection.length; i++) {
    if (selection[i].type === 'FRAME') {
      root = selection[i];
      break;
    }
  }
  if (!root) root = selection[0];

  try {
    var payload = buildPayloadFromNode(root, {});
    if (!payload) {
      jsDesign.ui.postMessage({
        type: 'selection-preview',
        ok: false,
        message: '无法导出当前选中节点',
      });
      return;
    }
    jsDesign.ui.postMessage({
      type: 'selection-preview',
      ok: true,
      nodeId: String(root.id),
      nodeName: root.name || '',
      nodeType: root.type || '',
      payload: payload,
    });
  } catch (err) {
    jsDesign.ui.postMessage({
      type: 'selection-preview',
      ok: false,
      message: (err && err.message) || String(err),
    });
  }
}

jsDesign.showUI(__html__, { width: 420, height: 560 });

jsDesign.on('selectionchange', publishSelectionPreview);
publishSelectionPreview();

jsDesign.ui.onmessage = function (msg) {
  if (!msg) return;

  if (msg.type === 'refresh-selection') {
    publishSelectionPreview();
    return;
  }

  if (msg.type !== 'fetch-node') return;

  var requestId = msg.requestId;
  var nodeId = msg.nodeId;
  var meta = msg.meta || {};

  try {
    var root = resolveNode(nodeId);
    if (!root) {
      jsDesign.ui.postMessage({
        type: 'fetch-node-result',
        requestId: requestId,
        ok: false,
        error: '找不到节点 ' + nodeId + '。请确认链接来自当前打开的文件，且 linkelement 有效。',
      });
      return;
    }

    var payload = buildPayloadFromNode(root, meta);
    if (!payload) {
      jsDesign.ui.postMessage({
        type: 'fetch-node-result',
        requestId: requestId,
        ok: false,
        error: '导出节点失败',
      });
      return;
    }

    jsDesign.ui.postMessage({
      type: 'fetch-node-result',
      requestId: requestId,
      ok: true,
      payload: payload,
    });
  } catch (err) {
    jsDesign.ui.postMessage({
      type: 'fetch-node-result',
      requestId: requestId,
      ok: false,
      error: (err && err.message) || String(err),
    });
  }
};
