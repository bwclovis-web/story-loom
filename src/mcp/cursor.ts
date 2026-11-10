import { McpToolError } from "./errors";

const TOKEN = /^[A-Za-z0-9_.:|-]{1,160}$/;

export function encodeCursor(token: string): string {
  return Buffer.from(token, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string {
  let token: string;
  try {
    token = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw invalidCursor();
  }
  if (!TOKEN.test(token) || encodeCursor(token) !== cursor) throw invalidCursor();
  return token;
}

function invalidCursor(): McpToolError {
  return new McpToolError(
    "INVALID_CURSOR",
    "The cursor is not valid. Pass nextCursor from the previous page unchanged, or omit it to read from the start. Nothing was returned.",
  );
}

export interface PageInfo {
  limit: number;
  total: number;
  returned: number;
  nextCursor: string | null;
  complete: boolean;
}

/** Pages a list that was already ordered. An unknown cursor is an error, not a restart. */
export function pageRows<T>(rows: readonly T[], limit: number, cursor: string | undefined, tokenOf: (row: T) => string): { rows: T[]; page: PageInfo } {
  let start = 0;
  if (cursor) {
    const token = decodeCursor(cursor);
    const index = rows.findIndex((row) => tokenOf(row) === token);
    if (index < 0) throw invalidCursor();
    start = index + 1;
  }
  const slice = rows.slice(start, start + limit);
  const complete = start + slice.length >= rows.length;
  const nextCursor = complete || slice.length === 0 ? null : encodeCursor(tokenOf(slice[slice.length - 1]!));
  return {
    rows: slice,
    page: { limit, total: rows.length, returned: slice.length, nextCursor, complete },
  };
}
