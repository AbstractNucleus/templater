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
