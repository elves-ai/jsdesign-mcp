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

function colorFromRGBA(color) {
  if (!color) return undefined;
  var out = {
    color: rgbToHex(color.r, color.g, color.b),
  };
  if (typeof color.a === 'number' && color.a !== 1) {
    out.opacity = color.a;
  }
  return out;
}

function solidColor(paint) {
  if (!paint || !paint.color) return null;
  var type = paint.type ? String(paint.type).toUpperCase() : '';
  // TEXT 默认色多为 SOLID；部分实例节点可能省略 type，但仍带 rgb
  if (type && type !== 'SOLID') return null;
  if (
    typeof paint.color.r !== 'number' ||
    typeof paint.color.g !== 'number' ||
    typeof paint.color.b !== 'number'
  ) {
    return null;
  }
  var opacity = 1;
  if (typeof paint.opacity === 'number') opacity = paint.opacity;
  else if (typeof paint.color.a === 'number') opacity = paint.color.a;
  return {
    type: 'SOLID',
    color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
    opacity: opacity,
  };
}

/** 从 fills 数组取首个可见纯色 */
function firstSolidFromFills(fills) {
  if (isMixed(fills) || !fills || !Array.isArray(fills)) return null;
  for (var i = 0; i < fills.length; i++) {
    if (fills[i] && fills[i].visible === false) continue;
    var c = solidColor(fills[i]);
    if (c) return c;
  }
  return null;
}

/**
 * TEXT 的 node.fills 在组件实例 / 多样式时经常是 mixed 或空数组，
 * 需回退到 getRangeFills / getStyledTextSegments / 主组件对应节点。
 */
function resolveTextFills(node) {
  var fills = node.fills;
  if (!isMixed(fills) && fills && Array.isArray(fills) && fills.length > 0) {
    return fills;
  }

  var len = 0;
  try {
    len = (node.characters && String(node.characters).length) || 0;
  } catch (e0) {
    len = 0;
  }

  if (len > 0 && typeof node.getRangeFills === 'function') {
    try {
      var rangeFills = node.getRangeFills(0, 1);
      if (!isMixed(rangeFills) && rangeFills && rangeFills.length > 0) {
        return rangeFills;
      }
    } catch (e1) {
      // ignore
    }
    try {
      var allRange = node.getRangeFills(0, len);
      if (!isMixed(allRange) && allRange && allRange.length > 0) {
        return allRange;
      }
    } catch (e2) {
      // ignore
    }
  }

  if (typeof node.getStyledTextSegments === 'function') {
    try {
      var segments = node.getStyledTextSegments(['fills']);
      if (segments && segments.length) {
        for (var s = 0; s < segments.length; s++) {
          var segFills = segments[s] && segments[s].fills;
          if (!isMixed(segFills) && segFills && segFills.length > 0) {
            return segFills;
          }
        }
      }
    } catch (e3) {
      // ignore
    }
  }

  // 实例内文本：尝试从 mainComponent 同源节点取 fills
  try {
    var parent = node.parent;
    while (parent && parent.type !== 'INSTANCE') {
      parent = parent.parent;
    }
    if (parent && parent.mainComponent && typeof parent.mainComponent.findOne === 'function') {
      var suffix = String(node.id).split(';').pop();
      if (suffix) {
        var mainText = parent.mainComponent.findOne(function (n) {
          return n && n.type === 'TEXT' && (n.id === suffix || String(n.id).indexOf(suffix) !== -1);
        });
        if (mainText) {
          var mainFills = mainText.fills;
          if (!isMixed(mainFills) && mainFills && mainFills.length > 0) {
            return mainFills;
          }
          if (typeof mainText.getRangeFills === 'function') {
            var mf = mainText.getRangeFills(0, 1);
            if (!isMixed(mf) && mf && mf.length > 0) return mf;
          }
        }
      }
    }
  } catch (e4) {
    // ignore
  }

  if (!isMixed(fills) && Array.isArray(fills)) return fills;
  return [];
}

function extractGradientStops(stops) {
  return (stops || []).map(function (stop) {
    var item = {
      color: rgbToHex(stop.color.r, stop.color.g, stop.color.b),
      position: safeNumber(stop.position),
    };
    if (typeof stop.color.a === 'number' && stop.color.a !== 1) {
      item.opacity = stop.color.a;
    }
    return item;
  });
}

function extractPaint(paint) {
  if (!paint || paint.visible === false) return null;
  var paintType = paint.type ? String(paint.type).toUpperCase() : '';
  if (!paintType || paintType === 'SOLID') {
    var solid = solidColor(paint);
    if (solid) return solid;
    if (paintType === 'SOLID') return null;
  }
  if (paint.type === 'IMAGE') {
    return {
      type: 'IMAGE',
      ref: safeString(paint.imageHash),
      scaleMode: safeString(paint.scaleMode),
      opacity: paint.opacity !== undefined ? paint.opacity : undefined,
    };
  }
  if (
    paint.type === 'GRADIENT_LINEAR' ||
    paint.type === 'GRADIENT_RADIAL' ||
    paint.type === 'GRADIENT_ANGULAR'
  ) {
    return {
      type: paint.type,
      gradientStops: extractGradientStops(paint.gradientStops),
      opacity: paint.opacity !== undefined ? paint.opacity : undefined,
    };
  }
  if (paint.type) {
    return { type: String(paint.type) };
  }
  return null;
}

