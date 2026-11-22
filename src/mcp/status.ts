import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { apiKeyEnvForProvider, readAssistantConfig } from "@/assistant/config";
import type { Db } from "@/server/db";
import { fileGrantSource, isMcpDisabled, resolveGrantPath, type LocalGrant, type McpEnv } from "./grant";
import { createWordlyMcpServer, WORDLY_MCP_TOOLS } from "./server";

export type ConnectionState = "not_configured" | "local_adapter_ready" | "connection_not_verified" | "disabled";

export interface CheckedState {
  state: ConnectionState;
  /** Facts this check established. */
  checked: string[];
  /** Facts this check did not establish. */
  notChecked: string[];
}

export interface AdapterInspection {
  local: CheckedState;
  chatgpt: CheckedState;
  grant: { label: string; manuscriptRead: boolean; projectCount: number } | null;
  /** Projects returned by a successful list_projects call. Empty when that call did not succeed. */
  projects: { id: string; title: string; workspaceName: string }[];
}

export interface AssistantInspection {
  state: "not_configured" | "connection_not_verified";
  model: string | null;
  checked: string[];
  notChecked: string[];
}

const CHATGPT_NOT_CONTACTED = "ChatGPT was not contacted. No tunnel was opened and no custom MCP server was created from this app.";

export async function inspectAdapter(db: Db, env: McpEnv, cwd: string): Promise<AdapterInspection> {
  if (isMcpDisabled(env)) {
    const checked = ["WORDLY_MCP_DISABLED is set, so the adapter will not start."];
    return {
      local: { state: "disabled", checked, notChecked: ["Tool calls were not made."] },
      chatgpt: { state: "disabled", checked, notChecked: [CHATGPT_NOT_CONTACTED] },
      grant: null,
      projects: [],
    };
  }

  const grantPath = resolveGrantPath(env, cwd);
  const grants = fileGrantSource(grantPath);
  const loaded = await grants.load();
  if (!loaded.ok) {
    return {
      local: { state: "not_configured", checked: loaded.problems, notChecked: ["The adapter was not started."] },
      chatgpt: { state: "not_configured", checked: ["No active local grant is available."], notChecked: [CHATGPT_NOT_CONTACTED] },
      grant: null,
      projects: [],
    };
  }
  if (loaded.grant.status === "revoked") {
    const checked = [`The grant "${loaded.grant.label}" is revoked. Tool calls are refused.`];
    return {
      local: { state: "disabled", checked, notChecked: ["Records were not read."] },
      chatgpt: { state: "disabled", checked, notChecked: [CHATGPT_NOT_CONTACTED] },
      grant: grantSummary(loaded.grant),
      projects: [],
    };
  }

  const checked = [
    `The grant "${loaded.grant.label}" was read and its status is active.`,
    "The grant's only capability is read.",
    loaded.grant.manuscriptRead ? "The grant allows manuscript access." : "Manuscript access is off.",
  ];
  try {
    const verified = await verifyTools(db, grants, env);
    return {
      local: {
        state: "local_adapter_ready",
        checked: [...checked, ...verified.checked],
        notChecked: ["A separate stdio process was not started by this check.", "ChatGPT was not contacted."],
      },
      chatgpt: {
        state: "connection_not_verified",
        checked: ["The local adapter check did not contact ChatGPT."],
        notChecked: [CHATGPT_NOT_CONTACTED, "No ChatGPT tool call was observed."],
      },
      grant: grantSummary(loaded.grant),
      projects: verified.projects,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    return {
      local: {
        state: "not_configured",
        checked: [...checked, `The local adapter check failed (${name}), so it was not marked ready.`],
        notChecked: ["Records were not returned.", CHATGPT_NOT_CONTACTED],
      },
      chatgpt: { state: "not_configured", checked: ["The local adapter is not ready."], notChecked: [CHATGPT_NOT_CONTACTED] },
      grant: grantSummary(loaded.grant),
      projects: [],
    };
  }
}

export function inspectAssistant(env: McpEnv): AssistantInspection {
  const { status } = readAssistantConfig(env);
  if (!status.configured) {
    return {
      state: "not_configured",
      model: status.model,
      checked: status.problems,
      notChecked: ["No request was sent to OpenAI."],
    };
  }
  const keyEnv = apiKeyEnvForProvider(status.provider);
  return {
    state: "connection_not_verified",
    model: status.model,
    checked: [
      `Provider ${status.provider}; ${keyEnv} is set in the server environment. The key is not shown.`,
      `OPENAI_MODEL is set to ${status.model}.`,
    ],
    notChecked: ["No request was sent to the provider, so the assistant connection was not verified."],
  };
}

function grantSummary(grant: LocalGrant): { label: string; manuscriptRead: boolean; projectCount: number } {
  return { label: grant.label, manuscriptRead: grant.manuscriptRead, projectCount: grant.projectIds.length };
}

async function verifyTools(db: Db, grants: ReturnType<typeof fileGrantSource>, env: McpEnv) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWordlyMcpServer({ db, grants, disabled: () => isMcpDisabled(env) });
  const client = new Client({ name: "wordly-connections", version: "0.1.0" });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    const expected = [...WORDLY_MCP_TOOLS].sort();
    if (names.join("\n") !== expected.join("\n")) {
      throw new Error("ToolListMismatch");
    }
    if (listed.tools.some((tool) => tool.annotations?.readOnlyHint !== true)) {
      throw new Error("WriteToolAdvertised");
    }
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    if (result.isError) throw new Error("ListProjectsFailed");
    const structured = result.structuredContent as { projects?: { id: string; title: string; workspaceName: string }[] } | undefined;
    const projects = Array.isArray(structured?.projects) ? structured.projects : [];
    return {
      projects,
      checked: [
        `The adapter listed these tools: ${expected.join(", ")}.`,
        "Every listed tool is marked read-only.",
        `list_projects read ${projects.length} permitted project${projects.length === 1 ? "" : "s"} from the local database.`,
      ],
    };
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
