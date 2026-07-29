// JsDesign → Cursor MCP exporter (runs in JsDesign host)

var MAX_NODES = 2000;

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
  if (!fills || !Array.isArray(fills)) return [];
  var out = [];
  for (var i = 0; i < fills.length; i++) {
    var fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type === 'SOLID') {
      var c = solidColor(fill);
      if (c) out.push(c);
    } else if (fill.type === 'IMAGE') {
      out.push({
        type: 'IMAGE',
        ref: fill.imageHash || undefined,
        scaleMode: fill.scaleMode,
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
            position: stop.position,
          };
        }),
      });
    } else {
      out.push({ type: fill.type });
    }
  }
  return out;
}

function extractStrokes(node) {
  if (!node.strokes || !Array.isArray(node.strokes) || node.strokes.length === 0) {
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
  if (!node.layoutMode || node.layoutMode === 'NONE') return undefined;
  return {
    mode: node.layoutMode,
    gap: node.itemSpacing,
    padding: {
      top: node.paddingTop || 0,
      right: node.paddingRight || 0,
      bottom: node.paddingBottom || 0,
      left: node.paddingLeft || 0,
    },
    align: node.counterAxisAlignItems,
    justify: node.primaryAxisAlignItems,
  };
}

function extractText(node) {
  if (node.type !== 'TEXT') return undefined;
  var color;
  if (node.fills && node.fills.length) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].visible === false) continue;
      var c = solidColor(node.fills[i]);
      if (c) {
        color = c.color;
        break;
      }
    }
  }
  var fontFamily;
  if (node.fontName && typeof node.fontName === 'object') {
    fontFamily = node.fontName.family;
  }
  return {
    characters: node.characters || '',
    fontSize: typeof node.fontSize === 'number' ? node.fontSize : undefined,
    fontFamily: fontFamily,
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
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

  if (typeof node.cornerRadius === 'number') {
    data.cornerRadius = node.cornerRadius;
  } else if (
    typeof node.topLeftRadius === 'number' ||
    typeof node.topRightRadius === 'number'
  ) {
    data.cornerRadius = [
      node.topLeftRadius || 0,
      node.topRightRadius || 0,
      node.bottomRightRadius || 0,
      node.bottomLeftRadius || 0,
    ];
  }

  if (typeof node.opacity === 'number' && node.opacity !== 1) {
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

jsDesign.showUI(__html__, { width: 360, height: 280 });

jsDesign.ui.onmessage = function (msg) {
  if (!msg || msg.type !== 'export-selection') return;

  var selection = jsDesign.currentPage.selection;
  if (!selection || selection.length === 0) {
    jsDesign.ui.postMessage({
      type: 'error',
      message: '请先选中一个 Frame 或节点',
    });
    return;
  }

  var root = null;
  for (var i = 0; i < selection.length; i++) {
    if (selection[i].type === 'FRAME') {
      root = selection[i];
      break;
    }
  }
  if (!root) root = selection[0];

  var state = { count: 0, truncated: false };
  var node = normalizeNode(root, state);
  if (!node) {
    jsDesign.ui.postMessage({
      type: 'error',
      message: '导出失败：节点为空或已超过限制',
    });
    return;
  }

  var payload = {
    meta: {
      pageName: jsDesign.currentPage.name,
      exportedAt: new Date().toISOString(),
      truncated: state.truncated,
    },
    tokens: collectTokens(node),
    root: node,
  };

  try {
    if (jsDesign.root && jsDesign.root.name) {
      payload.meta.fileName = jsDesign.root.name;
    }
  } catch (e) {
    // optional fileName
  }

  jsDesign.ui.postMessage({ type: 'selection-payload', data: payload });
};
