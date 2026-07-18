import { describe, expect, it } from "vitest";
import { historyDiff } from "./historyDiff";
import type { Template } from "./types";

const base: Template = {
  id: "1",
  name: "T",
  tags: ["a"],
  opening: "Hi,",
  body: "Body",
  created_at: "",
  updated_at: "",
  folder: null,
  pinned: false,
  last_used_at: null,
  copy_count: 0,
  history: [],
};

describe("historyDiff", () => {
  it("reports changed fields", () => {
    const diffs = historyDiff(base, {
      saved_at: "x",
      opening: "Hello,",
      body: "Body",
      tags: ["a", "b"],
    });
    expect(diffs.map((d) => d.field)).toEqual(["Tags", "Opening"]);
  });

  it("returns empty when identical", () => {
    expect(
      historyDiff(base, {
        saved_at: "x",
        opening: base.opening,
        body: base.body,
        tags: [...base.tags],
      }),
    ).toEqual([]);
  });
});
