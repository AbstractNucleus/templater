import { describe, expect, it } from "vitest";
import { mergeImportedTemplates } from "./mergeImportedTemplates";
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

describe("mergeImportedTemplates", () => {
  it("prepends new templates and counts additions", () => {
    const existing = [mk({ id: "a", name: "A" })];
    const incoming = [mk({ id: "b", name: "B" }), mk({ id: "c", name: "C" })];
    const result = mergeImportedTemplates(existing, incoming, false, "2026-06-01T00:00:00Z");
    expect(result.added).toBe(2);
    expect(result.overwritten).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.templates.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("skips duplicates when overwrite is false", () => {
    const existing = [mk({ id: "a", name: "Local", body: "old" })];
    const incoming = [mk({ id: "a", name: "Import", body: "new" })];
    const result = mergeImportedTemplates(existing, incoming, false);
    expect(result.skipped).toBe(1);
    expect(result.templates[0].name).toBe("Local");
    expect(result.templates[0].body).toBe("old");
  });

  it("overwrites content and pushes history when overwrite is true", () => {
    const existing = [mk({ id: "a", name: "Local", body: "old", opening: "Hi" })];
    const incoming = [mk({ id: "a", name: "Import", body: "new", tags: ["x"] })];
    const now = "2026-06-01T00:00:00Z";
    const result = mergeImportedTemplates(existing, incoming, true, now);
    expect(result.overwritten).toBe(1);
    expect(result.templates[0].name).toBe("Import");
    expect(result.templates[0].body).toBe("new");
    expect(result.templates[0].history).toEqual([
      { saved_at: now, opening: "Hi", body: "old", tags: [] },
    ]);
  });
});
