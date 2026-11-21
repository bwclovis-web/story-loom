import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProviderError,
  type AssistantProvider,
  type OutputSchema,
  type ProviderRequest,
  type StructuredResult,
} from "@/assistant/provider";
import { SELECTION_ASSIST_SCHEMA_NAME } from "@/selectionAssist/output";
import { AssistantError, type AssistantRuntime } from "@/server/services/assistantService";
import { addReadingPin, PROJECT_PIN_SCOPE } from "@/server/services/readingPinService";
import { prepareSelectionAssist, runSelectionAssist } from "@/server/services/selectionAssistService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const runtime: AssistantRuntime = {
  configured: true,
  model: "test-model",
  limits: {
    maxInputChars: 30_000,
    maxOutputTokens: 2_000,
    maxRequestsPerHour: 100,
    monthlyTokenCap: 10_000_000,
    requestTimeoutSeconds: 60,
    maxToolCalls: 12,
    maxToolRounds: 4,
    maxToolResultChars: 80_000,
  },
};

const usage = { inputTokens: 400, outputTokens: 120, totalTokens: 520 };

function scripted(reply: StructuredResult): { provider: AssistantProvider; calls: { request: ProviderRequest; schema: OutputSchema }[] } {
  const calls: { request: ProviderRequest; schema: OutputSchema }[] = [];
  const provider: AssistantProvider = {
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error("selection assist never streams");
    },
    async structured(request, schema) {
      calls.push({ request, schema });
      return reply;
    },
  };
  return { provider, calls };
}

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
});

afterEach(async () => {
  await t.cleanup();
});

describe("Selection assist", () => {
  it("prepares with pinned references and returns a replacement", async () => {
    await addReadingPin(t.db, IDS.project, PROJECT_PIN_SCOPE, IDS.dossier);
    const range = { start: 4, end: 8 };
    const prep = await prepareSelectionAssist(t.db, runtime, {
      projectId: IDS.project,
      recordId: IDS.chapter,
      revision: 1,
      range,
      action: "rewrite",
      scopeDraftId: "",
    });
    expect(prep.runId).toMatch(/^prf_/);

    const json: StructuredResult = {
      status: "complete",
      text: JSON.stringify({ replacement: "sea", note: "Clearer word." }),
      responseId: "resp_sa",
      usage,
    };
    const { provider, calls } = scripted(json);
    const result = await runSelectionAssist(t.db, provider, prep, [IDS.dossier], new AbortController().signal);

    expect(calls[0]?.schema.name).toBe(SELECTION_ASSIST_SCHEMA_NAME);
    expect(calls[0]?.request.input[0]?.content).toContain("Mara Venn");
    expect(result.status).toBe("complete");
    expect(result.replacement).toBe("sea");
    expect(result.note).toBe("Clearer word.");

    const run = await t.db.proofreadRun.findUniqueOrThrow({ where: { id: prep.runId } });
    expect(run.mode).toBe("selection_assist");
    expect(run.suggestionCount).toBe(1);
  });

  it("refuses when revision is stale", async () => {
    const range = { start: 0, end: 5 };
    await expect(
      prepareSelectionAssist(t.db, runtime, {
        projectId: IDS.project,
        recordId: IDS.chapter,
        revision: 99,
        range,
        action: "expand",
        scopeDraftId: "",
      }),
    ).rejects.toBeInstanceOf(AssistantError);
  });
});