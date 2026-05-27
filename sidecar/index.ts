/**
 * Sidecar entrypoint. Reads newline-delimited JSON requests from stdin,
 * writes newline-delimited JSON responses to stdout.
 *
 * CLI: argv[2] is the app data dir (provided by the Rust spawner). Context
 * index lives at `<app_data_dir>/context.db`. If argv[2] is missing we
 * fall back to cwd — non-fatal but context features won't persist sensibly.
 *
 * Concurrency: writer/reader on the Rust side multiplex multiple in-flight
 * requests over the same pipe, keyed by `id`.
 *
 * Performance:
 *   1. WarmQuery: a Claude CLI subprocess is kept pre-spawned with the rank
 *      system prompt baked in, so each rank skips the ~1-2s startup handshake.
 *   2. Prompt caching: the catalog is placed BEFORE SYSTEM_PROMPT_DYNAMIC_BOUNDARY
 *      in systemPrompt[]. Anthropic caches that prefix (5-min TTL).
 *   3. Context pre-fetch: adapt + edit ask a Haiku picker to select 0-3
 *      relevant indexed files, then read them and inject into the Sonnet
 *      draft call's system prompt. Single-shot retrieval (one Haiku + one
 *      Sonnet) rather than agentic loop — equivalent quality at this scale,
 *      simpler code, identical across Agent and API backends.
 */

import { createInterface } from "node:readline";
import path from "node:path";
import {
  query,
  startup,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import {
  captureMemory as ctxCaptureMemory,
  contextListFiles,
  contextStatus,
  initContext,
  pickRelevantFiles,
  readContextFile,
  rescanAll,
  rescanSource,
  searchContextFiles,
  setSources as ctxSetSources,
  type PickedFile,
  type PickerCandidate,
  type PickResult,
} from "./context.js";
import { parseRequestLine } from "./protocol.js";

const APP_DATA_DIR = process.argv[2] ?? process.cwd();
const CONTEXT_DB_PATH = path.join(APP_DATA_DIR, "context.db");

// Capture the API key once at startup, then strip it from the process env so
// the Agent SDK and any subprocess it spawns can never observe it. This makes
// the Settings backend toggle the SOLE source of truth for auth: Agent mode
// always uses the user's Claude subscription, API mode always uses the
// captured key. Without this, an `ANTHROPIC_API_KEY` env var would silently
// override Agent mode and bill against the API.
const apiKeyForApiMode: string | null = process.env.ANTHROPIC_API_KEY ?? null;
delete process.env.ANTHROPIC_API_KEY;

type Backend = "agent" | "api";

/** Backend used by context-side calls (ingest summaries, memory extraction).
 *  Adapt + edit + rank still pass their own backend per request. */
let contextBackend: Backend = "agent";

type PingRequest = { id: string; op: "ping" };

type CatalogEntry = {
  id: string;
  name: string;
  tags?: string[];
  opening?: string;
  body: string;
};

type RankRequest = {
  id: string;
  op: "rank";
  backend: Backend;
  pasted: string;
  catalog: CatalogEntry[];
};

type ChatTurn = { role: "user" | "assistant"; content: string };

type EditTemplateRequest = {
  id: string;
  op: "edit-template";
  backend: Backend;
  draft: { opening: string; body: string };
  history: ChatTurn[];
  prompt: string;
};

type AdaptTemplateRequest = {
  id: string;
  op: "adapt-template";
  backend: Backend;
  draft: { opening: string; body: string };
  inbound: string;
};

type ContextSetSourcesRequest = {
  id: string;
  op: "context-set-sources";
  sources: string[];
  backend: Backend;
};

type ContextStatusRequest = { id: string; op: "context-status" };
type ContextListFilesRequest = { id: string; op: "context-list-files"; source?: string };
type ContextRescanRequest = { id: string; op: "context-rescan"; source?: string };
type ContextReadFileRequest = { id: string; op: "context-read-file"; path: string };
type ContextSearchRequest = { id: string; op: "context-search"; query: string; limit?: number };
type ContextCaptureMemoryRequest = {
  id: string;
  op: "context-capture-memory";
  raw: string;
  source: string;
  backend: Backend;
};

type Request =
  | PingRequest
  | RankRequest
  | EditTemplateRequest
  | AdaptTemplateRequest
  | ContextSetSourcesRequest
  | ContextStatusRequest
  | ContextListFilesRequest
  | ContextRescanRequest
  | ContextReadFileRequest
  | ContextSearchRequest
  | ContextCaptureMemoryRequest;

type Response =
  | { id: string; ok: true; [k: string]: unknown }
  | { id: string; ok: false; error: string };

type ProgressEvent = { id: string; progress: { text: string } };

function emitProgress(id: string, text: string): void {
  // Progress lines carry no `ok` field — the Rust reader routes them to a
  // Tauri event instead of completing the caller's oneshot.
  process.stdout.write(JSON.stringify({ id, progress: { text } } satisfies ProgressEvent) + "\n");
}

type Ranking = { template_id: string; score: number };

const RANK_MODEL = "claude-haiku-4-5-20251001";

const RANK_INSTRUCTIONS = `You match pasted messages against a reply-template catalog.
For each request, pick up to 5 best-matching templates from the catalog below
and return them as structured output.
Score each match 0..1 by semantic fit (intent, tone, scenario).
Use the exact template_id from the catalog. Skip weak matches — fewer is fine.`;

const RANKINGS_SCHEMA = {
  type: "object",
  required: ["rankings"],
  additionalProperties: false,
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        required: ["template_id", "score"],
        additionalProperties: false,
        properties: {
          template_id: { type: "string" },
          score: { type: "number" },
        },
      },
    },
  },
} as const;

