import { TEMPLATE_HISTORY_CAP, type Template, type TemplateVersion } from "$lib/types";

/** Snapshot current opening/body/tags onto the template's history ring. */
export function pushHistorySnapshot(cur: Template, savedAt: string): TemplateVersion[] {
  if (cur.opening.length === 0 && cur.body.length === 0 && cur.tags.length === 0) return cur.history;
  const snapshot = { saved_at: savedAt, opening: cur.opening, body: cur.body, tags: [...cur.tags] };
  const next = [...cur.history, snapshot];
  return next.length > TEMPLATE_HISTORY_CAP ? next.slice(-TEMPLATE_HISTORY_CAP) : next;
}
