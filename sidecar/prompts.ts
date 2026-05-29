/**
 * Prompt material for the sidecar: model-id resolution, the JSON schemas the
 * model fills, the system-prompt instruction strings, and the per-op prompt /
 * system-prompt builders. Kept free of transport concerns so index.ts can stay
 * focused on dispatch + response shaping.
 */

import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { PickedFile } from "./context.js";

export type ModelTier = "haiku" | "sonnet" | "opus";

/** Tier alias → concrete model id. The single source of truth for model ids;
 *  bump here when Anthropic ships new snapshots. */
const MODEL_IDS: Record<ModelTier, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
};

/** Resolve a stored tier alias to a concrete model id. Falls back to Haiku for
 *  anything unrecognized — settings.json is user-editable. */
export function resolveModel(tier: string | undefined): string {
  return MODEL_IDS[(tier ?? "") as ModelTier] ?? MODEL_IDS.haiku;
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type CatalogEntry = {
  id: string;
  name: string;
  tags?: string[];
  opening?: string;
  body: string;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

export const RANK_INSTRUCTIONS = `You match pasted messages against a reply-template catalog.
For each request, pick up to 5 best-matching templates from the catalog below
and return them as structured output.
Score each match 0..1 by semantic fit (intent, tone, scenario).
Use the exact template_id from the catalog. Skip weak matches — fewer is fine.`;

export const RANKINGS_SCHEMA = {
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

/** Agent-backend system prompt: a 3-element string[] whose boundary marker tells
 *  the SDK where the cacheable prefix (instructions + catalog) ends. */
export function buildRankSystemPrompt(catalog: CatalogEntry[]): string[] {
  return [
    RANK_INSTRUCTIONS,
    `CATALOG (id | name | snippet):\n${catalogToLines(catalog)}`,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  ];
}

/** API-backend system prompt: two text blocks, with cache_control on the catalog
 *  block so Anthropic caches it (prompt caching, 5-min TTL). */
export function buildRankApiSystem(catalog: CatalogEntry[]): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: RANK_INSTRUCTIONS },
    {
      type: "text",
      text: `CATALOG (id | name | snippet):\n${catalogToLines(catalog)}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

export function buildRankPrompt(pasted: string): string {
  return `PASTED MESSAGE:\n${pasted}`;
}

/** Stable cache key over a catalog's id/name/snippet — used to decide whether a
 *  pre-warmed rank handle is still valid. */
export function catalogKey(catalog: CatalogEntry[]): string {
  return catalog
    .map((t) => `${t.id}\0${t.name}\0${(t.body ?? "").slice(0, 200)}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Context: summarizer + picker + memory extractor
// ---------------------------------------------------------------------------

export const SUMMARY_SCHEMA = {
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

export const SUMMARY_INSTRUCTIONS = `You distill reference documents into a one-line gist plus a few topic tags.
The summary will help an AI later decide whether this file is relevant to a question.
Aim for 1-2 sentences. Tags should be short, lowercase, and topical (e.g. "refund-policy", "onboarding").`;

export const PICK_SCHEMA = {
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

export const PICK_INSTRUCTIONS = `You select reference files that are relevant to a query.
You are given a candidate list (path | summary | tags) and a query.
Return 0..k picks — fewer is better than forcing weak matches. Only pick files that
clearly help. Use the exact path from the candidate list.`;

export const MEMORY_SCHEMA = {
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

export const MEMORY_INSTRUCTIONS = `You extract durable signal from pasted messages (Slack threads, emails, notes).
Return one tight paragraph capturing the reusable knowledge — facts, decisions, procedures, names of people-and-what-they-own.
Drop greetings, scheduling, and one-off context. If the input has no durable signal, return an empty string.
Also return a short title (3-6 words) summarizing the topic — used as the filename and a UI heading.`;

export function buildSummaryPrompt(text: string, filename: string): string {
  return `FILENAME: ${filename}\n\nCONTENT (truncated):\n${text}`;
}

export function buildMemoryPrompt(raw: string): string {
  return `RAW INPUT:\n${raw}`;
}

export function renderContextBlock(picks: PickedFile[]): string {
  if (picks.length === 0) return "";
  const parts: string[] = ["The following reference material was selected as relevant. Use it to inform the draft when applicable; ignore anything that doesn't fit."];
  for (const p of picks) {
    parts.push(`---\nFILE: ${p.path}\nWHY: ${p.reason}\nCONTENT:\n${p.text}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Draft: edit + adapt (shared EDIT_SCHEMA, divergent instructions/prompts)
// ---------------------------------------------------------------------------

export const EDIT_INSTRUCTIONS = `You are editing a reply-template draft on behalf of the user.
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

export const ADAPT_INSTRUCTIONS = `You adapt a reply-template draft to fit a specific inbound message.

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

export const EDIT_SCHEMA = {
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

export function buildEditPrompt(draft: { opening: string; body: string }, history: ChatTurn[], prompt: string): string {
  const historyBlock =
    history.length === 0
      ? "(no prior turns)"
      : history
          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
          .join("\n\n");
  return `CURRENT DRAFT:
Opening: ${draft.opening}
Body:
${draft.body}

PRIOR CONVERSATION:
${historyBlock}

NEW INSTRUCTION:
${prompt}`;
}

export function buildAdaptPrompt(draft: { opening: string; body: string }, inbound: string): string {
  return `INBOUND MESSAGE:
${inbound}

CURRENT DRAFT:
Opening: ${draft.opening}
Body:
${draft.body}`;
}

/** Append the selected-context block to a draft instruction set, when present. */
export function withContextBlock(instructions: string, contextBlock: string): string {
  return contextBlock.length > 0 ? `${instructions}\n\n${contextBlock}` : instructions;
}