function catalogToLines(catalog: CatalogEntry[]): string {
  return catalog
    .map((t) => {
      const snippet = (t.body ?? "").replace(/\s+/g, " ").slice(0, 200);
      return `- ${t.id} | ${t.name} | ${snippet}`;
    })
    .join("\n");
}

function buildSystemPrompt(catalog: CatalogEntry[]): string[] {
  return [
    RANK_INSTRUCTIONS,
    `CATALOG (id | name | snippet):\n${catalogToLines(catalog)}`,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  ];
}

function rankOptions(catalog: CatalogEntry[]) {
  return {
    model: RANK_MODEL,
    outputFormat: { type: "json_schema" as const, schema: RANKINGS_SCHEMA },
    systemPrompt: buildSystemPrompt(catalog),
  };
}

function catalogKey(catalog: CatalogEntry[]): string {
  return catalog
    .map((t) => `${t.id}\0${t.name}\0${(t.body ?? "").slice(0, 200)}`)
    .join("\n");
}

let warmKey: string | null = null;
let warmHandle: Promise<WarmQuery> | null = null;

function prewarmRank(catalog: CatalogEntry[]): Promise<WarmQuery> {
  const key = catalogKey(catalog);
  if (warmKey === key && warmHandle) return warmHandle;
  warmKey = key;
  warmHandle = startup({ options: rankOptions(catalog) }).catch((err) => {
    warmHandle = null;
    warmKey = null;
    throw err;
  });
  return warmHandle;
}

async function takeWarmRank(catalog: CatalogEntry[]): Promise<WarmQuery> {
  const handle = await prewarmRank(catalog);
  warmHandle = null;
  warmKey = null;
  return handle;
}

function send(response: Response): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

async function handleRank(req: RankRequest): Promise<Response> {
  if (req.backend === "api") return runRankApi(req);
  return runRankAgent(req);
}

