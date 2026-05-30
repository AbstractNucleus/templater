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
import { query, startup, type WarmQuery } from "@anthropic-ai/claude-agent-sdk";
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
import {
  ADAPT_INSTRUCTIONS,
  buildAdaptPrompt,
  buildEditPrompt,
  buildMemoryPrompt,
  buildRankApiSystem,
  buildRankPrompt,
  buildRankSystemPrompt,
  buildSummaryPrompt,
  catalogKey,
  EDIT_INSTRUCTIONS,
  EDIT_SCHEMA,
  MEMORY_INSTRUCTIONS,
  MEMORY_SCHEMA,
  PICK_INSTRUCTIONS,
  PICK_SCHEMA,
  RANKINGS_SCHEMA,
  renderContextBlock,
  resolveModel,
  SUMMARY_INSTRUCTIONS,
  SUMMARY_SCHEMA,
  withContextBlock,
  type CatalogEntry,
  type ChatTurn,
  type ModelTier,
} from "./prompts.js";
import { parseRequestLine } from "./protocol.js";
import { callStructured, initApiKey, type AgentStream, type Backend } from "./transport.js";

const APP_DATA_DIR = process.argv[2] ?? process.cwd();
const CONTEXT_DB_PATH = path.join(APP_DATA_DIR, "context.db");

// Capture the API key once at startup, then strip it from the process env so
// the Agent SDK and any subprocess it spawns can never observe it. This makes
// the Settings backend toggle the SOLE source of truth for auth: Agent mode
// always uses the user's Claude subscription, API mode always uses the
// captured key. Without this, an `ANTHROPIC_API_KEY` env var would silently
// override Agent mode and bill against the API.
initApiKey(process.env.ANTHROPIC_API_KEY ?? null);
delete process.env.ANTHROPIC_API_KEY;

/** Backend used by context-side calls (ingest summaries, memory extraction).
 *  Adapt + edit + rank still pass their own backend per request. */
let contextBackend: Backend = "agent";

/** Model tier for context-pipeline calls (ingest summaries + relevance picker).
 *  Set via context-set-sources alongside contextBackend. */
let contextModel: ModelTier = "haiku";

type PingRequest = { id: string; op: "ping" };

type RankRequest = {
  id: string;
  op: "rank";
  backend: Backend;
  model: ModelTier;
  pasted: string;
  catalog: CatalogEntry[];
};

type EditTemplateRequest = {
  id: string;
  op: "edit-template";
  backend: Backend;
  model: ModelTier;
  draft: { opening: string; body: string };
  history: ChatTurn[];
  prompt: string;
};

type AdaptTemplateRequest = {
  id: string;
  op: "adapt-template";
  backend: Backend;
  model: ModelTier;
  draft: { opening: string; body: string };
  inbound: string;
};

