import type { Template } from "./types";

/** Pick the signature for a template — per-template override wins over global. */
export function resolveSignature(template: Template, globalSignature: string): string {
  const override = template.signature_override;
  if (override !== null && override.length > 0) return override;
  return globalSignature;
}

// Source of truth for the text put on the clipboard. Shared by the Copy
// button in MainPanel and the Enter-from-search shortcut in +page.svelte so
// both paths produce identical output.
export function composeText(
  template: Template,
  includeOpening: boolean,
  includeSignature: boolean,
  globalSignature: string,
): string {
  const parts: string[] = [];
  if (includeOpening && template.opening.trim().length > 0) parts.push(template.opening);
  parts.push(template.body);
  const sig = resolveSignature(template, globalSignature);
  if (includeSignature && sig.trim().length > 0) parts.push(sig);
  return parts.join("\n\n");
}

// Non-greedy, no nested braces. Captures the bare token (without braces) so
// callers can parse it into a kind + key.
const PLACEHOLDER_RE = /\{\{([^{}]+?)\}\}/g;

export type DateFormat = "iso" | "long";
export type TimeFormat = "short" | "long";

export type PlaceholderKind =
  | { type: "text" }
  | { type: "date"; format: DateFormat }
  | { type: "time"; format: TimeFormat }
  | { type: "choice"; options: string[] };

export interface ParsedPlaceholder {
  /** Exact source token including braces, e.g. "{{date:long}}". */
  raw: string;
  /** Key used in the persisted fill-in map. For text: trimmed name (so
   *  `{{ name }}` and `{{name}}` dedupe). For typed placeholders: the
   *  inner token, so different formats / option lists get separate slots. */
  key: string;
  /** Human-facing label shown in chip rows. */
  label: string;
  kind: PlaceholderKind;
}

// Parses the inner token (between the braces) into a typed placeholder.
// `date` and `date:<format>` auto-fill at compose time; `choice:a|b|c`
// renders as a dropdown; anything else is a free-text variable.
export function parsePlaceholder(inner: string): ParsedPlaceholder {
  const trimmed = inner.trim();
  const raw = `{{${inner}}}`;

  if (trimmed === "date") {
    return { raw, key: trimmed, label: "date", kind: { type: "date", format: "iso" } };
  }
  if (trimmed.startsWith("date:")) {
    const fmt = trimmed.slice("date:".length).trim();
    const format: DateFormat = fmt === "long" ? "long" : "iso";
    return {
      raw,
      key: trimmed,
      label: `date (${format})`,
      kind: { type: "date", format },
    };
  }
  if (trimmed === "time") {
    return { raw, key: trimmed, label: "time", kind: { type: "time", format: "short" } };
  }
  if (trimmed.startsWith("time:")) {
    const fmt = trimmed.slice("time:".length).trim();
    const format: TimeFormat = fmt === "long" ? "long" : "short";
    return {
      raw,
      key: trimmed,
      label: `time (${format})`,
      kind: { type: "time", format },
    };
  }
  if (trimmed.startsWith("choice:")) {
    const optsStr = trimmed.slice("choice:".length);
    const options = optsStr
      .split("|")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    return {
      raw,
      key: trimmed,
      label: options.length > 0 ? options.join(" / ") : "choice",
      kind: { type: "choice", options },
    };
  }

  return { raw, key: trimmed, label: trimmed, kind: { type: "text" } };
}

export interface ComposedSegment {
  text: string;
  placeholder: boolean;
}

function formatDate(now: Date, format: DateFormat): string {
  if (format === "long") {
    return now.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  // ISO date in the local timezone (not UTC) — what most users mean by "today".
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(now: Date, format: TimeFormat): string {
  // 24h local. Locale-independent so templates stay consistent across machines.
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  if (format === "long") {
    const s = String(now.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return `${h}:${m}`;
}

/**
 * Resolve a parsed placeholder to its rendered string. Returns null when the
 * placeholder should fall through to the raw `{{...}}` token (text with no
 * fill value, or choice without a current selection).
 *
 * Precedence: per-template `values` > global `snippets` > fall-through.
 */
function resolveValue(
  p: ParsedPlaceholder,
  values: Record<string, string>,
  snippets: Record<string, string>,
  now: Date,
): string | null {
  if (p.kind.type === "date") return formatDate(now, p.kind.format);
  if (p.kind.type === "time") return formatTime(now, p.kind.format);
  const v = values[p.key];
  if (v && v.length > 0) return v;
  const s = snippets[p.key];
  if (s && s.length > 0) return s;
  return null;
}

export function splitPlaceholders(
  text: string,
  values: Record<string, string> = {},
  now: Date = new Date(),
  snippets: Record<string, string> = {},
): ComposedSegment[] {
  const segments: ComposedSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const start = m.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), placeholder: false });
    const p = parsePlaceholder(m[1]);
    const resolved = resolveValue(p, values, snippets, now);
    segments.push({ text: resolved ?? m[0], placeholder: true });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), placeholder: false });
  return segments;
}

// Substitute placeholders across the whole text. Dates always resolve;
// text/choice fall through to the raw token if no value is set.
export function applyValues(
  text: string,
  values: Record<string, string>,
  now: Date = new Date(),
  snippets: Record<string, string> = {},
): string {
  return text.replace(PLACEHOLDER_RE, (raw, inner: string) => {
    const p = parsePlaceholder(inner);
    const resolved = resolveValue(p, values, snippets, now);
    return resolved ?? raw;
  });
}

/**
 * Unique placeholders in first-seen order, deduped by `key`. Date and time
 * placeholders are excluded — they need no UI (auto-filled at compose time).
 * Snippet-matched placeholders are also excluded since they auto-fill from
 * global settings.
 */
export function extractPlaceholders(
  text: string,
  snippets: Record<string, string> = {},
): ParsedPlaceholder[] {
  const seen = new Set<string>();
  const out: ParsedPlaceholder[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const p = parsePlaceholder(m[1]);
    if (p.kind.type === "date" || p.kind.type === "time") continue;
    if (p.key.length === 0 || seen.has(p.key)) continue;
    if (p.kind.type === "text" && snippets[p.key] && snippets[p.key].length > 0) continue;
    seen.add(p.key);
    out.push(p);
  }
  return out;
}