async function runRankAgent(req: RankRequest): Promise<Response> {
  const userPrompt = `PASTED MESSAGE:\n${req.pasted}`;
  const opts = rankOptions(req.catalog);

  let stream;
  try {
    const handle = await takeWarmRank(req.catalog);
    stream = handle.query(userPrompt);
  } catch {
    stream = query({ prompt: userPrompt, options: opts });
  }

  prewarmRank(req.catalog).catch(() => {});

  for await (const msg of stream) {
    if (msg.type !== "result") continue;
    if (msg.subtype === "success") {
      const out = msg.structured_output as { rankings?: Ranking[] } | undefined;
      if (!out || !Array.isArray(out.rankings)) {
        return { id: req.id, ok: false, error: "agent sdk returned no rankings" };
      }
      return { id: req.id, ok: true, rankings: out.rankings };
    }
    return {
      id: req.id,
      ok: false,
      error: `agent sdk ${msg.subtype}: ${(msg.errors ?? []).join("; ") || "unknown"}`,
    };
  }
  return { id: req.id, ok: false, error: "agent sdk stream ended without result" };
}

let apiClient: Anthropic | null = null;
function getApiClient(): Anthropic {
  if (apiClient) return apiClient;
  if (!apiKeyForApiMode) {
    throw new Error("ANTHROPIC_API_KEY is not set; required for API backend");
  }
  apiClient = new Anthropic({ apiKey: apiKeyForApiMode });
  return apiClient;
}

const RANK_TOOL_NAME = "submit_rankings";
const EDIT_TOOL_NAME = "submit_edit";

type ApiInputSchema = Anthropic.Messages.Tool["input_schema"];