type ContextSetSourcesRequest = {
  id: string;
  op: "context-set-sources";
  sources: string[];
  backend: Backend;
  model: ModelTier;
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
  model: ModelTier;
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

const RANK_TOOL_NAME = "submit_rankings";
const EDIT_TOOL_NAME = "submit_edit";

/** Build the agent-SDK options used both for pre-warming (`startup`) and as the
 *  cold-start fallback. systemPrompt is the boundary-marked string[] form. */
function rankOptions(catalog: CatalogEntry[], model: string) {
  return {
    model,
    outputFormat: { type: "json_schema" as const, schema: RANKINGS_SCHEMA },
    systemPrompt: buildRankSystemPrompt(catalog),
  };
}

let warmKey: string | null = null;
let warmHandle: Promise<WarmQuery> | null = null;

function prewarmRank(catalog: CatalogEntry[], model: string): Promise<WarmQuery> {
  // Key on model too: changing the rank model in Settings must invalidate a
  // handle that was pre-spawned with the old model.
  const key = `${model}\0${catalogKey(catalog)}`;
  if (warmKey === key && warmHandle) return warmHandle;
  warmKey = key;
  warmHandle = startup({ options: rankOptions(catalog, model) }).catch((err) => {
    warmHandle = null;
    warmKey = null;
    throw err;
  });
  return warmHandle;
}

async function takeWarmRank(catalog: CatalogEntry[], model: string): Promise<WarmQuery> {
  const handle = await prewarmRank(catalog, model);
  warmHandle = null;
  warmKey = null;
  return handle;
}

/** Obtain the agent stream for a rank request: consume a pre-warmed handle when
 *  one is ready (skips the ~1-2s startup handshake), else cold-start via the
 *  cold fallback options. Re-prewarms in the background for the next call. */
async function rankAgentStream(req: RankRequest, model: string): Promise<AgentStream> {
  const userPrompt = buildRankPrompt(req.pasted);
  let stream: AgentStream;
  try {
    const handle = await takeWarmRank(req.catalog, model);
    stream = handle.query(userPrompt);
  } catch {
    stream = query({ prompt: userPrompt, options: rankOptions(req.catalog, model) });
  }
  prewarmRank(req.catalog, model).catch(() => {});
  return stream;
}

function send(response: Response): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

async function handleRank(req: RankRequest): Promise<Response> {
  const model = resolveModel(req.model);
  // Agent backend: hand callStructured a (warm or cold) pre-built stream that
  // already carries the boundary-marked systemPrompt. API backend: pass the
  // two-block system with cache_control on the catalog so prompt caching holds.
  const out = await callStructured<{ rankings?: Ranking[] }>(req.backend, {
    prompt: buildRankPrompt(req.pasted),
    system: buildRankApiSystem(req.catalog),
    agentStream: req.backend === "agent" ? await rankAgentStream(req, model) : undefined,
    schema: RANKINGS_SCHEMA as unknown as Record<string, unknown>,
    model,
    toolName: RANK_TOOL_NAME,
    toolDescription: "Submit the ranked template matches as structured output.",
  });
  if (!out || !Array.isArray(out.rankings)) {
    return { id: req.id, ok: false, error: "model returned no rankings" };
  }
  return { id: req.id, ok: true, rankings: out.rankings };
}

// ---------------------------------------------------------------------------
// Context: summarizer + picker + memory extractor
// ---------------------------------------------------------------------------

async function summarizeFile(text: string, filename: string): Promise<{ summary: string; tags: string[] }> {
  return await callStructured<{ summary: string; tags: string[] }>(contextBackend, {
    prompt: buildSummaryPrompt(text, filename),
    system: SUMMARY_INSTRUCTIONS,
    schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    model: resolveModel(contextModel),
    toolName: "submit_summary",
  });
}

async function pickFiles(query: string, candidates: PickerCandidate[], k: number, backend: Backend): Promise<PickResult[]> {
  const candidateLines = candidates
    .map((c) => `- ${c.path} | ${c.summary} | tags: ${c.tags.join(", ")}`)
    .join("\n");
  const userPrompt = `QUERY:\n${query}\n\nCANDIDATES (path | summary | tags):\n${candidateLines}\n\nReturn up to ${k} picks.`;
  const out = await callStructured<{ picks: PickResult[] }>(backend, {
    prompt: userPrompt,
    system: PICK_INSTRUCTIONS,
    schema: PICK_SCHEMA as unknown as Record<string, unknown>,
    model: resolveModel(contextModel),
    toolName: "submit_picks",
  });
  return out.picks ?? [];
}

async function extractMemory(raw: string, backend: Backend, model: string): Promise<{ signal: string; title: string }> {
  const out = await callStructured<{ signal: string; title: string }>(backend, {
    prompt: buildMemoryPrompt(raw),
    system: MEMORY_INSTRUCTIONS,
    schema: MEMORY_SCHEMA as unknown as Record<string, unknown>,
    model,
    toolName: "submit_memory",
  });
  return { signal: out.signal ?? "", title: out.title ?? "" };
}

// ---------------------------------------------------------------------------
// Draft (edit + adapt): shared transport + result shaping, divergent framing
// ---------------------------------------------------------------------------

type DraftOutput = { reasoning?: string; updated?: { opening?: string; body?: string } };

interface DraftSpec {
  /** Draft instruction set (edit vs adapt). */
  instructions: string;
  /** The user prompt for the draft call. */
  prompt: string;
  /** Query text for context pre-fetch. */
  contextQuery: string;
  /** Tool description for the API backend. */
  toolDescription: string;
  /** Whether to attach the `context_used` payload (adapt only). */
  includeContextUsed: boolean;
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

function pickedFilesPayload(picks: PickedFile[]): Array<{ path: string; summary: string; reason: string }> {
  return picks.map((p) => ({ path: p.path, summary: p.summary, reason: p.reason }));
}

/** Shared driver for edit + adapt: pre-fetch context, run the structured draft
 *  call (streaming partial text on the agent backend), shape the response. */
async function handleDraft(
  req: EditTemplateRequest | AdaptTemplateRequest,
  spec: DraftSpec,
): Promise<Response> {
  const { picks, pickMs } = await timedPick(() =>
    pickRelevantFiles(spec.contextQuery, (q, cs, k) => pickFiles(q, cs, k, req.backend)),
  );
  const contextBlock = renderContextBlock(picks);

  const out = await callStructured<DraftOutput>(req.backend, {
    prompt: spec.prompt,
    system: withContextBlock(spec.instructions, contextBlock),
    schema: EDIT_SCHEMA as unknown as Record<string, unknown>,
    model: resolveModel(req.model),
    toolName: EDIT_TOOL_NAME,
    toolDescription: spec.toolDescription,
    maxTokens: 2048,
    onPartial: (text) => emitProgress(req.id, text),
  });

  if (!out || !out.updated || typeof out.updated.body !== "string") {
    return { id: req.id, ok: false, error: "model returned no updated draft" };
  }
  const response: Response = {
    id: req.id,
    ok: true,
    reasoning: out.reasoning ?? "",
    updated: {
      opening: out.updated.opening ?? "",
      body: out.updated.body,
    },
    ...(spec.includeContextUsed ? { context_used: pickedFilesPayload(picks) } : {}),
  };
  return withPickTiming(response, pickMs);
}

function handleEditTemplate(req: EditTemplateRequest): Promise<Response> {
  return handleDraft(req, {
    instructions: EDIT_INSTRUCTIONS,
    prompt: buildEditPrompt(req.draft, req.history, req.prompt),
    contextQuery: `${req.prompt}\n\nCurrent draft body:\n${req.draft.body}`,
    toolDescription: "Submit the edited draft and reasoning as structured output.",
    includeContextUsed: false,
  });
}

function handleAdaptTemplate(req: AdaptTemplateRequest): Promise<Response> {
  return handleDraft(req, {
    instructions: ADAPT_INSTRUCTIONS,
    prompt: buildAdaptPrompt(req.draft, req.inbound),
    contextQuery: req.inbound,
    toolDescription: "Submit the adapted draft and reasoning as structured output.",
    includeContextUsed: true,
  });
}

// ---------------------------------------------------------------------------
// Context ops
// ---------------------------------------------------------------------------

async function handleContextSetSources(req: ContextSetSourcesRequest): Promise<Response> {
  contextBackend = req.backend;
  contextModel = req.model;
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
      (raw) => extractMemory(raw, req.backend, resolveModel(req.model)),
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