function extractFills(fills) {
  if (isMixed(fills) || !fills || !Array.isArray(fills)) return [];
  var out = [];
  for (var i = 0; i < fills.length; i++) {
    var item = extractPaint(fills[i]);
    if (item) out.push(item);
  }
  return out;
}

function strokeWeightInfo(node) {
  var weight = safeNumber(node.strokeWeight);
  var top = safeNumber(node.strokeTopWeight);
  var right = safeNumber(node.strokeRightWeight);
  var bottom = safeNumber(node.strokeBottomWeight);
  var left = safeNumber(node.strokeLeftWeight);
  var hasSides =
    (top !== undefined && top !== weight) ||
    (right !== undefined && right !== weight) ||
    (bottom !== undefined && bottom !== weight) ||
    (left !== undefined && left !== weight);
  if (hasSides) {
    return {
      top: top !== undefined ? top : weight || 0,
      right: right !== undefined ? right : weight || 0,
      bottom: bottom !== undefined ? bottom : weight || 0,
      left: left !== undefined ? left : weight || 0,
    };
  }
  return weight;
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
  var weight = strokeWeightInfo(node);
  var align = safeString(node.strokeAlign) || 'INSIDE';
  var strokes = [];
  for (var i = 0; i < node.strokes.length; i++) {
    var paint = extractPaint(node.strokes[i]);
    if (!paint) continue;
    paint.weight = weight;
    paint.align = align;
    strokes.push(paint);
  }
  return strokes.length ? strokes : undefined;
}

function extractDashPattern(node) {
  if (!node.dashPattern || !Array.isArray(node.dashPattern) || node.dashPattern.length === 0) {
    return undefined;
  }
  return node.dashPattern.map(function (n) {
    return Number(n);
  });
}

function extractLayout(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE' || isMixed(node.layoutMode)) {
    return undefined;
  }
  var layout = {
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
  if (!isMixed(node.primaryAxisSizingMode) && node.primaryAxisSizingMode) {
    layout.primaryAxisSizingMode = String(node.primaryAxisSizingMode);
  }
  if (!isMixed(node.counterAxisSizingMode) && node.counterAxisSizingMode) {
    layout.counterAxisSizingMode = String(node.counterAxisSizingMode);
  }
  return layout;
}

function extractConstraints(node) {
  var c = node.constraints;
  if (!c || typeof c !== 'object') return undefined;
  var horizontal = safeString(c.horizontal);
  var vertical = safeString(c.vertical);
  if (!horizontal && !vertical) return undefined;
  return { horizontal: horizontal, vertical: vertical };
}

function extractEffects(effects) {
  if (isMixed(effects) || !effects || !Array.isArray(effects) || effects.length === 0) {
    return undefined;
  }
  var out = [];
  for (var i = 0; i < effects.length; i++) {
    var e = effects[i];
    if (!e || e.visible === false) continue;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      var shadow = {
        type: e.type,
        offset: {
          x: safeNumber(e.offset && e.offset.x) || 0,
          y: safeNumber(e.offset && e.offset.y) || 0,
        },
        radius: safeNumber(e.radius) || 0,
      };
      if (typeof e.spread === 'number') shadow.spread = e.spread;
      var color = colorFromRGBA(e.color);
      if (color) {
        shadow.color = color.color;
        if (color.opacity !== undefined) shadow.opacity = color.opacity;
        else if (typeof e.color.a === 'number') shadow.opacity = e.color.a;
      }
      if (e.blendMode) shadow.blendMode = String(e.blendMode);
      out.push(shadow);
    } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
      out.push({
        type: e.type,
        radius: safeNumber(e.radius) || 0,
      });
    } else if (e.type) {
      out.push({ type: String(e.type) });
    }
  }
  return out.length ? out : undefined;
}

function extractLetterSpacing(ls) {
  if (isMixed(ls) || ls == null) return undefined;
  if (typeof ls === 'number') return ls;
  if (typeof ls === 'object') {
    return {
      unit: safeString(ls.unit),
      value: safeNumber(ls.value),
    };
  }
  return undefined;
}

/** 安全读取节点属性：js.design 部分 TEXT getter 在字体未就绪时会抛错 */
function safeProp(node, key) {
  try {
    return node[key];
  } catch (_e) {
    return undefined;
  }
}

