export type JsDesignLink = {
  url: string;
  fileKey?: string;
  pageId?: string;
  /** Normalized id with colon, e.g. 82:2142 */
  nodeId: string;
  /** Raw linkelement from query, e.g. 82-2142 */
  linkElement: string;
};

/** Convert linkelement / id forms to jsDesign.getNodeById id (colon). */
export function normalizeNodeId(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (s.includes(':')) return s;
  return s.replace(/-/g, ':');
}

/**
 * Parse js.design share / editor URLs, or bare node ids.
 * Example:
 * https://js.design/f/tFH0Pj?p=jku4Hd4Ps7&mode=design&linkelement=82-2142
 */
export function parseJsDesignUrl(input: string): JsDesignLink | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare node id
  if (/^[\w.:-]+$/.test(raw) && !raw.includes('://') && !raw.includes('/')) {
    const nodeId = normalizeNodeId(raw);
    return {
      url: raw,
      nodeId,
      linkElement: raw.includes(':') ? raw.replace(/:/g, '-') : raw,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const linkElement =
    url.searchParams.get('linkelement') ||
    url.searchParams.get('node-id') ||
    url.searchParams.get('nodeId');
  if (!linkElement) return null;

  const fileMatch = url.pathname.match(/\/f\/([^/?#]+)/);
  const fileKey = fileMatch?.[1];
  const pageId = url.searchParams.get('p') || undefined;

  return {
    url: raw,
    fileKey,
    pageId,
    nodeId: normalizeNodeId(linkElement),
    linkElement,
  };
}
