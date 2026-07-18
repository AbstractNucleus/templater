import type { SearchHit } from "./search";
import { searchTemplates } from "./search";
import type { SortMode, Template } from "./types";

/**
 * Browse order: pinned first, then by sort mode.
 * "manual" preserves array order; "recent" by last_used_at desc;
 * "most_used" by copy_count desc; "never_used" by copy_count === 0 first.
 */
export function sortTemplates(templates: Template[], sortMode: SortMode): Template[] {
  return [...templates].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortMode === "recent") {
      const aT = a.last_used_at ?? "";
      const bT = b.last_used_at ?? "";
      if (aT !== bT) return aT > bT ? -1 : 1;
      return 0;
    }
    if (sortMode === "most_used") {
      if (a.copy_count !== b.copy_count) return b.copy_count - a.copy_count;
      return 0;
    }
    if (sortMode === "never_used") {
      const aNever = a.copy_count === 0;
      const bNever = b.copy_count === 0;
      if (aNever !== bNever) return aNever ? -1 : 1;
      return 0;
    }
    return 0;
  });
}

/** Exclude tags first, then require ALL (and) or ANY (or) of the selected tags. */
export function filterByTags(
  templates: Template[],
  selectedTagIds: ReadonlySet<string>,
  excludedTagIds: ReadonlySet<string>,
  combinator: "and" | "or",
): Template[] {
  if (selectedTagIds.size === 0 && excludedTagIds.size === 0) return templates;
  return templates.filter((t) => {
    for (const tag of excludedTagIds) {
      if (t.tags.includes(tag)) return false;
    }
    if (selectedTagIds.size === 0) return true;
    if (combinator === "or") {
      for (const tag of selectedTagIds) {
        if (t.tags.includes(tag)) return true;
      }
      return false;
    }
    for (const tag of selectedTagIds) {
      if (!t.tags.includes(tag)) return false;
    }
    return true;
  });
}

/**
 * Group pinned hits to the top regardless of search score.
 * Within each tier, input order (e.g. searchTemplates ranking) is preserved.
 */
export function groupPinnedHits(hits: SearchHit[]): SearchHit[] {
  const pinned: SearchHit[] = [];
  const others: SearchHit[] = [];
  for (const h of hits) {
    if (h.template.pinned) pinned.push(h);
    else others.push(h);
  }
  return [...pinned, ...others];
}

function asBrowseHit(template: Template): SearchHit {
  return {
    template,
    score: 0,
    matchedWords: 0,
    nameHits: [],
    tagHits: [],
    bodyHit: null,
  };
}

/**
 * Single list model for the sidebar: tag filter → either browse-sort (no
 * search wrap) or search ranking (no browse sort) with pin grouping in-pass.
 */
export function buildTemplateList(opts: {
  templates: Template[];
  sortMode: SortMode;
  selectedTagIds: ReadonlySet<string>;
  excludedTagIds: ReadonlySet<string>;
  combinator: "and" | "or";
  query: string;
}): SearchHit[] {
  const tagged = filterByTags(
    opts.templates,
    opts.selectedTagIds,
    opts.excludedTagIds,
    opts.combinator,
  );
  if (opts.query.trim().length === 0) {
    return sortTemplates(tagged, opts.sortMode).map(asBrowseHit);
  }
  return groupPinnedHits(searchTemplates(opts.query, tagged));
}

/**
 * Drag-reorder is only safe when the visible order IS the underlying array
 * order. Any filter, search, or non-manual sort breaks that invariant.
 */
export function canReorder(opts: {
  isEditorMode: boolean;
  searchQuery: string;
  selectedTagIds: ReadonlySet<string>;
  excludedTagIds: ReadonlySet<string>;
  sortMode: SortMode;
}): boolean {
  return (
    opts.isEditorMode &&
    opts.searchQuery.trim().length === 0 &&
    opts.selectedTagIds.size === 0 &&
    opts.excludedTagIds.size === 0 &&
    opts.sortMode === "manual"
  );
}
