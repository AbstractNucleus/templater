import { describe, expect, it } from "vitest";
import { filterByTags } from "./browse";
import type { Template } from "./types";
import {
  orderedTagCounts,
  sidebarTagCounts,
  templateHasTag,
  UNTAGGED_ID,
} from "./tags";

function tpl(partial: Partial<Template> & { id: string; tags: string[] }): Template {
  return {
    name: partial.id,
    opening: "",
    body: "",
    pinned: false,
    folder: null,
    created_at: "",
    updated_at: "",
    last_used_at: null,
    copy_count: 0,
    history: [],
    ...partial,
  };
}

describe("sidebarTagCounts", () => {
  it("prepends Untagged when some templates have no tags", () => {
    const templates = [
      tpl({ id: "a", tags: [] }),
      tpl({ id: "b", tags: ["email"] }),
      tpl({ id: "c", tags: [] }),
    ];
    expect(sidebarTagCounts(templates, [])).toEqual([
      [UNTAGGED_ID, 2],
      ["email", 1],
    ]);
  });

  it("omits Untagged when every template has tags", () => {
    const templates = [tpl({ id: "a", tags: ["x"] })];
    expect(sidebarTagCounts(templates, [])).toEqual([["x", 1]]);
  });

  it("leaves Settings counts without the virtual row", () => {
    const templates = [tpl({ id: "a", tags: [] }), tpl({ id: "b", tags: ["x"] })];
    expect(orderedTagCounts(templates, [])).toEqual([["x", 1]]);
  });
});

describe("templateHasTag / filterByTags with Untagged", () => {
  const templates = [
    tpl({ id: "bare", tags: [] }),
    tpl({ id: "mail", tags: ["email"] }),
    tpl({ id: "both", tags: ["email", "work"] }),
  ];

  it("matches empty-tag templates only", () => {
    expect(templateHasTag(templates[0], UNTAGGED_ID)).toBe(true);
    expect(templateHasTag(templates[1], UNTAGGED_ID)).toBe(false);
  });

  it("selects Untagged alone", () => {
    const ids = filterByTags(templates, new Set([UNTAGGED_ID]), new Set(), "and").map(
      (t) => t.id,
    );
    expect(ids).toEqual(["bare"]);
  });

  it("excludes Untagged", () => {
    const ids = filterByTags(templates, new Set(), new Set([UNTAGGED_ID]), "and").map(
      (t) => t.id,
    );
    expect(ids).toEqual(["mail", "both"]);
  });

  it("OR with a real tag unions results", () => {
    const ids = filterByTags(
      templates,
      new Set([UNTAGGED_ID, "email"]),
      new Set(),
      "or",
    ).map((t) => t.id);
    expect(ids).toEqual(["bare", "mail", "both"]);
  });

  it("AND with a real tag yields empty", () => {
    const ids = filterByTags(
      templates,
      new Set([UNTAGGED_ID, "email"]),
      new Set(),
      "and",
    ).map((t) => t.id);
    expect(ids).toEqual([]);
  });
});
