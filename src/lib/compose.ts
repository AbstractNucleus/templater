import type { Template } from "./types";

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
  if (includeSignature && globalSignature.trim().length > 0) parts.push(globalSignature);
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

// Resolve a `<kind>` / `<kind>:<format>` token into its format + display
// label, or null if `trimmed` isn't this kind. Unknown formats fall back to
// `def`. Shared by the date and time cases below so they can't drift.
function parseFormatToken<F extends string>(
  trimmed: string,
  kind: string,
  formats: readonly F[],
  def: F,
): { format: F; label: string } | null {
  if (trimmed === kind) return { format: def, label: kind };
  if (trimmed.startsWith(`${kind}:`)) {
    const fmt = trimmed.slice(kind.length + 1).trim();
    const format = formats.find((f) => f === fmt) ?? def;
    return { format, label: `${kind} (${format})` };
  }
  return null;
}

// Parses the inner token (between the braces) into a typed placeholder.
// `date` and `date:<format>` auto-fill at compose time; `choice:a|b|c`
// renders as a dropdown; anything else is a free-text variable.
export function parsePlaceholder(inner: string): ParsedPlaceholder {
  const trimmed = inner.trim();
  const raw = `{{${inner}}}`;

  const date = parseFormatToken<DateFormat>(trimmed, "date", ["iso", "long"], "iso");
  if (date) {
    return { raw, key: trimmed, label: date.label, kind: { type: "date", format: date.format } };
  }
  const time = parseFormatToken<TimeFormat>(trimmed, "time", ["short", "long"], "short");
  if (time) {
    return { raw, key: trimmed, label: time.label, kind: { type: "time", format: time.format } };
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
// text/choice fall through to the raw token if no value is set. Built on
// splitPlaceholders so the substitution rules can never diverge between the
// preview (segments) and the copied text (this).
export function applyValues(
  text: string,
  values: Record<string, string>,
  now: Date = new Date(),
  snippets: Record<string, string> = {},
): string {
  return splitPlaceholders(text, values, now, snippets)
    .map((s) => s.text)
    .join("");
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
