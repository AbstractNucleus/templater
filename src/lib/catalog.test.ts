import { describe, expect, it } from "vitest";
import {
  formatCatalogValidationError,
  normalizeTags,
  renameTagInTemplates,
  validateCatalogIds,
  withNormalizedTags,
} from "./catalog";
import type { Template } from "./types";

function mk(partial: Partial<Template> & { id: string }): Template {
  return {
    name: "T",
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

describe("catalog codec", () => {
  it("normalizeTags trims, lowercases, and dedupes", () => {
    expect(normalizeTags([" Email ", "email", "Poker", ""])).toEqual(["email", "poker"]);
  });

  it("withNormalizedTags is a no-op when already canonical", () => {
    const t = mk({ id: "a", tags: ["email"] });
    expect(withNormalizedTags(t)).toBe(t);
  });

  it("validateCatalogIds rejects empty and duplicate ids", () => {
    expect(validateCatalogIds([mk({ id: "" })])).toEqual({ kind: "empty_id", index: 0 });
    expect(validateCatalogIds([mk({ id: "a" }), mk({ id: "a" })])).toEqual({
      kind: "duplicate_id",
      id: "a",
      index: 1,
    });
    expect(validateCatalogIds([mk({ id: "a" }), mk({ id: "b" })])).toBeNull();
  });

  it("formatCatalogValidationError is readable", () => {
    expect(formatCatalogValidationError({ kind: "empty_id", index: 2 })).toContain("index 2");
    expect(
      formatCatalogValidationError({ kind: "duplicate_id", id: "x", index: 1 }),
    ).toContain('"x"');
  });

  it("renameTagInTemplates normalizes the destination", () => {
    const next = renameTagInTemplates([mk({ id: "a", tags: ["Email"] })], "Email", " Poker ");
    expect(next[0].tags).toEqual(["poker"]);
  });
});
