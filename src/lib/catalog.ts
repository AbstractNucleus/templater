import { normalizeTag } from "$lib/tags";
import type { Template } from "$lib/types";

/** Normalize + dedupe tags (canonical form for create/edit/import/rename). */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Apply canonical tag form to a template (does not mutate). */
export function withNormalizedTags(template: Template): Template {
  const tags = normalizeTags(template.tags);
  if (tags.length === template.tags.length && tags.every((t, i) => t === template.tags[i])) {
    return template;
  }
  return { ...template, tags };
}

export type CatalogValidationError = {
  kind: "empty_id" | "duplicate_id";
  id?: string;
  index: number;
};

/**
 * Validate catalog ID invariants. Rejects empty ids and duplicates.
 * Used at import I/O boundary and as a guard before commit.
 */
export function validateCatalogIds(templates: Template[]): CatalogValidationError | null {
  const seen = new Set<string>();
  for (let i = 0; i < templates.length; i++) {
    const id = templates[i].id;
    if (typeof id !== "string" || id.trim().length === 0) {
      return { kind: "empty_id", index: i };
    }
    if (seen.has(id)) {
      return { kind: "duplicate_id", id, index: i };
    }
    seen.add(id);
  }
  return null;
}

export function formatCatalogValidationError(err: CatalogValidationError): string {
  if (err.kind === "empty_id") {
    return `import rejected: template at index ${err.index} has an empty id`;
  }
  return `import rejected: duplicate template id "${err.id}" at index ${err.index}`;
}

/** Rename a tag across a list, normalizing the destination name. */
export function renameTagInTemplates(
  templates: Template[],
  from: string,
  toRaw: string,
): Template[] {
  const to = normalizeTag(toRaw);
  if (to.length === 0 || from === to) return templates;
  return templates.map((t) => {
    if (!t.tags.includes(from)) return t;
    return { ...t, tags: normalizeTags(t.tags.map((tag) => (tag === from ? to : tag))) };
  });
}
