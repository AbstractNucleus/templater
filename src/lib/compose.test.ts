import { describe, expect, it } from "vitest";
import {
  applyValues,
  composeText,
  extractPlaceholders,
  parsePlaceholder,
  splitPlaceholders,
} from "./compose";
import type { Template } from "./types";

const baseTemplate: Template = {
  id: "t1",
  name: "Test",
  tags: [],
  opening: "Hi {{name}},",
  body: "Body text with {{topic}}.",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  pinned: false,
  last_used_at: null,
  copy_count: 0,
  folder: null,
  history: [],
};

// Fixed clock for reproducible date tests (local time).
const FIXED_NOW = new Date(2026, 4, 24, 10, 0, 0); // 2026-05-24 10:00:00 local
const FIXED_NOW_WITH_SEC = new Date(2026, 4, 24, 14, 3, 7); // 2026-05-24 14:03:07 local

describe("composeText", () => {
  it("joins opening, body, signature with double newlines", () => {
    const out = composeText(baseTemplate, true, true, "— Noel");
    expect(out).toBe("Hi {{name}},\n\nBody text with {{topic}}.\n\n— Noel");
  });

  it("drops opening when flag is off", () => {
    const out = composeText(baseTemplate, false, true, "— Noel");
    expect(out).toBe("Body text with {{topic}}.\n\n— Noel");
  });

  it("drops opening when it's empty even with flag on", () => {
    const out = composeText({ ...baseTemplate, opening: "   " }, true, false, "");
    expect(out).toBe("Body text with {{topic}}.");
  });

  it("drops signature when it's empty even with flag on", () => {
    const out = composeText(baseTemplate, true, true, "   ");
    expect(out).toBe("Hi {{name}},\n\nBody text with {{topic}}.");
  });

  it("drops signature when flag is off", () => {
    const out = composeText(baseTemplate, true, false, "— Noel");
    expect(out).toBe("Hi {{name}},\n\nBody text with {{topic}}.");
  });
});

describe("splitPlaceholders", () => {
  it("returns one non-placeholder segment when no placeholders", () => {
    expect(splitPlaceholders("plain text")).toEqual([{ text: "plain text", placeholder: false }]);
  });

  it("splits around a placeholder", () => {
    expect(splitPlaceholders("Hi {{name}}!")).toEqual([
      { text: "Hi ", placeholder: false },
      { text: "{{name}}", placeholder: true },
      { text: "!", placeholder: false },
    ]);
  });

  it("substitutes when value provided", () => {
    expect(splitPlaceholders("Hi {{name}}!", { values: { name: "Sarah" } })).toEqual([
      { text: "Hi ", placeholder: false },
      { text: "Sarah", placeholder: true },
      { text: "!", placeholder: false },
    ]);
  });

  it("leaves raw {{var}} when value is empty string", () => {
    const segs = splitPlaceholders("Hi {{name}}!", { values: { name: "" } });
    expect(segs[1]).toEqual({ text: "{{name}}", placeholder: true });
  });

  it("trims placeholder name when matching", () => {
    expect(splitPlaceholders("Hi {{ name }}!", { values: { name: "Sarah" } })[1]).toEqual({
      text: "Sarah",
      placeholder: true,
    });
  });

  it("auto-fills {{date}} in ISO format", () => {
    const segs = splitPlaceholders("Today is {{date}}.", { now: FIXED_NOW });
    expect(segs[1]).toEqual({ text: "2026-05-24", placeholder: true });
  });

  it("auto-fills {{date:long}}", () => {
    const segs = splitPlaceholders("Today is {{date:long}}.", { now: FIXED_NOW });
    expect(segs[1].placeholder).toBe(true);
    expect(segs[1].text).toMatch(/2026/);
    expect(segs[1].text).toMatch(/May/);
  });

  it("auto-fills {{time}} as HH:MM", () => {
    const segs = splitPlaceholders("At {{time}}.", { now: FIXED_NOW_WITH_SEC });
    expect(segs[1]).toEqual({ text: "14:03", placeholder: true });
  });

  it("auto-fills {{time:long}} as HH:MM:SS", () => {
    const segs = splitPlaceholders("At {{time:long}}.", { now: FIXED_NOW_WITH_SEC });
    expect(segs[1]).toEqual({ text: "14:03:07", placeholder: true });
  });

  it("resolves {{choice:a|b}} by its full key", () => {
    const segs = splitPlaceholders("Pick {{choice:yes|no}}.", {
      values: { "choice:yes|no": "yes" },
    });
    expect(segs[1]).toEqual({ text: "yes", placeholder: true });
  });

  it("leaves choice raw when no selection", () => {
    const segs = splitPlaceholders("Pick {{choice:yes|no}}.");
    expect(segs[1]).toEqual({ text: "{{choice:yes|no}}", placeholder: true });
  });

  it("fills from snippets when no per-template value", () => {
    const segs = splitPlaceholders("Hi {{name}}!", { snippets: { name: "Alex" } });
    expect(segs[1]).toEqual({ text: "Alex", placeholder: true });
  });

  it("prefers values over snippets", () => {
    const segs = splitPlaceholders("Hi {{name}}!", {
      values: { name: "Sam" },
      snippets: { name: "Alex" },
    });
    expect(segs[1]).toEqual({ text: "Sam", placeholder: true });
  });
});

