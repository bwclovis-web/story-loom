import OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";
import { ProviderError, type ProviderEvent, type ProviderRequest } from "@/assistant/provider";
import { buildCreateParams, buildStructuredParams, createOpenAIProvider, type ResponsesClient } from "@/server/openai/openaiProvider";

/* No network: the SDK client is replaced by a fake that replays stream events. */

const request: ProviderRequest = {
  model: "example-model",
  instructions: "Be brief.",
  input: [{ role: "user", content: "Hello" }],
  maxOutputTokens: 500,
  timeoutMs: 30_000,
};

function fakeClient(events: object[] | (() => never), calls: unknown[] = []): ResponsesClient {
  return {
    responses: {
      async create(body, options) {
        calls.push({ body, options });
        if (typeof events === "function") events();
        return (async function* () {
          for (const e of events as object[]) yield e as ResponseStreamEvent;
        })();
      },
    },
  };
}

async function collect(stream: AsyncIterable<ProviderEvent>) {
  const out: ProviderEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const usage = { input_tokens: 12, output_tokens: 5, total_tokens: 17, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };

describe("OpenAI Responses adapter", () => {
  it("sends a stateless, non-stored, non-truncating streaming request", () => {
    const params = buildCreateParams(request);
    expect(params).toEqual({
      model: "example-model",
      instructions: "Be brief.",
      input: [{ role: "user", content: "Hello" }],
      max_output_tokens: 500,
      store: false,
      truncation: "disabled",
      stream: true,
    });
    expect(params).not.toHaveProperty("previous_response_id");
  });

  it("maps text deltas and completion usage", async () => {
    const calls: unknown[] = [];
    const keys: string[] = [];
    const provider = createOpenAIProvider("sk-test-key", (key) => {
      keys.push(key);
      return fakeClient(
        [
          { type: "response.created", response: {} },
          { type: "response.output_text.delta", delta: "Hel" },
          { type: "response.output_text.delta", delta: "lo" },
          { type: "response.completed", response: { id: "resp_1", usage, incomplete_details: null } },
        ],
        calls,
      );
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(keys).toEqual(["sk-test-key"]);
    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "done", status: "complete", incompleteReason: undefined, responseId: "resp_1", usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } },
    ]);
    expect((calls[0] as { options: { timeout: number } }).options.timeout).toBe(30_000);
  });

  it("reports an answer cut at the output limit as incomplete", async () => {
    const provider = createOpenAIProvider("k", () =>
      fakeClient([{ type: "response.incomplete", response: { id: "resp_2", usage, incomplete_details: { reason: "max_output_tokens" } } }]),
    );
    const [done] = await collect(provider.stream(request, new AbortController().signal));
    expect(done).toMatchObject({ type: "done", status: "incomplete", incompleteReason: "max_output_tokens" });
  });

  it("turns failed responses and stream errors into provider errors", async () => {
    const failed = createOpenAIProvider("k", () => fakeClient([{ type: "response.failed", response: { error: { code: "server_error", message: "x" } } }]));
    await expect(collect(failed.stream(request, new AbortController().signal))).rejects.toMatchObject({ code: "provider_failed" });
    const errored = createOpenAIProvider("k", () => fakeClient([{ type: "error", code: "boom", message: "x" }]));
    await expect(collect(errored.stream(request, new AbortController().signal))).rejects.toMatchObject({ code: "provider_failed" });
    const cut = createOpenAIProvider("k", () => fakeClient([{ type: "response.output_text.delta", delta: "a" }]));
    await expect(collect(cut.stream(request, new AbortController().signal))).rejects.toBeInstanceOf(ProviderError);
  });

  it("maps HTTP errors without echoing a key", async () => {
    const leaked = "Incorrect API key provided: sk-proj-abc123****wxyz";
    const cases: [Error, string][] = [
      [new OpenAI.AuthenticationError(401, { message: leaked }, leaked, new Headers()), "auth"],
      [new OpenAI.RateLimitError(429, {}, "quota", new Headers()), "rate_limit"],
      [new OpenAI.NotFoundError(404, {}, "model", new Headers()), "not_found"],
      [new OpenAI.BadRequestError(400, {}, `bad ${leaked}`, new Headers()), "bad_request"],
      [new OpenAI.InternalServerError(503, {}, "down", new Headers()), "server"],
      [new OpenAI.APIConnectionError({ message: "offline" }), "connection"],
    ];
    for (const [error, code] of cases) {
      const provider = createOpenAIProvider("k", () => fakeClient(() => { throw error; }));
      const caught = await collect(provider.stream(request, new AbortController().signal)).catch((e: ProviderError) => e);
      expect(caught).toBeInstanceOf(ProviderError);
      expect((caught as ProviderError).code).toBe(code);
      expect((caught as ProviderError).message).not.toMatch(/sk-proj-abc123/);
    }
  });

  it("reports cancellation when the signal is aborted", async () => {
    const controller = new AbortController();
    const client: ResponsesClient = {
      responses: {
        async create(_body, options) {
          return (async function* () {
            yield { type: "response.output_text.delta", delta: "partial" } as ResponseStreamEvent;
            if (options.signal.aborted) throw new OpenAI.APIUserAbortError();
            await new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new OpenAI.APIUserAbortError())));
          })();
        },
      },
    };
    const provider = createOpenAIProvider("k", () => client);
    const seen: ProviderEvent[] = [];
    const run = (async () => {
      for await (const e of provider.stream(request, controller.signal)) {
        seen.push(e);
        controller.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    expect(seen).toEqual([{ type: "delta", text: "partial" }]);
  });
});

