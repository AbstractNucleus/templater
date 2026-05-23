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

export function splitPlaceholders(text: string): ComposedSegment[] {
  const segments: ComposedSegment[] = [];
  let cursor = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const start = m.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), placeholder: false });
    segments.push({ text: m[0], placeholder: true });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), placeholder: false });
  return segments;
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