describe("applyValues", () => {
  it("substitutes a value", () => {
    expect(applyValues("Hi {{name}}!", { values: { name: "Sarah" } })).toBe("Hi Sarah!");
  });

  it("leaves raw {{var}} when missing", () => {
    expect(applyValues("Hi {{name}}!")).toBe("Hi {{name}}!");
  });

  it("leaves raw {{var}} when value is empty", () => {
    expect(applyValues("Hi {{name}}!", { values: { name: "" } })).toBe("Hi {{name}}!");
  });

  it("replaces every occurrence", () => {
    expect(applyValues("{{x}} and {{x}}", { values: { x: "y" } })).toBe("y and y");
  });

  it("substitutes {{date}} with today's ISO date", () => {
    expect(applyValues("on {{date}}", { now: FIXED_NOW })).toBe("on 2026-05-24");
  });

  it("substitutes {{choice:a|b}} via its full key", () => {
    expect(applyValues("Pick {{choice:yes|no}}.", { values: { "choice:yes|no": "no" } })).toBe(
      "Pick no.",
    );
  });

  it("applies snippets", () => {
    expect(applyValues("Hi {{name}}!", { snippets: { name: "Alex" } })).toBe("Hi Alex!");
  });
});

describe("parsePlaceholder", () => {
  it("classifies a bare token as text", () => {
    const p = parsePlaceholder("name");
    expect(p.kind).toEqual({ type: "text" });
    expect(p.key).toBe("name");
  });

  it("classifies date with default ISO format", () => {
    expect(parsePlaceholder("date").kind).toEqual({ type: "date", format: "iso" });
  });

  it("classifies date:long", () => {
    expect(parsePlaceholder("date:long").kind).toEqual({ type: "date", format: "long" });
  });

  it("rejects unknown date format as free text", () => {
    const p = parsePlaceholder("date:neon");
    expect(p.kind).toEqual({ type: "text" });
    expect(p.key).toBe("date:neon");
  });

  it("rejects unknown time format as free text", () => {
    expect(parsePlaceholder("time:bogus").kind).toEqual({ type: "text" });
  });

  it("parses choice options", () => {
    const p = parsePlaceholder("choice:yes|no|maybe");
    expect(p.kind).toEqual({ type: "choice", options: ["yes", "no", "maybe"] });
    expect(p.label).toBe("yes / no / maybe");
  });
});

describe("extractPlaceholders", () => {
  it("returns unique placeholders in first-seen order", () => {
    const out = extractPlaceholders("{{a}} {{ b }} {{a}} {{c}}");
    expect(out.map((p) => p.key)).toEqual(["a", "b", "c"]);
  });

  it("returns empty for no placeholders", () => {
    expect(extractPlaceholders("plain")).toEqual([]);
  });

  it("skips empty placeholder names", () => {
    expect(extractPlaceholders("{{ }} {{x}}").map((p) => p.key)).toEqual(["x"]);
  });

  it("excludes date placeholders (no UI needed)", () => {
    expect(extractPlaceholders("{{name}} on {{date}}").map((p) => p.key)).toEqual(["name"]);
  });

  it("excludes time placeholders (auto-filled, no UI needed)", () => {
    expect(extractPlaceholders("{{name}} at {{time}} on {{time:long}}").map((p) => p.key)).toEqual([
      "name",
    ]);
  });

  it("includes choice placeholders", () => {
    const out = extractPlaceholders("{{choice:yes|no}}");
    expect(out).toHaveLength(1);
    expect(out[0].kind).toEqual({ type: "choice", options: ["yes", "no"] });
  });

  it("excludes text placeholders covered by snippets", () => {
    expect(extractPlaceholders("{{name}} {{other}}", { name: "Alex" }).map((p) => p.key)).toEqual([
      "other",
    ]);
  });
});
