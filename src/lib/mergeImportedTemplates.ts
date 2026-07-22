import { pushHistorySnapshot } from "$lib/templateHistory";
import { normalizeTags, validateCatalogIds, withNormalizedTags } from "$lib/catalog";
import type { Template } from "$lib/types";

export type MergeImportResult = {
  templates: Template[];
  added: number;
  overwritten: number;
  skipped: number;
};

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

/**
 * Pure merge of an import into the local template list.
 * Rejects empty/duplicate ids in the incoming file. Normalizes tags.
 * Updates the id index when adding so duplicate new ids cannot slip through
 * if validation is bypassed.
 */
export function mergeImportedTemplates(
  existing: Template[],
  incoming: Template[],
  overwrite: boolean,
  now: string = new Date().toISOString(),
): MergeImportResult {
  const incomingErr = validateCatalogIds(incoming);
  if (incomingErr) {
    if (incomingErr.kind === "empty_id") {
      throw new ImportValidationError(
        `import rejected: template at index ${incomingErr.index} has an empty id`,
      );
    }
    throw new ImportValidationError(
      `import rejected: duplicate template id "${incomingErr.id}" in import file`,
    );
  }

  const existingIndex = new Map(existing.map((t, i) => [t.id, i]));
  const addedIds = new Set<string>();
  const next = [...existing];
  const additions: Template[] = [];
  let overwritten = 0;
  let skipped = 0;

  for (const raw of incoming) {
    const tpl = withNormalizedTags(raw);
    const existingAt = existingIndex.get(tpl.id);
    if (existingAt === undefined) {
      if (addedIds.has(tpl.id)) {
        skipped += 1;
        continue;
      }
      additions.push(tpl);
      addedIds.add(tpl.id);
    } else if (!overwrite) {
      skipped += 1;
    } else {
      const local = next[existingAt];
      next[existingAt] = {
        ...local,
        name: tpl.name,
        tags: normalizeTags(tpl.tags),
        folder: tpl.folder,
        opening: tpl.opening,
        body: tpl.body,
        updated_at: now,
        history: pushHistorySnapshot(local, now),
      };
      overwritten += 1;
    }
  }

  // Prepend new additions in file order so the imported chunk lands at the
  // top and keeps its internal ordering. Overwrites stayed in place above.
  return {
    templates: [...additions, ...next],
    added: additions.length,
    overwritten,
    skipped,
  };
}
