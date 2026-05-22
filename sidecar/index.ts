/**
 * Sidecar entrypoint. Reads newline-delimited JSON requests from stdin,
 * writes newline-delimited JSON responses to stdout.
 *
 * Protocol (request):  { "id": string, "op": "ping" | "rank", ...args }
 * Protocol (response): { "id": string, "ok": true, ... } | { "id": string, "ok": false, "error": string }
 *
 * Concurrency: Rust serializes calls via a Mutex, so at most one request is
 * in flight at a time. We handle each line awaited-in-order.
 *
 * Performance:
 *   1. WarmQuery: a Claude CLI subprocess is kept pre-spawned with the rank
 *      system prompt baked in, so each rank skips the ~1-2s startup handshake.
 *   2. Prompt caching: the catalog is placed BEFORE SYSTEM_PROMPT_DYNAMIC_BOUNDARY
 *      in systemPrompt[]. Anthropic caches that prefix (5-min TTL). Catalog
 *      changes (template edited/added/deleted) → cache miss + warm rebuild.
 *
 * Cache hit path (template list stable, requests within 5min): ~0.5-0.8s.
 * Cache miss / first call after launch: ~2s.
 */

import { createInterface } from "node:readline";
import {
  query,
  startup,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";

// Capture the API key once at startup, then strip it from the process env so
// the Agent SDK and any subprocess it spawns can never observe it. This makes
// the Settings backend toggle the SOLE source of truth for auth: Agent mode
// always uses the user's Claude subscription, API mode always uses the
// captured key. Without this, an `ANTHROPIC_API_KEY` env var would silently
// override Agent mode and bill against the API.
const apiKeyForApiMode: string | null = process.env.ANTHROPIC_API_KEY ?? null;
delete process.env.ANTHROPIC_API_KEY;

type Backend = "agent" | "api";

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

type Request = PingRequest | RankRequest | EditTemplateRequest;

type Response =
  | { id: string; ok: true; [k: string]: unknown }
  | { id: string; ok: false; error: string };

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

/**
 * Cheap-but-unique key identifying a catalog's content. If anything that
 * affects the systemPrompt changes (id, name, body snippet, order), the key
 * changes and we rebuild the warm subprocess.
 */
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
  } catch (err) {
    // Cold fallback if WarmQuery setup failed (e.g. SDK auth issue).
    // Prompt cache still applies on subsequent cold calls within 5min.
    stream = query({ prompt: userPrompt, options: opts });
  }

  // Pre-warm the next subprocess with the same catalog so cache-hit path stays warm.
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

// Direct Anthropic Messages API path — used when the user picks "Anthropic
// API" in Settings. Bypasses the Agent SDK entirely so paste-match works
// with raw API billing on accounts without Agent SDK access.
//
// Structured output is enforced via tool_use (the API's equivalent of the
// Agent SDK's outputFormat). Prompt caching mirrors the Agent SDK behaviour:
// the catalog block carries cache_control:"ephemeral" so the catalog prefix
// is cached for 5min and reused across requests with the same template list.
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

// The schemas are `as const` so the Agent SDK can read literal types from
// them; the Anthropic SDK's Tool.InputSchema wants a mutable shape, so cast
// at the boundary rather than dropping `as const` and losing type info for
// the Agent path.
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

async function handleEditTemplate(req: EditTemplateRequest): Promise<Response> {
  if (req.backend === "api") return runEditApi(req);
  return runEditAgent(req);
}

async function runEditAgent(req: EditTemplateRequest): Promise<Response> {
  const stream = query({
    prompt: buildEditPrompt(req),
    options: {
      model: EDIT_MODEL,
      outputFormat: { type: "json_schema" as const, schema: EDIT_SCHEMA },
      systemPrompt: EDIT_INSTRUCTIONS,
    },
  });

  for await (const msg of stream) {
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

async function runEditApi(req: EditTemplateRequest): Promise<Response> {
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
      system: EDIT_INSTRUCTIONS,
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

async function handle(request: Request): Promise<Response> {
  switch (request.op) {
    case "ping":
      return { id: request.id, ok: true, pong: true, pid: process.pid };
    case "rank":
      return await handleRank(request);
    case "edit-template":
      return await handleEditTemplate(request);
    default: {
      const _exhaustive: never = request;
      return { id: (_exhaustive as { id: string }).id, ok: false, error: "unknown op" };
    }
  }
}

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;

  let request: Request;
  try {
    request = JSON.parse(trimmed) as Request;
  } catch (err) {
    send({ id: "?", ok: false, error: `parse error: ${(err as Error).message}` });
    return;
  }

  try {
    send(await handle(request));
  } catch (err) {
    send({ id: request.id, ok: false, error: (err as Error).message });
  }
});

rl.on("close", () => process.exit(0));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

process.stderr.write(`sidecar ready (pid ${process.pid})\n`);