function extractText(node) {
  if (node.type !== 'TEXT') return undefined;
  var color;
  var colorOpacity;
  try {
    var solid = firstSolidFromFills(resolveTextFills(node));
    if (solid) {
      color = solid.color;
      if (solid.opacity !== undefined && solid.opacity !== 1) colorOpacity = solid.opacity;
    }
  } catch (_eFill) {
    /* ignore fills */
  }
  var fontFamily;
  var fontStyle;
  // js.design 偶发 fontName/fontSize getter 抛错（get_fontName / get_fontSize）
  var fontName = safeProp(node, 'fontName');
  if (!isMixed(fontName) && fontName && typeof fontName === 'object') {
    fontFamily = safeString(fontName.family);
    fontStyle = safeString(fontName.style);
  }
  var lineHeight;
  var lh = safeProp(node, 'lineHeight');
  if (!isMixed(lh)) {
    if (typeof lh === 'number') lineHeight = lh;
    else if (lh && typeof lh === 'object') {
      lineHeight = {
        unit: safeString(lh.unit),
        value: safeNumber(lh.value),
      };
    }
  }
  var fontWeight = safeProp(node, 'fontWeight');
  if (isMixed(fontWeight)) fontWeight = undefined;

  var text = {
    characters: safeString(safeProp(node, 'characters')) || '',
    fontSize: safeNumber(safeProp(node, 'fontSize')),
    fontFamily: fontFamily,
    fontStyle: fontStyle,
    fontWeight:
      typeof fontWeight === 'number' || typeof fontWeight === 'string'
        ? fontWeight
        : undefined,
    lineHeight: lineHeight,
    letterSpacing: extractLetterSpacing(safeProp(node, 'letterSpacing')),
    color: color,
    textAlignHorizontal: safeString(safeProp(node, 'textAlignHorizontal')),
    textAlignVertical: safeString(safeProp(node, 'textAlignVertical')),
    textAutoResize: safeString(safeProp(node, 'textAutoResize')),
  };
  if (colorOpacity !== undefined) text.colorOpacity = colorOpacity;
  var textCase = safeProp(node, 'textCase');
  if (!isMixed(textCase) && textCase && textCase !== 'ORIGINAL') {
    text.textCase = String(textCase);
  }
  var textDecoration = safeProp(node, 'textDecoration');
  if (!isMixed(textDecoration) && textDecoration && textDecoration !== 'NONE') {
    text.textDecoration = String(textDecoration);
  }
  // 即时设计宿主暂不支持 paragraphIndent / paragraphSpacing，访问会弹「暂不支持属性」
  return text;
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

function firstImageHash(fills) {
  if (!fills) return undefined;
  for (var i = 0; i < fills.length; i++) {
    if (fills[i] && fills[i].type === 'IMAGE' && fills[i].ref) {
      return fills[i].ref;
    }
  }
  return undefined;
}

/** 同一次导出内按 hash 复用图片字节 */
var imageBytesCache = {};

function resetAssetCaches() {
  imageBytesCache = {};
}

function detectImageMime(bytes) {
  if (!bytes || !bytes.length) return 'application/octet-stream';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/**
 * 通过 getImageByHash + getBytesAsync 导出真实图片字节（base64）。
 * MCP 收到后会落盘，节点上只保留 path。
 */
function exportImageByHash(hash) {
  if (!hash) return Promise.resolve(undefined);
  if (imageBytesCache[hash]) return imageBytesCache[hash];

  imageBytesCache[hash] = Promise.resolve()
    .then(function () {
      if (typeof jsDesign.getImageByHash !== 'function') {
        return { kind: 'image_fill', ref: hash };
      }
      var img = jsDesign.getImageByHash(hash);
      if (!img || typeof img.getBytesAsync !== 'function') {
        return { kind: 'image_fill', ref: hash };
      }
      return img.getBytesAsync().then(function (bytes) {
        if (!bytes || !bytes.length) return { kind: 'image_fill', ref: hash };
        var mimeType = detectImageMime(bytes);
        var out = {
          kind: 'image_fill',
          ref: hash,
          mimeType: mimeType,
          byteLength: bytes.length,
        };
        try {
          if (typeof jsDesign.base64Encode === 'function') {
            out.data = jsDesign.base64Encode(bytes);
            out.dataUri = 'data:' + mimeType + ';base64,' + out.data;
          }
        } catch (e0) {
          // keep ref-only
        }
        if (typeof img.getSizeAsync !== 'function') return out;
        return img.getSizeAsync().then(
          function (size) {
            if (size && typeof size.width === 'number') out.width = size.width;
            if (size && typeof size.height === 'number') out.height = size.height;
            return out;
          },
          function () {
            return out;
          }
        );
      });
    })
    .catch(function () {
      return { kind: 'image_fill', ref: hash };
    });

  return imageBytesCache[hash];
}

function hasExportSettings(node) {
  try {
    var es = node.exportSettings;
    return !!(es && es.length);
  } catch (e) {
    return false;
  }
}

function subtreeHasText(node) {
  if (!node) return false;
  if (String(node.type || '').toUpperCase() === 'TEXT') return true;
  if (!('children' in node) || !node.children || !node.children.length) {
    return false;
  }
  for (var i = 0; i < node.children.length; i++) {
    if (node.children[i].visible === false) continue;
    if (subtreeHasText(node.children[i])) return true;
  }
  return false;
}

function subtreeHasVectorLike(node) {
  if (!node) return false;
  var t = String(node.type || '').toUpperCase();
  if (
    t === 'VECTOR' ||
    t === 'BOOLEAN_OPERATION' ||
    t === 'STAR' ||
    t === 'POLYGON' ||
    t === 'REGULAR_POLYGON' ||
    t === 'ELLIPSE' ||
    t === 'LINE' ||
    t === 'RECTANGLE'
  ) {
    return true;
  }
  if (!('children' in node) || !node.children || !node.children.length) {
    return false;
  }
  for (var i = 0; i < node.children.length; i++) {
    if (node.children[i].visible === false) continue;
    if (subtreeHasVectorLike(node.children[i])) return true;
  }
  return false;
}

/**
 * 图标类容器：小尺寸 FRAME/GROUP/COMPONENT/INSTANCE，无文字，含矢量或名称暗示。
 */
function shouldSliceIconContainer(node, isRoot) {
  if (!node || isRoot) return false;
  var t = String(node.type || '').toUpperCase();
  if (
    t !== 'FRAME' &&
    t !== 'GROUP' &&
    t !== 'COMPONENT' &&
    t !== 'INSTANCE'
  ) {
    return false;
  }
  var w = typeof node.width === 'number' ? node.width : 0;
  var h = typeof node.height === 'number' ? node.height : 0;
  if (w < 8 || h < 8 || w > 256 || h > 256) return false;
  if (subtreeHasText(node)) return false;
  var name = String(node.name || '');
  var nameHint = /icon|图标|ic[_-]|glyph|logo/i.test(name);
  if (!nameHint && !subtreeHasVectorLike(node)) return false;
  return true;
}

function resolveSliceKind(node, state) {
  if (hasExportSettings(node)) return 'export_setting';
  if (!state.skipSlice && shouldSliceIconContainer(node, state.isRoot)) {
    return 'icon_slice';
  }
  return null;
}

/** UI 预览时去掉 base64，避免插件面板卡死 */
function stripBinaryForUi(value) {
  return JSON.parse(
    JSON.stringify(value, function (key, v) {
      if ((key === 'data' || key === 'dataUri') && typeof v === 'string') {
        return undefined;
      }
      return v;
    })
  );
}

/** 需要导出内联 SVG 源码的矢量类节点（不含普通矩形，避免整页刷屏） */
function shouldExportSvg(node) {
  if (!node || !node.type) return false;
  var t = String(node.type).toUpperCase();
  return (
    t === 'VECTOR' ||
    t === 'BOOLEAN_OPERATION' ||
    t === 'STAR' ||
    t === 'POLYGON' ||
    t === 'REGULAR_POLYGON' ||
    t === 'LINE' ||
    t === 'ELLIPSE'
  );
}

/** 图标类切图优先 SVG（小尺寸 / icon_slice / 含矢量） */
function preferSvgSlice(node, sliceKind) {
  if (!node || !sliceKind) return false;
  if (sliceKind === 'icon_slice') return true;
  if (sliceKind !== 'export_setting') return false;
  var w = typeof node.width === 'number' ? node.width : 0;
  var h = typeof node.height === 'number' ? node.height : 0;
  if (w < 8 || h < 8 || w > 256 || h > 256) return false;
  if (subtreeHasText(node)) return false;
  return shouldExportSvg(node) || subtreeHasVectorLike(node) || shouldSliceIconContainer(node, false);
}

/**
 * 导出节点 PNG（即时设计默认/合法格式）。
 * @param {string} [kind] image_fill | export_setting | icon_slice | preview
 */
function exportNodePng(node, kind) {
  if (!node || typeof node.exportAsync !== 'function') {
    return Promise.resolve(undefined);
  }
  var result;
  try {
    result = node.exportAsync({ format: 'PNG' });
  } catch (e0) {
    return Promise.resolve(undefined);
  }
  var promise =
    result && typeof result.then === 'function'
      ? result
      : Promise.resolve(result);
  return promise
    .then(function (bytes) {
      if (!bytes || !bytes.length) return undefined;
      var mimeType = detectImageMime(bytes);
      if (mimeType === 'application/octet-stream') mimeType = 'image/png';
      var out = {
        kind: kind || 'preview',
        mimeType: mimeType,
        byteLength: bytes.length,
        width: typeof node.width === 'number' ? node.width : undefined,
        height: typeof node.height === 'number' ? node.height : undefined,
      };
      try {
        if (typeof jsDesign.base64Encode === 'function') {
          out.data = jsDesign.base64Encode(bytes);
          out.dataUri = 'data:' + mimeType + ';base64,' + out.data;
        }
      } catch (e1) {
        return undefined;
      }
      return out.data ? out : undefined;
    })
    .catch(function () {
      return undefined;
    });
}

function utf8ToBytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    }
  }
  return out;
}

