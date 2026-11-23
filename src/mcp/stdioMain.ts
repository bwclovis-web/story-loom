import { fileGrantSource, isMcpDisabled, resolveGrantPath } from "./grant";

/**
 * Speaks MCP on stdin/stdout. Refuses to write protocol messages when the
 * adapter is disabled or the grant is missing, invalid, or revoked.
 *
 * Grant checks run before the MCP SDK, database, and handler modules load so
 * disabled / revoked / unconfigured children exit without that cold-start cost.
 */
export async function main(): Promise<void> {
  if (isMcpDisabled(process.env)) {
    process.stderr.write("Story Loom MCP adapter is disabled (WORDLY_MCP_DISABLED). No protocol output was started.\n");
    process.exit(1);
  }
  const grantPath = resolveGrantPath(process.env, process.cwd());
  const grants = fileGrantSource(grantPath);
  const loaded = await grants.load();
  if (!loaded.ok) {
    process.stderr.write(`Story Loom MCP adapter is not configured. ${loaded.problems.join(" ")} No protocol output was started.\n`);
    process.exit(1);
  }
  if (loaded.grant.status !== "active") {
    process.stderr.write(`Story Loom MCP adapter grant "${loaded.grant.label}" is revoked. No protocol output was started.\n`);
    process.exit(1);
  }

  const [{ StdioServerTransport }, { createDb }, { databaseFilePath, fileUrl }, { createWordlyMcpServer }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("@/server/db"),
      import("@/server/dbLocation"),
      import("./server"),
    ]);

  const db = createDb(fileUrl(databaseFilePath()));
  const server = createWordlyMcpServer({ db, grants, disabled: () => isMcpDisabled(process.env) });
  await server.connect(new StdioServerTransport());
}
