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

// Non-greedy, no nested braces. Captures the bare variable name so callers
// can dedupe + chip-render it without the surrounding braces.
const PLACEHOLDER_RE = /\{\{([^{}]+?)\}\}/g;

export interface ComposedSegment {
  text: string;
  placeholder: boolean;
}

export function splitPlaceholders(
  text: string,
  values: Record<string, string> = {},
): ComposedSegment[] {
  const segments: ComposedSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const start = m.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), placeholder: false });
    const name = m[1].trim();
    const v = values[name];
    segments.push({ text: v && v.length > 0 ? v : m[0], placeholder: true });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), placeholder: false });
  return segments;
}

// Substitute {{var}} with values[var] across the whole text. Empty/missing
// values leave the raw {{var}} in place so the user can still copy-and-edit
// later if they didn't fill every slot.
export function applyValues(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (raw, rawName: string) => {
    const v = values[rawName.trim()];
    return v && v.length > 0 ? v : raw;
  });
}

export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const name = m[1].trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