describe("OpenAI Responses adapter: structured proposals", () => {
  const schema = { name: "example_schema", schema: { type: "object", additionalProperties: false, required: [], properties: {} } };

  function responseClient(response: object | (() => never), calls: unknown[] = []): ResponsesClient {
    return {
      responses: {
        async create(body, options) {
          calls.push({ body, options });
          if (typeof response === "function") response();
          return response;
        },
      },
    };
  }

  const message = (content: object[]) => ({ type: "message", id: "msg_1", role: "assistant", status: "completed", content });

  it("sends a strict json_schema format without streaming or storage", () => {
    const params = buildStructuredParams(request, schema);
    expect(params).toEqual({
      model: "example-model",
      instructions: "Be brief.",
      input: [{ role: "user", content: "Hello" }],
      max_output_tokens: 500,
      store: false,
      truncation: "disabled",
      stream: false,
      text: { format: { type: "json_schema", name: "example_schema", schema: schema.schema, strict: true } },
    });
  });

  it("returns the output text and usage of a completed response", async () => {
    const calls: unknown[] = [];
    const provider = createOpenAIProvider("k", () =>
      responseClient(
        { id: "resp_s", status: "completed", usage, output: [message([{ type: "output_text", text: '{"a":', annotations: [] }, { type: "output_text", text: "1}", annotations: [] }])] },
        calls,
      ),
    );
    const result = await provider.structured(request, schema, new AbortController().signal);
    expect(result).toEqual({ status: "complete", text: '{"a":1}', responseId: "resp_s", usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } });
    expect((calls[0] as { body: { stream: boolean } }).body.stream).toBe(false);
  });

  it("reports refusals and incomplete responses instead of parsing them", async () => {
    const refused = createOpenAIProvider("k", () =>
      responseClient({ id: "r1", status: "completed", usage, output: [message([{ type: "refusal", refusal: "I can't help with that." }])] }),
    );
    expect(await refused.structured(request, schema, new AbortController().signal)).toMatchObject({ status: "refused", refusal: "I can't help with that." });

    const cut = createOpenAIProvider("k", () =>
      responseClient({
        id: "r2",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage,
        output: [message([{ type: "output_text", text: '{"summary": "half', annotations: [] }])],
      }),
    );
    const incomplete = await cut.structured(request, schema, new AbortController().signal);
    expect(incomplete).toMatchObject({ status: "incomplete", incompleteReason: "max_output_tokens" });
    expect(incomplete).not.toHaveProperty("text");
  });

  it("turns failed, empty and errored responses into provider errors", async () => {
    const failed = createOpenAIProvider("k", () => responseClient({ id: "r3", status: "failed", error: { code: "server_error" }, output: [] }));
    await expect(failed.structured(request, schema, new AbortController().signal)).rejects.toMatchObject({ code: "provider_failed" });
    const empty = createOpenAIProvider("k", () => responseClient({ id: "r4", status: "completed", output: [] }));
    await expect(empty.structured(request, schema, new AbortController().signal)).rejects.toMatchObject({ code: "provider_failed" });
    const limited = createOpenAIProvider("k", () =>
      responseClient(() => {
        throw new OpenAI.RateLimitError(429, {}, "quota", new Headers());
      }),
    );
    await expect(limited.structured(request, schema, new AbortController().signal)).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("reports cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createOpenAIProvider("k", () => responseClient({ id: "r5", status: "completed", output: [] }));
    await expect(provider.structured(request, schema, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
  });
});
