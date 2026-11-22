/**
 * Safe return paths from a reference back to the map or board that opened it.
 * Only same-project map and board URLs are accepted.
 */

export type CanvasSurface = "maps" | "boards";

export interface ParsedCanvasReturn {
  href: string;
  surface: CanvasSurface;
  surfaceId: string;
  itemId: string | null;
}

const ID = /^[\w-]+$/;

export function canvasReturnPath(
  projectId: string,
  surface: CanvasSurface,
  surfaceId: string,
  itemId: string | null,
): string {
  const base = `/projects/${encodeURIComponent(projectId)}/world/${surface}/${encodeURIComponent(surfaceId)}`;
  if (!itemId) return base;
  const key = surface === "maps" ? "pin" : "card";
  return `${base}?${key}=${encodeURIComponent(itemId)}`;
}

/** Attach a validated return path to a record URL. Edit opens the existing editor. */
export function withCanvasReturn(recordPath: string, returnPath: string, edit = false): string {
  const url = new URL(recordPath, "http://local");
  if (edit) url.searchParams.set("edit", "1");
  url.searchParams.set("canvas", returnPath);
  return `${url.pathname}${url.search}`;
}

/** Keep a validated canvas return on another link to the same record. */
export function keepCanvas(href: string, returnPath: string | null | undefined): string {
  if (!returnPath) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}canvas=${encodeURIComponent(returnPath)}${hash}`;
}

export function parseCanvasReturn(projectId: string, raw: string | undefined | null): ParsedCanvasReturn | null {
  if (!raw || !projectId) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("@")) return null;
  let url: URL;
  try {
    url = new URL(decoded, "http://local");
  } catch {
    return null;
  }
  if (url.origin !== "http://local" || url.username || url.password || url.hash) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 5) return null;
  if (parts[0] !== "projects" || parts[1] !== projectId || parts[2] !== "world") return null;
  if (parts[3] !== "maps" && parts[3] !== "boards") return null;
  const surface = parts[3];
  const surfaceId = parts[4] ?? "";
  if (!ID.test(surfaceId)) return null;
  const allowed = surface === "maps" ? "pin" : "card";
  for (const key of url.searchParams.keys()) {
    if (key !== allowed) return null;
  }
  const itemId = url.searchParams.get(allowed);
  if (itemId && !ID.test(itemId)) return null;
  return {
    href: canvasReturnPath(projectId, surface, surfaceId, itemId),
    surface,
    surfaceId,
    itemId,
  };
}

export function selectionStillPresent(ids: readonly string[], itemId: string | null): boolean {
  if (!itemId) return true;
  return ids.includes(itemId);
}
