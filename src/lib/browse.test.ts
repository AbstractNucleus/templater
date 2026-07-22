import { describe, expect, it } from "vitest";
import {
  buildBrowseListModel,
  buildTemplateList,
  canReorder,
  filterByTags,
  groupPinnedHits,
  sortTemplates,
} from "./browse";
import type { SearchHit } from "./search";
import type { Template } from "./types";

function mk(partial: Partial<Template> & { id: string; name: string }): Template {
  return {
    tags: [],
    opening: "",
    body: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    pinned: false,
    last_used_at: null,
    copy_count: 0,
    folder: null,
    history: [],
    ...partial,
  };
}

function hit(t: Template, score = 0): SearchHit {
  return {
    template: t,
    score,
    matchedWords: 0,
    nameHits: [],
    tagHits: [],
    bodyHit: null,
  };
}

describe("sortTemplates", () => {
  it("puts pinned first in manual mode while preserving relative order", () => {
    const a = mk({ id: "a", name: "A" });
    const b = mk({ id: "b", name: "B", pinned: true });
    const c = mk({ id: "c", name: "C" });
    expect(sortTemplates([a, b, c], "manual").map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts non-pinned by last_used_at desc for recent", () => {
    const older = mk({ id: "old", name: "Old", last_used_at: "2026-01-01T00:00:00Z" });
    const newer = mk({ id: "new", name: "New", last_used_at: "2026-06-01T00:00:00Z" });
    const never = mk({ id: "never", name: "Never" });
    expect(sortTemplates([older, never, newer], "recent").map((t) => t.id)).toEqual([
      "new",
      "old",
      "never",
    ]);
  });

  it("sorts non-pinned by copy_count desc for most_used", () => {
    const low = mk({ id: "low", name: "Low", copy_count: 1 });
    const high = mk({ id: "high", name: "High", copy_count: 9 });
    expect(sortTemplates([low, high], "most_used").map((t) => t.id)).toEqual(["high", "low"]);
  });

  it("puts never-used templates first for never_used", () => {
    const used = mk({
      id: "used",
      name: "Used",
      copy_count: 2,
      last_used_at: "2026-01-01T00:00:00Z",
    });
    const never = mk({ id: "never", name: "Never" });
    // copy_count===0 alone counts as never_used (ignore stale last_used_at).
    const staleStamp = mk({
      id: "stale",
      name: "Stale",
      copy_count: 0,
      last_used_at: "2026-01-01T00:00:00Z",
    });
    const pinnedUsed = mk({
      id: "pin",
      name: "Pin",
      pinned: true,
      copy_count: 1,
      last_used_at: "2026-01-01T00:00:00Z",
    });
    expect(
      sortTemplates([used, never, staleStamp, pinnedUsed], "never_used").map((t) => t.id),
    ).toEqual(["pin", "never", "stale", "used"]);
  });
});

describe("filterByTags", () => {
  const a = mk({ id: "a", name: "A", tags: ["x", "y"] });
  const b = mk({ id: "b", name: "B", tags: ["y"] });
  const c = mk({ id: "c", name: "C", tags: ["z"] });
  const all = [a, b, c];

  it("returns input when no filters", () => {
    expect(filterByTags(all, new Set(), new Set(), "and")).toBe(all);
  });

  it("requires all selected tags in and mode", () => {
    expect(
      filterByTags(all, new Set(["x", "y"]), new Set(), "and").map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("requires any selected tag in or mode", () => {
    expect(
      filterByTags(all, new Set(["x", "z"]), new Set(), "or").map((t) => t.id),
    ).toEqual(["a", "c"]);
  });

  it("excludes templates with excluded tags", () => {
    expect(
      filterByTags(all, new Set(), new Set(["y"]), "and").map((t) => t.id),
    ).toEqual(["c"]);
  });

  it("applies exclude before include", () => {
    expect(
      filterByTags(all, new Set(["y"]), new Set(["x"]), "or").map((t) => t.id),
    ).toEqual(["b"]);
  });
});

describe("groupPinnedHits", () => {
  it("moves pinned hits first while preserving within-tier order", () => {
    const a = hit(mk({ id: "a", name: "A" }), 30);
    const b = hit(mk({ id: "b", name: "B", pinned: true }), 10);
    const c = hit(mk({ id: "c", name: "C" }), 20);
    const d = hit(mk({ id: "d", name: "D", pinned: true }), 5);
    expect(groupPinnedHits([a, b, c, d]).map((h) => h.template.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });
});

describe("buildTemplateList", () => {
  it("browse path sorts and skips search scoring", () => {
    const pinned = mk({ id: "p", name: "Pinned", pinned: true });
    const newer = mk({ id: "n", name: "Newer", last_used_at: "2026-02-01T00:00:00Z" });
    const older = mk({ id: "o", name: "Older", last_used_at: "2026-01-01T00:00:00Z" });
    const hits = buildTemplateList({
      templates: [older, newer, pinned],
      sortMode: "recent",
      selectedTagIds: new Set(),
      excludedTagIds: new Set(),
      combinator: "and",
      query: "",
    });
    expect(hits.map((h) => h.template.id)).toEqual(["p", "n", "o"]);
    expect(hits.every((h) => h.score === 0)).toBe(true);
  });

  it("search path ranks without browse sort and pin-groups", () => {
    const weakPinned = mk({ id: "wp", name: "zzz", body: "needle here", pinned: true });
    const strong = mk({ id: "s", name: "needle", body: "" });
    const hits = buildTemplateList({
      templates: [weakPinned, strong],
      sortMode: "manual",
      selectedTagIds: new Set(),
      excludedTagIds: new Set(),
      combinator: "and",
      query: "needle",
    });
    expect(hits.map((h) => h.template.id)).toEqual(["wp", "s"]);
    expect(hits[1].score).toBeGreaterThan(0);
  });

  it("applies tag filter before browse or search", () => {
    const keep = mk({ id: "k", name: "Keep", tags: ["x"] });
    const drop = mk({ id: "d", name: "Drop", tags: ["y"] });
    const hits = buildTemplateList({
      templates: [keep, drop],
      sortMode: "manual",
      selectedTagIds: new Set(["x"]),
      excludedTagIds: new Set(),
      combinator: "and",
      query: "",
    });
    expect(hits.map((h) => h.template.id)).toEqual(["k"]);
  });
});

describe("buildBrowseListModel", () => {
  const base = {
    sortMode: "manual" as const,
    selectedTagIds: new Set<string>(),
    excludedTagIds: new Set<string>(),
    combinator: "and" as const,
    query: "",
    collapsedFolders: new Set<string>(),
  };

  it("uses flat hit order when there are no folders", () => {
    const model = buildBrowseListModel({
      ...base,
      templates: [mk({ id: "a", name: "A" }), mk({ id: "b", name: "B" })],
    });
    expect(model.groups).toBeNull();
    expect(model.visibleIds).toEqual(["a", "b"]);
  });

  it("flattens folder groups for visibleIds (not raw hit order)", () => {
    const model = buildBrowseListModel({
      ...base,
      templates: [
        mk({ id: "a", name: "A", folder: "F1" }),
        mk({ id: "b", name: "B", folder: null }),
        mk({ id: "c", name: "C", folder: "F1" }),
      ],
    });
    expect(model.groups?.map((g) => g.folder)).toEqual(["F1", null]);
    // Render order groups F1 then Ungrouped: a, c, b — not a, b, c.
    expect(model.visibleIds).toEqual(["a", "c", "b"]);
  });

  it("omits collapsed folders from visibleIds", () => {
    const model = buildBrowseListModel({
      ...base,
      collapsedFolders: new Set(["F1"]),
      templates: [
        mk({ id: "a", name: "A", folder: "F1" }),
        mk({ id: "b", name: "B", folder: null }),
      ],
    });
    expect(model.visibleIds).toEqual(["b"]);
  });
});

describe("canReorder", () => {
  const base = {
    isEditorMode: true,
    searchQuery: "",
    selectedTagIds: new Set<string>(),
    excludedTagIds: new Set<string>(),
    sortMode: "manual" as const,
  };

  it("is true only in editor + empty search + no tag filters + manual sort", () => {
    expect(canReorder(base)).toBe(true);
  });

  it("is false when any invariant breaks", () => {
    expect(canReorder({ ...base, isEditorMode: false })).toBe(false);
    expect(canReorder({ ...base, searchQuery: "x" })).toBe(false);
    expect(canReorder({ ...base, selectedTagIds: new Set(["t"]) })).toBe(false);
    expect(canReorder({ ...base, excludedTagIds: new Set(["t"]) })).toBe(false);
    expect(canReorder({ ...base, sortMode: "recent" })).toBe(false);
  });
});
