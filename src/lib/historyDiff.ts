import type { Template, TemplateVersion } from "$lib/types";

export type HistoryDiff = { field: string; before: string; after: string };

function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(", ") : "(none)";
}

/** Diff a prior history snapshot against the current template. */
export function historyDiff(current: Template, prior: TemplateVersion): HistoryDiff[] {
  const changes: HistoryDiff[] = [];
  if (prior.tags.join("\0") !== current.tags.join("\0")) {
    changes.push({
      field: "Tags",
      before: formatTags(prior.tags),
      after: formatTags(current.tags),
    });
  }
  if (prior.opening !== current.opening) {
    changes.push({
      field: "Opening",
      before: prior.opening || "(empty)",
      after: current.opening || "(empty)",
    });
  }
  if (prior.body !== current.body) {
    changes.push({
      field: "Body",
      before: prior.body || "(empty)",
      after: current.body || "(empty)",
    });
  }
  return changes;
}
