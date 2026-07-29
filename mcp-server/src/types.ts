export type Box = { x: number; y: number; w: number; h: number };

export type Padding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type DesignNode = {
  id: string;
  name: string;
  type: string;
  box: Box;
  layout?: {
    mode?: string;
    gap?: number;
    padding?: Padding;
    align?: string;
    justify?: string;
  };
  fills?: unknown[];
  strokes?: unknown[];
  cornerRadius?: number | number[];
  opacity?: number;
  text?: {
    characters: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number | string;
    lineHeight?: number | string;
    color?: string;
  };
  image?: { ref?: string };
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
