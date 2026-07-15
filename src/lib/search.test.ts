import { describe, expect, it } from "vitest";
import { highlightName, searchTemplates } from "./search";
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

describe("searchTemplates empty query", () => {
  it("returns all templates in input order with score 0 and no highlights", () => {
    const ts = [mk({ id: "a", name: "Apple" }), mk({ id: "b", name: "Banana" })];
    const hits = searchTemplates("", ts);
    expect(hits.map((h) => h.template.id)).toEqual(["a", "b"]);
    expect(hits.every((h) => h.score === 0 && h.matchedWords === 0)).toBe(true);
    expect(hits.every((h) => h.nameHits.length === 0)).toBe(true);
  });
});

describe("searchTemplates scoring per field", () => {
  it("name match at a word boundary scores 130", () => {
    const hits = searchTemplates("hello", [mk({ id: "x", name: "hello world" })]);
    expect(hits[0].score).toBe(130);
    expect(hits[0].matchedWords).toBe(1);
  });

  it("name match mid-word scores 100 (no boundary bonus)", () => {
    const hits = searchTemplates("ello", [mk({ id: "x", name: "hello" })]);
    expect(hits[0].score).toBe(100);
  });

  it("exact tag match scores 80", () => {
    const hits = searchTemplates("decline", [mk({ id: "x", name: "z", tags: ["decline"] })]);
    expect(hits[0].score).toBe(80);
    expect(hits[0].tagHits).toEqual(["decline"]);
  });

  it("tag-contains match scores 50", () => {
    const hits = searchTemplates("dec", [mk({ id: "x", name: "z", tags: ["decline"] })]);
    expect(hits[0].score).toBe(50);
    expect(hits[0].tagHits).toEqual(["decline"]);
  });

  it("body-only match scores 20", () => {
    const hits = searchTemplates("foo", [mk({ id: "x", name: "z", body: "foo bar" })]);
    expect(hits[0].score).toBe(20);
    expect(hits[0].bodyHit).not.toBeNull();
  });

  it("takes MAX across fields per word (not sum)", () => {
    // Word matches name (130) AND body (20) → score is 130, not 150.
    const hits = searchTemplates("hello", [
      mk({ id: "x", name: "hello world", body: "say hello" }),
    ]);
    expect(hits[0].score).toBe(130);
  });

  it("drops zero-match templates", () => {
    const hits = searchTemplates("zzz", [mk({ id: "x", name: "apple" })]);
    expect(hits).toEqual([]);
  });
});

describe("searchTemplates ordering", () => {
  it("ranks full match above partial regardless of field strength", () => {
    // "alpha beta" — full match in body (40 total) vs strong name boundary
    // hit on just "alpha" (130). matchedWords (2 vs 1) wins primary sort.
    const full = mk({ id: "full", name: "z", body: "alpha beta" });
    const partial = mk({ id: "partial", name: "alpha world" });
    const hits = searchTemplates("alpha beta", [partial, full]);
    expect(hits.map((h) => h.template.id)).toEqual(["full", "partial"]);
  });

  it("breaks ties on score then name asc", () => {
    const a = mk({ id: "a", name: "banana" });
    const b = mk({ id: "b", name: "apple" });
    // Both single-word name matches at boundary (130). Name asc → apple first.
    const hits = searchTemplates("a", [a, b]);
    expect(hits.map((h) => h.template.id)).toEqual(["b", "a"]);
  });

  it("is case-insensitive", () => {
    const hits = searchTemplates("HELLO", [mk({ id: "x", name: "Hello World" })]);
    expect(hits[0].score).toBe(130);
  });
});

describe("searchTemplates name highlights", () => {
  it("merges adjacent ranges from different words", () => {
    // "a b" against "ab ba": "a" → [0,1) and [3,4); "b" → [1,2) and [4,5).
    // Adjacent ranges merge (hits[i].start <= last.end).
    const hits = searchTemplates("a b", [mk({ id: "x", name: "ab ba" })]);
    expect(hits[0].nameHits).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });

  it("merges overlapping ranges", () => {
    // "test" and "estimate" — "est" overlaps "test" at chars 1-4.
    const hits = searchTemplates("test est", [mk({ id: "x", name: "testing" })]);
    const merged = hits[0].nameHits;
    // "test" matches [0,4); "est" matches [1,4) → merged to [0,4).
    expect(merged).toEqual([{ start: 0, end: 4 }]);
  });
});

describe("highlightName", () => {
  it("returns one segment when no hits", () => {
    expect(highlightName("hello", [])).toEqual([{ text: "hello", hit: false }]);
  });

  it("interleaves hit and non-hit segments", () => {
    expect(highlightName("hello world", [{ start: 6, end: 11 }])).toEqual([
      { text: "hello ", hit: false },
      { text: "world", hit: true },
    ]);
  });
});

describe("searchTemplates body excerpt", () => {
  it("returns null when no body match", () => {
    const hits = searchTemplates("apple", [mk({ id: "x", name: "apple pie" })]);
    expect(hits[0].bodyHit).toBeNull();
  });

  it("centers excerpt on first body hit", () => {
    const long = "a".repeat(200) + " needle " + "b".repeat(200);
    const hits = searchTemplates("needle", [mk({ id: "x", name: "z", body: long })]);
    const segs = hits[0].bodyHit?.segments ?? [];
    expect(segs.some((s) => s.hit && s.text === "needle")).toBe(true);
    expect(segs[0].text).toBe("…");
    expect(segs[segs.length - 1].text).toBe("…");
  });
});
