import { pushHistorySnapshot } from "$lib/templateHistory";
import type { Template } from "$lib/types";

export type MergeImportResult = {
  templates: Template[];
  added: number;
  overwritten: number;
  skipped: number;
};

/** Pure merge of an import into the local template list. */
export function mergeImportedTemplates(
  existing: Template[],
  incoming: Template[],
  overwrite: boolean,
  now: string = new Date().toISOString(),
): MergeImportResult {
  const index = new Map(existing.map((t, i) => [t.id, i]));
  const next = [...existing];
  const additions: Template[] = [];
  let overwritten = 0;
  let skipped = 0;

  for (const tpl of incoming) {
    const i = index.get(tpl.id);
    if (i === undefined) {
      additions.push(tpl);
    } else if (!overwrite) {
      skipped += 1;
    } else {
      const local = next[i];
      next[i] = {
        ...local,
        name: tpl.name,
        tags: tpl.tags,
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
