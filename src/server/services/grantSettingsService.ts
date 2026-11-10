import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMcpDisabled, parseGrant, readGrantFile, resolveGrantPath, type GrantLoad, type McpEnv } from "@/mcp/grant";
import type { DbOrTx } from "@/server/db";

const DEFAULT_ID = "grn_local_app";
const DEFAULT_LABEL = "Set in Wordly Editor";
const MAX_PROJECTS = 100;

export interface GrantSettingsInput {
  active: boolean;
  projectIds: string[];
  manuscriptRead: boolean;
}

export type GrantSettingsResult = { ok: true; message: string } | { ok: false; message: string };

export interface GrantSettingsView {
  /** Absolute path of the grant file the adapter reads. */
  filePath: string;
  /** WORDLY_MCP_DISABLED is set, so the adapter refuses every call whatever the grant says. */
  disabledByEnvironment: boolean;
  load: GrantLoad;
}

export async function readGrantSettings(env: McpEnv, cwd: string): Promise<GrantSettingsView> {
  const filePath = resolveGrantPath(env, cwd);
  return { filePath, disabledByEnvironment: isMcpDisabled(env), load: await readGrantFile(filePath) };
}

/**
 * Writes the grant file the local adapter reads on every tool call, so a change applies to the next call.
 * Only "read" is ever written. An unreadable or invalid existing file is left alone rather than overwritten.
 */
export async function saveGrantSettings(
  db: DbOrTx,
  env: McpEnv,
  cwd: string,
  input: GrantSettingsInput,
): Promise<GrantSettingsResult> {
  const projectIds = [...new Set(input.projectIds)];
  if (projectIds.length > MAX_PROJECTS) {
    return { ok: false, message: `At most ${MAX_PROJECTS} projects can be allowed. Nothing was saved.` };
  }
  const live = await db.project.findMany({
    where: { id: { in: projectIds }, trashedAt: null, workspace: { trashedAt: null } },
    select: { id: true },
  });
  if (live.length !== projectIds.length) {
    return { ok: false, message: "A selected project no longer exists or is in the Trash. Nothing was saved." };
  }

  const filePath = resolveGrantPath(env, cwd);
  const existing = await readGrantFile(filePath);
  if (!existing.ok && existing.reason !== "missing") {
    return {
      ok: false,
      message: `The grant file at ${filePath} could not be read (${existing.problems.join(" ")}). Fix or remove it by hand; nothing was saved.`,
    };
  }
  const base = existing.ok ? existing.grant : { id: DEFAULT_ID, label: DEFAULT_LABEL };
  const text = `${JSON.stringify(
    {
      id: base.id,
      label: base.label,
      status: input.active ? "active" : "revoked",
      projectIds,
      capabilities: ["read"],
      manuscriptRead: input.manuscriptRead,
    },
    null,
    2,
  )}\n`;
  const check = parseGrant(text);
  if (!check.ok) return { ok: false, message: `The settings were not valid (${check.problems.join(" ")}). Nothing was saved.` };

  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, filePath);
  } catch {
    await rm(temp, { force: true });
    return { ok: false, message: `The grant file at ${filePath} could not be written. Nothing was changed.` };
  }
  const n = projectIds.length;
  return {
    ok: true,
    message: input.active
      ? `Saved. ChatGPT can read ${n} project${n === 1 ? "" : "s"}${input.manuscriptRead ? ", including chapter and scene text" : ", reference documents only"}.`
      : "Saved. The ChatGPT connection is off; every request is refused.",
  };
}