function bytesToBase64(bytes) {
  if (!bytes || !bytes.length) return undefined;
  if (typeof jsDesign.base64Encode === 'function') {
    try {
      var enc = jsDesign.base64Encode(bytes);
      if (enc) return enc;
    } catch (e0) {
      // continue
    }
    try {
      var arr =
        typeof Array.from === 'function'
          ? Array.from(bytes)
          : Array.prototype.slice.call(bytes);
      var enc2 = jsDesign.base64Encode(arr);
      if (enc2) return enc2;
    } catch (e1) {
      // continue
    }
  }
  var bin = '';
  for (var i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] & 0xff);
  }
  if (typeof btoa === 'function') {
    try {
      return btoa(bin);
    } catch (e2) {
      return undefined;
    }
  }
  return undefined;
}

function bytesToUtf8String(bytes) {
  if (!bytes || !bytes.length) return '';
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e0) {
      // fall through
    }
  }
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c >= 0xc0 && c < 0xe0 && i < bytes.length) {
      var c1 = bytes[i++];
      out += String.fromCharCode(((c & 0x1f) << 6) | (c1 & 0x3f));
    } else if (c >= 0xe0 && c < 0xf0 && i + 1 < bytes.length) {
      var c2 = bytes[i++];
      var c3 = bytes[i++];
      out += String.fromCharCode(
        ((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f)
      );
    } else if (c >= 0xf0 && i + 2 < bytes.length) {
      var c4 = bytes[i++];
      var c5 = bytes[i++];
      var c6 = bytes[i++];
      var cp =
        ((c & 0x07) << 18) |
        ((c4 & 0x3f) << 12) |
        ((c5 & 0x3f) << 6) |
        (c6 & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function looksLikeSvg(text) {
  if (!text || typeof text !== 'string') return false;
  var t = text.replace(/^\uFEFF/, '').replace(/^\s+/, '');
  return t.indexOf('<svg') !== -1 || t.indexOf('<?xml') !== -1;
}

function svgStringToAsset(svg, node, kind) {
  if (!svg || typeof svg !== 'string') return undefined;
  try {
    var bytes = utf8ToBytes(svg);
    var u8 =
      typeof Uint8Array !== 'undefined' ? new Uint8Array(bytes) : bytes;
    var data = bytesToBase64(u8);
    if (!data) return undefined;
    return {
      kind: kind || 'icon_slice',
      mimeType: 'image/svg+xml',
      byteLength: bytes.length,
      data: data,
      dataUri: 'data:image/svg+xml;base64,' + data,
      width: typeof node.width === 'number' ? node.width : undefined,
      height: typeof node.height === 'number' ? node.height : undefined,
    };
  } catch (e) {
    return undefined;
  }
}

/**
 * 宿主 exportAsync 导出 SVG（产品本身支持 SVG 导出）。
 * 依次尝试 SVG / SVG_STRING；失败不抛到外层。
 */
function exportNodeSvgViaAsync(node) {
  if (!node || typeof node.exportAsync !== 'function') {
    return Promise.resolve(undefined);
  }
  var formats = ['SVG', 'SVG_STRING'];

  function tryAt(index) {
    if (index >= formats.length) return Promise.resolve(undefined);
    var format = formats[index];
    var result;
    try {
      result = node.exportAsync({ format: format });
    } catch (e0) {
      return tryAt(index + 1);
    }
    var promise =
      result && typeof result.then === 'function'
        ? result
        : Promise.resolve(result);
    return promise
      .then(function (out) {
        if (typeof out === 'string' && looksLikeSvg(out)) return out;
        if (out && typeof out.length === 'number' && out.length > 0) {
          var text = bytesToUtf8String(out);
          if (looksLikeSvg(text)) return text;
        }
        return tryAt(index + 1);
      })
      .catch(function () {
        return tryAt(index + 1);
      });
  }

  return tryAt(0);
}

function paintAttrs(node) {
  var fill = 'none';
  var fillOpacity;
  var solid = firstSolidFromFills(node.fills);
  if (solid) {
    fill = solid.color;
    if (solid.opacity !== undefined && solid.opacity !== 1) {
      fillOpacity = solid.opacity;
    }
  }
  var stroke = null;
  var strokeWidth;
  var strokeOpacity;
  try {
    var strokes = node.strokes;
    if (!isMixed(strokes) && strokes && strokes.length) {
      for (var i = 0; i < strokes.length; i++) {
        if (strokes[i] && strokes[i].visible === false) continue;
        var sc = solidColor(strokes[i]);
        if (sc) {
          stroke = sc.color;
          if (sc.opacity !== undefined && sc.opacity !== 1) {
            strokeOpacity = sc.opacity;
          }
          break;
        }
      }
    }
    if (stroke && typeof node.strokeWeight === 'number') {
      strokeWidth = node.strokeWeight;
    }
  } catch (e0) {
    // ignore
  }
  return {
    fill: fill,
    fillOpacity: fillOpacity,
    stroke: stroke,
    strokeWidth: strokeWidth,
    strokeOpacity: strokeOpacity,
  };
}

function attrsToString(attrs) {
  var s =
    ' fill="' +
    attrs.fill +
    '"' +
    (attrs.fillOpacity !== undefined
      ? ' fill-opacity="' + attrs.fillOpacity + '"'
      : '');
  if (attrs.stroke) {
    s += ' stroke="' + attrs.stroke + '"';
    if (attrs.strokeWidth !== undefined) {
      s += ' stroke-width="' + attrs.strokeWidth + '"';
    }
    if (attrs.strokeOpacity !== undefined) {
      s += ' stroke-opacity="' + attrs.strokeOpacity + '"';
    }
  }
  return s;
}

function cornerRadiusOf(node) {
  if (!isMixed(node.cornerRadius) && typeof node.cornerRadius === 'number') {
    return node.cornerRadius;
  }
  return 0;
}

/**
 * 递归把矢量/形状拼成 SVG 子元素（相对根节点坐标系）。
 * 暂不调用 exportAsync(SVG)：非法 format 会打断整次拉取。
 */
function collectSvgElements(node, ox, oy) {
  if (!node || node.visible === false) return [];
  var t = String(node.type || '').toUpperCase();
  var x = (typeof node.x === 'number' ? node.x : 0) + (ox || 0);
  var y = (typeof node.y === 'number' ? node.y : 0) + (oy || 0);
  var w = typeof node.width === 'number' ? node.width : 0;
  var h = typeof node.height === 'number' ? node.height : 0;
  var parts = [];
  var attrs = paintAttrs(node);
  var opacity =
    !isMixed(node.opacity) && typeof node.opacity === 'number' && node.opacity !== 1
      ? node.opacity
      : undefined;
  var rotation =
    !isMixed(node.rotation) && typeof node.rotation === 'number' && node.rotation !== 0
      ? node.rotation
      : undefined;

  function wrap(el) {
    if (!el) return;
    var inner = el;
    if (rotation !== undefined) {
      var cx = x + w / 2;
      var cy = y + h / 2;
      inner =
        '<g transform="rotate(' +
        rotation +
        ' ' +
        cx +
        ' ' +
        cy +
        ')">' +
        el +
        '</g>';
    }
    if (opacity !== undefined) {
      inner = '<g opacity="' + opacity + '">' + inner + '</g>';
    }
    parts.push(inner);
  }

  try {
    var paths = node.vectorPaths;
    if (paths && paths.length) {
      for (var p = 0; p < paths.length; p++) {
        var vp = paths[p];
        if (!vp || !vp.data) continue;
        var rule = vp.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero';
        var d = vp.data;
        // vectorPaths 坐标相对节点本地；平移到根坐标系
        wrap(
          '<g transform="translate(' +
            x +
            ' ' +
            y +
            ')">' +
            '<path d="' +
            d +
            '"' +
            attrsToString(attrs) +
            ' fill-rule="' +
            rule +
            '"/>' +
            '</g>'
        );
      }
      return parts;
    }
  } catch (e1) {
    // ignore
  }

  if (t === 'RECTANGLE' && w > 0 && h > 0) {
    var r = cornerRadiusOf(node);
    wrap(
      '<rect x="' +
        x +
        '" y="' +
        y +
        '" width="' +
        w +
        '" height="' +
        h +
        '"' +
        (r > 0 ? ' rx="' + r + '" ry="' + r + '"' : '') +
        attrsToString(attrs) +
        '/>'
    );
    return parts;
  }

  if (t === 'ELLIPSE' && w > 0 && h > 0) {
    wrap(
      '<ellipse cx="' +
        (x + w / 2) +
        '" cy="' +
        (y + h / 2) +
        '" rx="' +
        w / 2 +
        '" ry="' +
        h / 2 +
        '"' +
        attrsToString(attrs) +
        '/>'
    );
    return parts;
  }

  if (t === 'LINE' && w >= 0) {
    wrap(
      '<line x1="' +
        x +
        '" y1="' +
        y +
        '" x2="' +
        (x + w) +
        '" y2="' +
        (y + h) +
        '"' +
        attrsToString(
          attrs.fill !== 'none' && !attrs.stroke
            ? {
                fill: 'none',
                stroke: attrs.fill,
                strokeWidth: attrs.strokeWidth || 1,
                strokeOpacity: attrs.fillOpacity,
              }
            : attrs
        ) +
        '/>'
    );
    return parts;
  }

  if (
    t === 'FRAME' ||
    t === 'GROUP' ||
    t === 'COMPONENT' ||
    t === 'INSTANCE' ||
    t === 'BOOLEAN_OPERATION' ||
    t === 'SECTION'
  ) {
    var nested = [];
    // 容器自身纯色底（图标常见深色底）
    if (t !== 'GROUP' && t !== 'BOOLEAN_OPERATION' && attrs.fill !== 'none' && w > 0 && h > 0) {
      var bgR = cornerRadiusOf(node);
      nested.push(
        '<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          w +
          '" height="' +
          h +
          '"' +
          (bgR > 0 ? ' rx="' + bgR + '" ry="' + bgR + '"' : '') +
          attrsToString({ fill: attrs.fill, fillOpacity: attrs.fillOpacity }) +
          '/>'
      );
    }
    if ('children' in node && node.children && node.children.length) {
      for (var i = 0; i < node.children.length; i++) {
        if (node.children[i].visible === false) continue;
        nested = nested.concat(
          collectSvgElements(node.children[i], x, y)
        );
      }
    }
    if (!nested.length) return parts;
    if (opacity !== undefined) {
      parts.push('<g opacity="' + opacity + '">' + nested.join('') + '</g>');
    } else {
      parts = parts.concat(nested);
    }
    return parts;
  }

  return parts;
}

/**
 * 用 vectorPaths / 基础形状拼 SVG（支持图标容器）。
 * 不含 exportAsync；完整获取请用 resolveNodeSvg。
 */
function exportNodeSvgFromGeometry(node) {
  if (!node) return Promise.resolve(undefined);
  try {
    var w = typeof node.width === 'number' ? node.width : 0;
    var h = typeof node.height === 'number' ? node.height : 0;
    if (w <= 0 || h <= 0) return Promise.resolve(undefined);

    var parts;
    // 根节点自身坐标不计入 viewBox；子节点相对根
    if (shouldExportSvg(node) && node.vectorPaths && node.vectorPaths.length) {
      parts = collectSvgElements(
        {
          type: node.type,
          x: 0,
          y: 0,
          width: w,
          height: h,
          fills: node.fills,
          strokes: node.strokes,
          strokeWeight: node.strokeWeight,
          opacity: node.opacity,
          rotation: 0,
          visible: true,
          vectorPaths: node.vectorPaths,
          cornerRadius: node.cornerRadius,
        },
        0,
        0
      );
    } else {
      // 把根容器当作原点在 (0,0) 的节点整体收集（含底色 + 子节点）
      parts = collectSvgElements(
        {
          type: node.type,
          x: 0,
          y: 0,
          width: w,
          height: h,
          fills: node.fills,
          strokes: node.strokes,
          strokeWeight: node.strokeWeight,
          opacity: node.opacity,
          rotation: 0,
          visible: true,
          vectorPaths: node.vectorPaths,
          cornerRadius: node.cornerRadius,
          children: node.children,
        },
        0,
        0
      );
    }

    if (!parts.length) return Promise.resolve(undefined);
    return Promise.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        w +
        '" height="' +
        h +
        '" viewBox="0 0 ' +
        w +
        ' ' +
        h +
        '" fill="none">' +
        parts.join('') +
        '</svg>'
    );
  } catch (e) {
    return Promise.resolve(undefined);
  }
}

/** 优先宿主 SVG 导出，再回退几何拼装（多数图标 VECTOR 无 vectorPaths） */
function resolveNodeSvg(node) {
  return exportNodeSvgViaAsync(node).then(function (svg) {
    if (svg) return svg;
    return exportNodeSvgFromGeometry(node);
  });
}

/**
 * 图标切图：优先 SVG，失败回退 PNG。
 * @returns {Promise<{slice?: object, svg?: string}|undefined>}
 */
function exportNodeSlice(node, kind) {
  if (!preferSvgSlice(node, kind)) {
    return exportNodePng(node, kind).then(function (png) {
      return png ? { slice: png } : undefined;
    });
  }
  return resolveNodeSvg(node).then(function (svg) {
    var asset = svgStringToAsset(svg, node, kind);
    if (asset) return { slice: asset, svg: svg };
    return exportNodePng(node, kind).then(function (png) {
      return png ? { slice: png } : undefined;
    });
  });
}

function extractComponent(node) {
  if (node.type !== 'INSTANCE' && node.type !== 'COMPONENT') return undefined;
  var info = {};
  try {
    if (node.type === 'INSTANCE' && node.mainComponent) {
      info.componentId = String(node.mainComponent.id);
      info.componentName = node.mainComponent.name || undefined;
    } else if (node.type === 'COMPONENT') {
      info.componentId = String(node.id);
      info.componentName = node.name || undefined;
    }
  } catch (e) {
    // mainComponent may throw on detached/missing
  }
  try {
    if (node.variantProperties && typeof node.variantProperties === 'object') {
      info.variantProperties = node.variantProperties;
    }
  } catch (e2) {
    // ignore
  }
  if (node.type === 'INSTANCE' && typeof node.scaleFactor === 'number' && node.scaleFactor !== 1) {
    info.scaleFactor = node.scaleFactor;
  }
  return Object.keys(info).length ? info : undefined;
}

function normalizeNode(node, state) {
  state.count += 1;
  if (state.count > MAX_NODES) {
    state.truncated = true;
    return Promise.resolve(null);
  }

  var sliceKind = resolveSliceKind(node, state);
  var rawFills = node.type === 'TEXT' ? resolveTextFills(node) : node.fills;
  var fills = extractFills(rawFills);
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

  if (typeof node.visible === 'boolean') data.visible = node.visible;
  if (typeof node.locked === 'boolean' && node.locked) data.locked = true;

  if (!isMixed(node.rotation) && typeof node.rotation === 'number' && node.rotation !== 0) {
    data.rotation = node.rotation;
  }

  if (!isMixed(node.opacity) && typeof node.opacity === 'number') {
    data.opacity = node.opacity;
  }

  if (!isMixed(node.blendMode) && node.blendMode && node.blendMode !== 'PASS_THROUGH') {
    data.blendMode = String(node.blendMode);
  }

  var constraints = extractConstraints(node);
  if (constraints) data.constraints = constraints;

  if (!isMixed(node.layoutAlign) && node.layoutAlign && node.layoutAlign !== 'INHERIT') {
    data.layoutAlign = String(node.layoutAlign);
  }
  if (typeof node.layoutGrow === 'number' && node.layoutGrow !== 0) {
    data.layoutGrow = node.layoutGrow;
  }
  if (typeof node.clipsContent === 'boolean') {
    data.clipsContent = node.clipsContent;
  }

  var layout = extractLayout(node);
  if (layout) data.layout = layout;

  if (fills.length) data.fills = fills;

  var strokes = extractStrokes(node);
  if (strokes) data.strokes = strokes;

  var dashPattern = extractDashPattern(node);
  if (dashPattern) data.dashPattern = dashPattern;

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

  var effects = extractEffects(node.effects);
  if (effects) data.effects = effects;

  var text = extractText(node);
  if (text) data.text = text;

  var imageHash = firstImageHash(fills);
  var image = extractImage(node, fills);
  if (image) data.image = image;

  var component = extractComponent(node);
  if (component) data.component = component;

  var enrich = Promise.resolve();

  if (shouldExportSvg(node)) {
    enrich = enrich
      .then(function () {
        return resolveNodeSvg(node);
      })
      .then(function (svg) {
        if (svg) data.svg = svg;
      })
      .catch(function () {});
  }

  if (imageHash) {
    enrich = enrich
      .then(function () {
        return exportImageByHash(imageHash);
      })
      .then(function (img) {
        if (img) data.image = img;
      })
      .catch(function () {});
  }

  // 自动切图：图标优先 SVG，其它 exportSettings / 回退 → PNG
  if (sliceKind) {
    enrich = enrich
      .then(function () {
        return exportNodeSlice(node, sliceKind);
      })
      .then(function (out) {
        if (!out) return;
        if (out.slice) data.slice = out.slice;
        if (out.svg && !data.svg) data.svg = out.svg;
      })
      .catch(function () {});
  }

  return enrich.then(function () {
    if (!('children' in node) || !node.children || node.children.length === 0) {
      return data;
    }

    var childState = {
      count: state.count,
      truncated: state.truncated,
      isRoot: false,
      // 父级已切图则子容器不再重复切，避免图标套图标
      skipSlice: state.skipSlice || !!sliceKind,
    };

    var chain = Promise.resolve();
    for (var i = 0; i < node.children.length; i++) {
      (function (child) {
        if (child.visible === false) return;
        chain = chain.then(function () {
          if (childState.truncated) return;
          return normalizeNode(child, childState).then(function (normalized) {
            if (normalized) data.children.push(normalized);
          });
        });
      })(node.children[i]);
    }
    return chain.then(function () {
      state.count = childState.count;
      state.truncated = state.truncated || childState.truncated;
      return data;
    });
  });
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
        if (f.gradientStops) {
          for (var g = 0; g < f.gradientStops.length; g++) {
            if (f.gradientStops[g].color) addColor(f.gradientStops[g].color);
          }
        }
      }
    }
    if (node.strokes) {
      for (var j = 0; j < node.strokes.length; j++) {
        if (node.strokes[j].color) addColor(node.strokes[j].color);
      }
    }
    if (node.effects) {
      for (var e = 0; e < node.effects.length; e++) {
        if (node.effects[e].color) addColor(node.effects[e].color);
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
  resetAssetCaches();
  var state = { count: 0, truncated: false, isRoot: true, skipSlice: false };
  return normalizeNode(root, state).then(function (node) {
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

    // 根节点始终尝试导出 PNG 预览（与 fills 里的 IMAGE / 自动切图不同）
    return exportNodePng(root, 'preview')
      .then(function (preview) {
        if (preview) payload.root.preview = preview;
        return toJsonSafe(payload);
      })
      .catch(function () {
        return toJsonSafe(payload);
      });
  });
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

  buildPayloadFromNode(root, {})
    .then(function (payload) {
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
        payload: stripBinaryForUi(payload),
      });
    })
    .catch(function (err) {
      jsDesign.ui.postMessage({
        type: 'selection-preview',
        ok: false,
        message: (err && err.message) || String(err),
      });
    });
}

