import type { Template } from "./types";

/** Canonical tag normalization: trim + lowercase. Keeps tag creation,
 *  bulk-tagging, and the tag picker from producing case-variant duplicates
 *  (e.g. "Email" alongside an existing "email"). */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Tag → usage-count pairs ordered for display: persisted `tagOrder` first,
 *  then by count descending, then name ascending. Shared by the Tags sidebar
 *  and the Settings tag manager so the two can't drift. */
export function orderedTagCounts(
  templates: Template[],
  tagOrder: string[],
): [string, number][] {
  const counts = new Map<string, number>();
  for (const t of templates) {
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const orderIndex = new Map<string, number>();
  tagOrder.forEach((t, i) => orderIndex.set(t, i));
  const all = [...counts.entries()];
  all.sort((a, b) => {
    const ai = orderIndex.get(a[0]);
    const bi = orderIndex.get(b[0]);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  return all;
}
