import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolDefinitions, WORDLY_MCP_INSTRUCTIONS, type McpDeps } from "./handlers";

export function createWordlyMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "wordly-editor", version: "0.1.0" }, { instructions: WORDLY_MCP_INSTRUCTIONS });
  for (const definition of createToolDefinitions(deps)) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      },
      async (args: Record<string, unknown>) => definition.handler(args as never),
    );
  }
  return server;
}

export const WORDLY_MCP_TOOLS = [
  "list_projects",
  "search_references",
  "get_records",
  "list_revisions",
  "get_revision",
  "list_sections",
  "get_section",
  "review_history",
] as const;