var UI_COLLAPSED = { width: 360, height: 52 };
var UI_EXPANDED = { width: 420, height: 560 };

jsDesign.showUI(__html__, UI_COLLAPSED);

jsDesign.on('selectionchange', publishSelectionPreview);
publishSelectionPreview();

jsDesign.ui.onmessage = function (msg) {
  if (!msg) return;

  if (msg.type === 'resize-ui') {
    var size = msg.expanded ? UI_EXPANDED : UI_COLLAPSED;
    jsDesign.ui.resize(size.width, size.height);
    return;
  }

  if (msg.type === 'refresh-selection') {
    publishSelectionPreview();
    return;
  }

  if (msg.type !== 'fetch-node') return;

  var requestId = msg.requestId;
  var nodeId = msg.nodeId;
  var meta = msg.meta || {};

  var root = resolveNode(nodeId);
  if (!root) {
    jsDesign.ui.postMessage({
      type: 'fetch-node-result',
      requestId: requestId,
      ok: false,
      error:
        '找不到节点 ' +
        nodeId +
        '。请确认链接来自当前打开的文件，且 linkelement 有效。',
    });
    return;
  }

  buildPayloadFromNode(root, meta)
    .then(function (payload) {
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
    })
    .catch(function (err) {
      jsDesign.ui.postMessage({
        type: 'fetch-node-result',
        requestId: requestId,
        ok: false,
        error: (err && err.message) || String(err),
      });
    });
};