async function runRankApi(req: RankRequest): Promise<Response> {
  let client: Anthropic;
  try {
    client = getApiClient();
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }

  const userPrompt = `PASTED MESSAGE:\n${req.pasted}`;
  let msg;
  try {
    msg = await client.messages.create({
      model: RANK_MODEL,
      max_tokens: 1024,
      system: [
        { type: "text", text: RANK_INSTRUCTIONS },
        {
          type: "text",
          text: `CATALOG (id | name | snippet):\n${catalogToLines(req.catalog)}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: RANK_TOOL_NAME,
          description: "Submit the ranked template matches as structured output.",
          input_schema: RANKINGS_SCHEMA as unknown as ApiInputSchema,
        },
      ],
      tool_choice: { type: "tool", name: RANK_TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (err) {
    return { id: req.id, ok: false, error: `anthropic api: ${(err as Error).message}` };
  }

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use" || block.name !== RANK_TOOL_NAME) {
    return { id: req.id, ok: false, error: "anthropic api returned no tool_use block" };
  }
  const out = block.input as { rankings?: Ranking[] };
  if (!out || !Array.isArray(out.rankings)) {
    return { id: req.id, ok: false, error: "anthropic api returned no rankings" };
  }
  return { id: req.id, ok: true, rankings: out.rankings };
}

// ---------------------------------------------------------------------------
// Context: summarizer + picker + memory extractor
// ---------------------------------------------------------------------------

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const PICK_MODEL = "claude-haiku-4-5-20251001";
const MEMORY_MODEL = "claude-haiku-4-5-20251001";

const SUMMARY_SCHEMA = {
  type: "object",
  required: ["summary", "tags"],
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One to two short sentences describing what this file is about and when you'd reach for it." },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "3-6 short topic keywords (lowercase, single words or short phrases).",
    },
  },
} as const;

const SUMMARY_INSTRUCTIONS = `You distill reference documents into a one-line gist plus a few topic tags.
The summary will help an AI later decide whether this file is relevant to a question.
Aim for 1-2 sentences. Tags should be short, lowercase, and topical (e.g. "refund-policy", "onboarding").`;

const PICK_SCHEMA = {
  type: "object",
  required: ["picks"],
  additionalProperties: false,
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "reason"],
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const PICK_INSTRUCTIONS = `You select reference files that are relevant to a query.
You are given a candidate list (path | summary | tags) and a query.
Return 0..k picks — fewer is better than forcing weak matches. Only pick files that
clearly help. Use the exact path from the candidate list.`;

const MEMORY_SCHEMA = {
  type: "object",
  required: ["signal", "title"],
  additionalProperties: false,
  properties: {
    signal: {
      type: "string",
      description: "The durable, reusable knowledge distilled from the raw input. Drop greetings, scheduling chatter, and one-off context.",
    },
    title: {
      type: "string",
      description: "A short topic label for this memory (3-6 words, Title Case-ish). Used as the filename and as a UI heading. No punctuation needed.",
    },
  },
} as const;

const MEMORY_INSTRUCTIONS = `You extract durable signal from pasted messages (Slack threads, emails, notes).
Return one tight paragraph capturing the reusable knowledge — facts, decisions, procedures, names of people-and-what-they-own.
Drop greetings, scheduling, and one-off context. If the input has no durable signal, return an empty string.
Also return a short title (3-6 words) summarizing the topic — used as the filename and a UI heading.`;

async function runStructuredAgent<T>(
  prompt: string,
  systemPrompt: string,
  schema: Record<string, unknown>,
  model: string,
): Promise<T> {
  // Cast at the boundary — the SDK wants a specific schema shape that's
  // strict-typed via `as const` at the literal site, but our helper is
  // schema-agnostic.
  const outputFormat = { type: "json_schema" as const, schema } as unknown as {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
  const stream = query({
    prompt,
    options: {
      model,
      outputFormat,
      systemPrompt,
    },
  });
  for await (const msg of stream) {
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

async function runStructuredApi<T>(
  prompt: string,
  systemPrompt: string,
  schema: unknown,
  model: string,
  toolName: string,
): Promise<T> {
  const client = getApiClient();
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    tools: [
      {
        name: toolName,
        description: "Submit the structured response.",
        input_schema: schema as ApiInputSchema,
      },
    ],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: prompt }],
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

async function summarizeFile(text: string, filename: string): Promise<{ summary: string; tags: string[] }> {
  const userPrompt = `FILENAME: ${filename}\n\nCONTENT (truncated):\n${text}`;
  if (contextBackend === "api") {
    return await runStructuredApi<{ summary: string; tags: string[] }>(
      userPrompt,
      SUMMARY_INSTRUCTIONS,
      SUMMARY_SCHEMA,
      SUMMARY_MODEL,
      "submit_summary",
    );
  }
  return await runStructuredAgent<{ summary: string; tags: string[] }>(
    userPrompt,
    SUMMARY_INSTRUCTIONS,
    SUMMARY_SCHEMA,
    SUMMARY_MODEL,
  );
}

async function pickFiles(query: string, candidates: PickerCandidate[], k: number, backend: Backend): Promise<PickResult[]> {
  const candidateLines = candidates
    .map((c) => `- ${c.path} | ${c.summary} | tags: ${c.tags.join(", ")}`)
    .join("\n");
  const userPrompt = `QUERY:\n${query}\n\nCANDIDATES (path | summary | tags):\n${candidateLines}\n\nReturn up to ${k} picks.`;
  if (backend === "api") {
    const out = await runStructuredApi<{ picks: PickResult[] }>(
      userPrompt,
      PICK_INSTRUCTIONS,
      PICK_SCHEMA,
      PICK_MODEL,
      "submit_picks",
    );
    return out.picks ?? [];
  }
  const out = await runStructuredAgent<{ picks: PickResult[] }>(
    userPrompt,
    PICK_INSTRUCTIONS,
    PICK_SCHEMA,
    PICK_MODEL,
  );
  return out.picks ?? [];
}

async function extractMemory(raw: string, backend: Backend): Promise<{ signal: string; title: string }> {
  const prompt = `RAW INPUT:\n${raw}`;
  const out = backend === "api"
    ? await runStructuredApi<{ signal: string; title: string }>(
        prompt,
        MEMORY_INSTRUCTIONS,
        MEMORY_SCHEMA,
        MEMORY_MODEL,
        "submit_memory",
      )
    : await runStructuredAgent<{ signal: string; title: string }>(prompt, MEMORY_INSTRUCTIONS, MEMORY_SCHEMA, MEMORY_MODEL);
  return { signal: out.signal ?? "", title: out.title ?? "" };
}

function renderContextBlock(picks: PickedFile[]): string {
  if (picks.length === 0) return "";
  const parts: string[] = ["The following reference material was selected as relevant. Use it to inform the draft when applicable; ignore anything that doesn't fit."];
  for (const p of picks) {
    parts.push(`---\nFILE: ${p.path}\nWHY: ${p.reason}\nCONTENT:\n${p.text}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Edit template (with context pre-fetch)
// ---------------------------------------------------------------------------

const EDIT_MODEL = "claude-haiku-4-5-20251001";

const EDIT_INSTRUCTIONS = `You are editing a reply-template draft on behalf of the user.
Each turn the user gives an instruction (e.g. "make it more polite", "add an apology",
"shorten it"). Apply the instruction to the current draft and return the FULL updated
draft along with a one-paragraph reasoning explaining what you changed.

Rules:
- Preserve {{variable}} placeholders unless the user explicitly asks to remove them.
- Keep changes targeted — do not rewrite the entire message unless asked.
- "opening" is the greeting line; "body" is everything else.
- If the current draft is empty (both opening and body blank), treat the user's
  instruction as a request to draft a new template from scratch. Use {{variable}}
  placeholders for names, dates, or other context the recipient should fill in.
- If the user's instruction is unclear or unsafe to apply, return the draft unchanged
  and explain why in reasoning.`;

const EDIT_SCHEMA = {
  type: "object",
  required: ["reasoning", "updated"],
  additionalProperties: false,
  properties: {
    reasoning: { type: "string" },
    updated: {
      type: "object",
      required: ["opening", "body"],
      additionalProperties: false,
      properties: {
        opening: { type: "string" },
        body: { type: "string" },
      },
    },
  },
} as const;

function buildEditPrompt(req: EditTemplateRequest): string {
  const historyBlock =
    req.history.length === 0
      ? "(no prior turns)"
      : req.history
          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
          .join("\n\n");
  return `CURRENT DRAFT:
Opening: ${req.draft.opening}
Body:
${req.draft.body}

PRIOR CONVERSATION:
${historyBlock}

NEW INSTRUCTION:
${req.prompt}`;
}

async function fetchContextForEdit(req: EditTemplateRequest): Promise<PickedFile[]> {
  const query = `${req.prompt}\n\nCurrent draft body:\n${req.draft.body}`;
  return await pickRelevantFiles(query, (q, cs, k) => pickFiles(q, cs, k, req.backend));
}

async function timedPick(fetcher: () => Promise<PickedFile[]>): Promise<{ picks: PickedFile[]; pickMs: number }> {
  const started = Date.now();
  const picks = await fetcher();
  return { picks, pickMs: Date.now() - started };
}

function withPickTiming(response: Response, pickMs: number): Response {
  if (!response.ok) return response;
  return { ...response, timings: { pick_ms: pickMs } };
}

function editSystemPrompt(contextBlock: string): string {
  return contextBlock.length > 0 ? `${EDIT_INSTRUCTIONS}\n\n${contextBlock}` : EDIT_INSTRUCTIONS;
}

async function handleEditTemplate(req: EditTemplateRequest): Promise<Response> {
  const { picks, pickMs } = await timedPick(() => fetchContextForEdit(req));
  const contextBlock = renderContextBlock(picks);
  const response = req.backend === "api"
    ? await runEditApi(req, contextBlock)
    : await runEditAgent(req, contextBlock);
  return withPickTiming(response, pickMs);
}

async function runEditAgent(req: EditTemplateRequest, contextBlock: string): Promise<Response> {
  const stream = query({
    prompt: buildEditPrompt(req),
    options: {
      model: EDIT_MODEL,
      outputFormat: { type: "json_schema" as const, schema: EDIT_SCHEMA },
      systemPrompt: editSystemPrompt(contextBlock),
      includePartialMessages: true,
    },
  });

  let partial = "";
  for await (const msg of stream) {
    if (msg.type === "stream_event") {
      const event = msg.event as { type?: string; delta?: { type?: string; partial_json?: string; text?: string } };
      if (event.type === "content_block_delta" && event.delta) {
        const chunk = event.delta.partial_json ?? event.delta.text ?? "";
        if (chunk.length > 0) {
          partial += chunk;
          emitProgress(req.id, partial);
        }
      }
      continue;
    }
    if (msg.type !== "result") continue;
    if (msg.subtype === "success") {
      const out = msg.structured_output as
        | { reasoning?: string; updated?: { opening?: string; body?: string } }
        | undefined;
      if (!out || !out.updated || typeof out.updated.body !== "string") {
        return { id: req.id, ok: false, error: "agent sdk returned no updated draft" };
      }
      return {
        id: req.id,
        ok: true,
        reasoning: out.reasoning ?? "",
        updated: {
          opening: out.updated.opening ?? "",
          body: out.updated.body,
        },
      };
    }
    return {
      id: req.id,
      ok: false,
      error: `agent sdk ${msg.subtype}: ${(msg.errors ?? []).join("; ") || "unknown"}`,
    };
  }
  return { id: req.id, ok: false, error: "agent sdk stream ended without result" };
}

async function runEditApi(req: EditTemplateRequest, contextBlock: string): Promise<Response> {
  let client: Anthropic;
  try {
    client = getApiClient();
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }

  let msg;
  try {
    msg = await client.messages.create({
      model: EDIT_MODEL,
      max_tokens: 2048,
      system: editSystemPrompt(contextBlock),
      tools: [
        {
          name: EDIT_TOOL_NAME,
          description: "Submit the edited draft and reasoning as structured output.",
          input_schema: EDIT_SCHEMA as unknown as ApiInputSchema,
        },
      ],
      tool_choice: { type: "tool", name: EDIT_TOOL_NAME },
      messages: [{ role: "user", content: buildEditPrompt(req) }],
    });
  } catch (err) {
    return { id: req.id, ok: false, error: `anthropic api: ${(err as Error).message}` };
  }

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use" || block.name !== EDIT_TOOL_NAME) {
    return { id: req.id, ok: false, error: "anthropic api returned no tool_use block" };
  }
  const out = block.input as { reasoning?: string; updated?: { opening?: string; body?: string } };
  if (!out || !out.updated || typeof out.updated.body !== "string") {
    return { id: req.id, ok: false, error: "anthropic api returned no updated draft" };
  }
  return {
    id: req.id,
    ok: true,
    reasoning: out.reasoning ?? "",
    updated: {
      opening: out.updated.opening ?? "",
      body: out.updated.body,
    },
  };
}

// ---------------------------------------------------------------------------
// Adapt template (with context pre-fetch)
// ---------------------------------------------------------------------------

const ADAPT_MODEL = "claude-sonnet-4-6";

const ADAPT_INSTRUCTIONS = `You adapt a reply-template draft to fit a specific inbound message.

You are given:
- The current draft (opening + body) — a generic template.
- The inbound message it should reply to.

Produce a tailored draft that responds directly to the inbound. Preserve the
template's intent and tone, but make it specific: reference details from the
inbound where it improves the reply, and drop boilerplate that no longer fits.

Rules:
- Keep {{variable}} placeholders unless concrete info from the inbound lets
  you fill them in naturally.
- "opening" is the greeting line; "body" is everything else.
- Reasoning (one short paragraph) should explain what you changed and why.`;

function buildAdaptPrompt(req: AdaptTemplateRequest): string {
  return `INBOUND MESSAGE:
${req.inbound}

CURRENT DRAFT:
Opening: ${req.draft.opening}
Body:
${req.draft.body}`;
}

async function fetchContextForAdapt(req: AdaptTemplateRequest): Promise<PickedFile[]> {
  return await pickRelevantFiles(req.inbound, (q, cs, k) => pickFiles(q, cs, k, req.backend));
}

function adaptSystemPrompt(contextBlock: string): string {
  return contextBlock.length > 0 ? `${ADAPT_INSTRUCTIONS}\n\n${contextBlock}` : ADAPT_INSTRUCTIONS;
}

async function handleAdaptTemplate(req: AdaptTemplateRequest): Promise<Response> {
  const { picks, pickMs } = await timedPick(() => fetchContextForAdapt(req));
  const contextBlock = renderContextBlock(picks);
  const response = req.backend === "api"
    ? await runAdaptApi(req, contextBlock, picks)
    : await runAdaptAgent(req, contextBlock, picks);
  return withPickTiming(response, pickMs);
}

function pickedFilesPayload(picks: PickedFile[]): Array<{ path: string; summary: string; reason: string }> {
  return picks.map((p) => ({ path: p.path, summary: p.summary, reason: p.reason }));
}

async function runAdaptAgent(
  req: AdaptTemplateRequest,
  contextBlock: string,
  picks: PickedFile[],
): Promise<Response> {
  const stream = query({
    prompt: buildAdaptPrompt(req),
    options: {
      model: ADAPT_MODEL,
      outputFormat: { type: "json_schema" as const, schema: EDIT_SCHEMA },
      systemPrompt: adaptSystemPrompt(contextBlock),
      includePartialMessages: true,
    },
  });

  let partial = "";
  for await (const msg of stream) {
    if (msg.type === "stream_event") {
      const event = msg.event as { type?: string; delta?: { type?: string; partial_json?: string; text?: string } };
      if (event.type === "content_block_delta" && event.delta) {
        const chunk = event.delta.partial_json ?? event.delta.text ?? "";
        if (chunk.length > 0) {
          partial += chunk;
          emitProgress(req.id, partial);
        }
      }
      continue;
    }
    if (msg.type !== "result") continue;
    if (msg.subtype === "success") {
      const out = msg.structured_output as
        | { reasoning?: string; updated?: { opening?: string; body?: string } }
        | undefined;
      if (!out || !out.updated || typeof out.updated.body !== "string") {
        return { id: req.id, ok: false, error: "agent sdk returned no updated draft" };
      }
      return {
        id: req.id,
        ok: true,
        reasoning: out.reasoning ?? "",
        updated: {
          opening: out.updated.opening ?? "",
          body: out.updated.body,
        },
        context_used: pickedFilesPayload(picks),
      };
    }
    return {
      id: req.id,
      ok: false,
      error: `agent sdk ${msg.subtype}: ${(msg.errors ?? []).join("; ") || "unknown"}`,
    };
  }
  return { id: req.id, ok: false, error: "agent sdk stream ended without result" };
}

async function runAdaptApi(
  req: AdaptTemplateRequest,
  contextBlock: string,
  picks: PickedFile[],
): Promise<Response> {
  let client: Anthropic;
  try {
    client = getApiClient();
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }

  let msg;
  try {
    msg = await client.messages.create({
      model: ADAPT_MODEL,
      max_tokens: 2048,
      system: adaptSystemPrompt(contextBlock),
      tools: [
        {
          name: EDIT_TOOL_NAME,
          description: "Submit the adapted draft and reasoning as structured output.",
          input_schema: EDIT_SCHEMA as unknown as ApiInputSchema,
        },
      ],
      tool_choice: { type: "tool", name: EDIT_TOOL_NAME },
      messages: [{ role: "user", content: buildAdaptPrompt(req) }],
    });
  } catch (err) {
    return { id: req.id, ok: false, error: `anthropic api: ${(err as Error).message}` };
  }

  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use" || block.name !== EDIT_TOOL_NAME) {
    return { id: req.id, ok: false, error: "anthropic api returned no tool_use block" };
  }
  const out = block.input as { reasoning?: string; updated?: { opening?: string; body?: string } };
  if (!out || !out.updated || typeof out.updated.body !== "string") {
    return { id: req.id, ok: false, error: "anthropic api returned no updated draft" };
  }
  return {
    id: req.id,
    ok: true,
    reasoning: out.reasoning ?? "",
    updated: {
      opening: out.updated.opening ?? "",
      body: out.updated.body,
    },
    context_used: pickedFilesPayload(picks),
  };
}

// ---------------------------------------------------------------------------
// Context ops
// ---------------------------------------------------------------------------

async function handleContextSetSources(req: ContextSetSourcesRequest): Promise<Response> {
  contextBackend = req.backend;
  try {
    await ctxSetSources(req.sources);
    return { id: req.id, ok: true, status: contextStatus() };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

function handleContextStatus(req: ContextStatusRequest): Response {
  try {
    return { id: req.id, ok: true, status: contextStatus() };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

function handleContextListFiles(req: ContextListFilesRequest): Response {
  try {
    const files = contextListFiles(req.source).map((f) => ({
      path: f.path,
      source_root: f.source_root,
      ext: f.ext,
      mtime_ms: f.mtime_ms,
      size_bytes: f.size_bytes,
      summary: f.summary,
      tags: f.tags,
      status: f.status,
      error: f.error,
      ingested_at: f.ingested_at,
    }));
    return { id: req.id, ok: true, files };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

async function handleContextRescan(req: ContextRescanRequest): Promise<Response> {
  try {
    if (req.source) {
      await rescanSource(req.source);
    } else {
      await rescanAll();
    }
    return { id: req.id, ok: true, status: contextStatus() };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

function handleContextReadFile(req: ContextReadFileRequest): Response {
  try {
    const r = readContextFile(req.path);
    if (!r) return { id: req.id, ok: false, error: "file not in index" };
    return { id: req.id, ok: true, ...r };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

function handleContextSearch(req: ContextSearchRequest): Response {
  try {
    const files = searchContextFiles(req.query, req.limit ?? 30).map((f) => ({
      path: f.path,
      source_root: f.source_root,
      ext: f.ext,
      mtime_ms: f.mtime_ms,
      summary: f.summary,
      tags: f.tags,
      score: f.score,
    }));
    return { id: req.id, ok: true, files };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

async function handleContextCaptureMemory(req: ContextCaptureMemoryRequest): Promise<Response> {
  try {
    const result = await ctxCaptureMemory(
      req.raw,
      req.source,
      (raw) => extractMemory(raw, req.backend),
    );
    return { id: req.id, ok: true, ...result };
  } catch (err) {
    return { id: req.id, ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function handle(request: Request): Promise<Response> {
  switch (request.op) {
    case "ping":
      return { id: request.id, ok: true, pong: true, pid: process.pid };
    case "rank":
      return await handleRank(request);
    case "edit-template":
      return await handleEditTemplate(request);
    case "adapt-template":
      return await handleAdaptTemplate(request);
    case "context-set-sources":
      return await handleContextSetSources(request);
    case "context-status":
      return handleContextStatus(request);
    case "context-list-files":
      return handleContextListFiles(request);
    case "context-rescan":
      return await handleContextRescan(request);
    case "context-read-file":
      return handleContextReadFile(request);
    case "context-search":
      return handleContextSearch(request);
    case "context-capture-memory":
      return await handleContextCaptureMemory(request);
    default: {
      const _exhaustive: never = request;
      return { id: (_exhaustive as { id: string }).id, ok: false, error: "unknown op" };
    }
  }
}

// Initialize context index lazily but synchronously at startup so the first
// context-set-sources call doesn't race against table creation.
try {
  initContext(CONTEXT_DB_PATH, summarizeFile);
} catch (err) {
  process.stderr.write(`context init failed: ${(err as Error).message}\n`);
}

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;

  const parsed = parseRequestLine(trimmed);
  if (!parsed.ok) {
    send(parsed.response);
    return;
  }
  const request = parsed.request as Request;

  try {
    send(await handle(request));
  } catch (err) {
    send({ id: request.id, ok: false, error: (err as Error).message });
  }
});

rl.on("close", () => process.exit(0));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

process.stderr.write(`sidecar ready (pid ${process.pid}, data dir ${APP_DATA_DIR})\n`);
