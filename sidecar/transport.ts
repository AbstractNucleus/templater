/**
 * Unified structured-output transport. `callStructured` is the single entrypoint
 * for both backends: it takes a prompt + system + JSON schema and returns the
 * typed result the model produced.
 *
 *   - Agent backend: drives the Claude Agent SDK via `query` (or a caller-supplied
 *     pre-warmed stream) and reads `structured_output` off the result message.
 *   - API backend: calls Anthropic Messages with a single forced tool and reads
 *     the `tool_use` input.
 *
 * Streaming progress (the `edit`/`adapt` partial-text feed) flows through the
 * optional `onPartial` callback on the agent path only; the API path ignores it.
 */

import { query, type WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";

export type Backend = "agent" | "api";

/** The Agent SDK stream type — what both `query(...)` and `WarmQuery.query(...)`
 *  return. Kept loose (AsyncIterable) so callers can hand us a warm stream. */
export type AgentStream = ReturnType<WarmQuery["query"]>;

type ApiInputSchema = Anthropic.Messages.Tool["input_schema"];

export interface StructuredOpts {
  prompt: string;
  /** API-backend system prompt. A plain string works for both backends; pass an
   *  array when you need per-block cache_control (rank's catalog caching). */
  system: string | Anthropic.TextBlockParam[];
  schema: Record<string, unknown>;
  model: string;
  /** Tool name for the API backend's forced tool_use. */
  toolName: string;
  /** Tool description sent to the model on the API backend. */
  toolDescription?: string;
  /** API-backend max_tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Agent-backend system prompt override. Defaults to `system` (which must then
   *  be a string). Use this when the agent representation differs from the API
   *  one — e.g. rank's boundary-marked string[] vs the API's cache_control blocks. */
  agentSystemPrompt?: string | string[];
  /** Pre-built agent stream (e.g. a pre-warmed rank handle's query). When set, the
   *  agent path consumes it instead of building one via `query(...)`. */
  agentStream?: AgentStream;
  /** Streaming-progress sink. Agent path only; receives the accumulated partial
   *  text on each content delta. When set, partial messages are requested. */
  onPartial?: (text: string) => void;
}

let apiKey: string | null = null;
let apiClient: Anthropic | null = null;

/** Provide the captured API key once at startup. index.ts strips it from the
 *  process env after capture so it stays the sole auth source for API mode. */
export function initApiKey(key: string | null): void {
  apiKey = key;
}

function getApiClient(): Anthropic {
  if (apiClient) return apiClient;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set; required for API backend");
  }
  apiClient = new Anthropic({ apiKey });
  return apiClient;
}

export async function callStructured<T>(backend: Backend, opts: StructuredOpts): Promise<T> {
  if (backend === "api") return callStructuredApi<T>(opts);
  return callStructuredAgent<T>(opts);
}

async function callStructuredAgent<T>(opts: StructuredOpts): Promise<T> {
  const systemPrompt = opts.agentSystemPrompt ?? (opts.system as string);
  // Cast at the boundary — the SDK wants a specific schema shape that's
  // strict-typed via `as const` at the literal site, but our helper is
  // schema-agnostic.
  const outputFormat = { type: "json_schema" as const, schema: opts.schema } as unknown as {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  const stream: AgentStream =
    opts.agentStream ??
    query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        outputFormat,
        systemPrompt,
        // Only request partial messages when a sink is wired — keeps non-streaming
        // ops (rank, context) on the cheaper path.
        ...(opts.onPartial ? { includePartialMessages: true } : {}),
      },
    });

  let partial = "";
  for await (const msg of stream) {
    if (msg.type === "stream_event" && opts.onPartial) {
      const event = msg.event as { type?: string; delta?: { type?: string; partial_json?: string; text?: string } };
      if (event.type === "content_block_delta" && event.delta) {
        const chunk = event.delta.partial_json ?? event.delta.text ?? "";
        if (chunk.length > 0) {
          partial += chunk;
          opts.onPartial(partial);
        }
      }
      continue;
    }
    if (msg.type !== "result") continue;
    if (msg.subtype === "success") {
      if (msg.structured_output == null) {
        throw new Error("agent sdk returned success without structured_output");
      }
      return msg.structured_output as T;
    }
    throw new Error(`agent sdk ${msg.subtype}: ${(msg.errors ?? []).join("; ") || "unknown"}`);
  }
  throw new Error("agent sdk stream ended without result");
}

async function callStructuredApi<T>(opts: StructuredOpts): Promise<T> {
  const client = getApiClient();
  const msg = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription ?? "Submit the structured response.",
        input_schema: opts.schema as ApiInputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.prompt }],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("anthropic api returned no tool_use block");
  }
  if (block.input == null) {
    throw new Error("anthropic api returned tool_use with null input");
  }
  return block.input as T;
}
