import { describe, expect, it } from "vitest";
import { applyValues, composeText, extractVariables, splitPlaceholders } from "./compose";
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
};

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
    expect(splitPlaceholders("Hi {{name}}!", { name: "Sarah" })).toEqual([
      { text: "Hi ", placeholder: false },
      { text: "Sarah", placeholder: true },
      { text: "!", placeholder: false },
    ]);
  });

  it("leaves raw {{var}} when value is empty string", () => {
    const segs = splitPlaceholders("Hi {{name}}!", { name: "" });
    expect(segs[1]).toEqual({ text: "{{name}}", placeholder: true });
  });

  it("trims placeholder name when matching", () => {
    expect(splitPlaceholders("Hi {{ name }}!", { name: "Sarah" })[1]).toEqual({
      text: "Sarah",
      placeholder: true,
    });
  });
});

describe("applyValues", () => {
  it("substitutes a value", () => {
    expect(applyValues("Hi {{name}}!", { name: "Sarah" })).toBe("Hi Sarah!");
  });

  it("leaves raw {{var}} when missing", () => {
    expect(applyValues("Hi {{name}}!", {})).toBe("Hi {{name}}!");
  });

  it("leaves raw {{var}} when value is empty", () => {
    expect(applyValues("Hi {{name}}!", { name: "" })).toBe("Hi {{name}}!");
  });

  it("replaces every occurrence", () => {
    expect(applyValues("{{x}} and {{x}}", { x: "y" })).toBe("y and y");
  });
});

describe("extractVariables", () => {
  it("returns unique trimmed names in first-seen order", () => {
    expect(extractVariables("{{a}} {{ b }} {{a}} {{c}}")).toEqual(["a", "b", "c"]);
  });

  it("returns empty for no placeholders", () => {
    expect(extractVariables("plain")).toEqual([]);
  });

  it("skips empty placeholder names", () => {
    expect(extractVariables("{{ }} {{x}}")).toEqual(["x"]);
  });
});
