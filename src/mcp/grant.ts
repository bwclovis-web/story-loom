import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ID_PATTERN } from "@/domain/ids";
import { z } from "zod";
import { McpToolError } from "./errors";
import { GRANT_FILE_MAX_BYTES } from "./limits";

const GRANT_ID = /^[A-Za-z0-9_-]{4,80}$/;

const GrantFileSchema = z
  .object({
    id: z.string().regex(GRANT_ID),
    label: z.string().trim().min(1).max(120),
    status: z.enum(["active", "revoked"]),
    projectIds: z.array(z.string().regex(PROJECT_ID_PATTERN)).max(100),
    capabilities: z.array(z.string()).min(1).max(1),
    manuscriptRead: z.boolean().optional(),
  })
  .strict();

export interface LocalGrant {
  id: string;
  label: string;
  status: "active" | "revoked";
  projectIds: readonly string[];
  /** This adapter accepts read only. Write capabilities are rejected at load time. */
  capabilities: readonly ["read"];
  manuscriptRead: boolean;
}

export type GrantLoad =
  | { ok: true; grant: LocalGrant }
  | { ok: false; reason: "missing" | "invalid" | "unreadable"; problems: string[] };

export interface GrantSource {
  /** Called on every tool call so a revoked grant fails the next call. */
  load(): Promise<GrantLoad>;
}

export type McpEnv = Record<string, string | undefined>;

export function isMcpDisabled(env: McpEnv): boolean {
  const value = env.WORDLY_MCP_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function resolveGrantPath(env: McpEnv, cwd: string): string {
  const configured = env.WORDLY_MCP_GRANT_FILE?.trim();
  return path.resolve(cwd, configured || path.join("mcp", "grant.json"));
}

export function fileGrantSource(filePath: string): GrantSource {
  return { load: () => readGrantFile(filePath) };
}

export async function readGrantFile(filePath: string): Promise<GrantLoad> {
  let info: { size: number };
  try {
    info = await stat(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      return { ok: false, reason: "missing", problems: [`No grant file at ${filePath}.`] };
    }
    return { ok: false, reason: "unreadable", problems: ["The grant file could not be read."] };
  }
  if (info.size > GRANT_FILE_MAX_BYTES) {
    return {
      ok: false,
      reason: "invalid",
      problems: [`The grant file is larger than ${GRANT_FILE_MAX_BYTES} bytes and was not read.`],
    };
  }
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return { ok: false, reason: "unreadable", problems: ["The grant file could not be read."] };
  }
  return parseGrant(text);
}

export function parseGrant(text: string): GrantLoad {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid", problems: ["The grant file is not JSON."] };
  }
  const parsed = GrantFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "grant"}: ${issue.message}`),
    };
  }
  const value = parsed.data;
  if (value.capabilities[0] !== "read") {
    return {
      ok: false,
      reason: "invalid",
      problems: ['capabilities must be exactly ["read"]. This adapter does not accept write permissions.'],
    };
  }
  const seen = new Set<string>();
  for (const id of value.projectIds) {
    if (seen.has(id)) {
      return { ok: false, reason: "invalid", problems: [`projectIds lists ${id} more than once.`] };
    }
    seen.add(id);
  }
  return {
    ok: true,
    grant: {
      id: value.id,
      label: value.label,
      status: value.status,
      projectIds: value.projectIds,
      capabilities: ["read"],
      manuscriptRead: value.manuscriptRead ?? false,
    },
  };
}

/** Test and in-process helper. `load` reads the object on every call. */
export function memoryGrantSource(current: { grant: LocalGrant }): GrantSource {
  return {
    async load() {
      return { ok: true, grant: current.grant };
    },
  };
}

/** Read permission, checked on every call. A revoked grant fails here. */
export function assertCanRead(grant: LocalGrant): void {
  if (grant.status !== "active") {
    throw new McpToolError("GRANT_REVOKED", `Grant "${grant.label}" is revoked. No records were read.`);
  }
  if (grant.capabilities.length !== 1 || grant.capabilities[0] !== "read") {
    throw new McpToolError("CAPABILITY_DENIED", "This grant cannot read records. No records were read.");
  }
}

/** The project must be listed on the grant. Existence in the database is a separate check. */
export function assertProjectAllowed(grant: LocalGrant, projectId: string): void {
  assertCanRead(grant);
  if (!grant.projectIds.includes(projectId)) {
    throw new McpToolError(
      "PROJECT_NOT_PERMITTED",
      `Project ${projectId} is not included in this grant. Nothing was read.`,
    );
  }
}

export function assertManuscriptAllowed(grant: LocalGrant): void {
  if (!grant.manuscriptRead) {
    throw new McpToolError(
      "MANUSCRIPT_NOT_PERMITTED",
      "Manuscript access is off for this grant. The chapter text was not read.",
    );
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
