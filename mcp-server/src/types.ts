export type Box = { x: number; y: number; w: number; h: number };

export type Padding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type StrokeWeight = number | Padding;

export type DesignEffect = {
  type: string;
  color?: string;
  opacity?: number;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  blendMode?: string;
};

export type DesignComponentInfo = {
  componentId?: string;
  componentName?: string;
  variantProperties?: Record<string, string>;
  scaleFactor?: number;
};

export type DesignText = {
  characters: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  fontWeight?: number | string;
  lineHeight?: number | { unit?: string; value?: number } | string;
  letterSpacing?: number | { unit?: string; value?: number };
  color?: string;
  colorOpacity?: number;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textAutoResize?: string;
  textCase?: string;
  textDecoration?: string;
};

/** 图片/切图二进制；插件侧可带 data，MCP 落盘后只保留 path */
export type AssetBinary = {
  kind?: 'image_fill' | 'export_setting' | 'icon_slice' | 'preview';
  ref?: string;
  mimeType?: string;
  byteLength?: number;
  /** base64（不含 data: 前缀）；落盘后删除 */
  data?: string;
  dataUri?: string;
  /** 本机绝对路径（MCP 落盘后写入） */
  path?: string;
  width?: number;
  height?: number;
};

export type AssetManifestItem = {
  nodeId: string;
  nodeName: string;
  field: 'image' | 'slice' | 'preview';
  kind?: AssetBinary['kind'];
  path: string;
  mimeType?: string;
  byteLength?: number;
  width?: number;
  height?: number;
  ref?: string;
};

export type DesignNode = {
  id: string;
  name: string;
  type: string;
  box: Box;
  visible?: boolean;
  locked?: boolean;
  rotation?: number;
  opacity?: number;
  blendMode?: string;
  constraints?: { horizontal?: string; vertical?: string };
  layoutAlign?: string;
  layoutGrow?: number;
  clipsContent?: boolean;
  layout?: {
    mode?: string;
    gap?: number;
    padding?: Padding;
    align?: string;
    justify?: string;
    primaryAxisSizingMode?: string;
    counterAxisSizingMode?: string;
  };
  fills?: unknown[];
  strokes?: unknown[];
  dashPattern?: number[];
  cornerRadius?: number | number[];
  effects?: DesignEffect[];
  text?: DesignText;
  /** IMAGE 填充导出的真实图片 */
  image?: AssetBinary;
  /** 自动切图：图标优先 SVG，其它 exportSettings / 回退为 PNG */
  slice?: AssetBinary;
  /** 根节点栅格预览 */
  preview?: AssetBinary;
  /** 矢量/图标 SVG 源码（与 slice 的 svg 文件对应） */
  svg?: string;
  component?: DesignComponentInfo;
  children: DesignNode[];
};

export type DesignTokens = {
  colors: string[];
  fontSizes: number[];
  fontFamilies: string[];
  radii: number[];
  spacings: number[];
};

export type DesignPayload = {
  meta: {
    fileName?: string;
    pageName?: string;
    exportedAt: string;
    truncated?: boolean;
    /** 切图落盘目录 */
    assetsDir?: string;
    /** 本次拉取落盘的资源清单 */
    assets?: AssetManifestItem[];
  };
  tokens: DesignTokens;
  root: DesignNode;
};

export function isDesignPayload(value: unknown): value is DesignPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v.meta || !v.tokens || !v.root) return false;
  const meta = v.meta as Record<string, unknown>;
  const root = v.root as Record<string, unknown>;
  return (
    typeof meta.exportedAt === 'string' &&
    typeof root.id === 'string' &&
    typeof root.name === 'string' &&
    typeof root.type === 'string' &&
    Array.isArray(root.children)
  );
}

export const EMPTY_TOKENS: DesignTokens = {
  colors: [],
  fontSizes: [],
  fontFamilies: [],
  radii: [],
  spacings: [],
};
