import { describe, expect, it } from "vitest";

import { parseRequestLine } from "./protocol.js";

describe("parseRequestLine", () => {
  it("accepts a valid sidecar request", () => {
    const parsed = parseRequestLine(JSON.stringify({ id: "r1", op: "ping" }));

    expect(parsed).toEqual({
      ok: true,
      request: { id: "r1", op: "ping" },
    });
  });

  it("returns a structured parse error for malformed JSON", () => {
    const parsed = parseRequestLine("{");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.id).toBe("?");
      expect(parsed.response.ok).toBe(false);
      expect(parsed.response.error).toContain("parse error");
    }
  });

  it("returns the caller id when op is missing", () => {
    const parsed = parseRequestLine(JSON.stringify({ id: "r2" }));

    expect(parsed).toEqual({
      ok: false,
      response: { id: "r2", ok: false, error: "request op must be a non-empty string" },
    });
  });

  it("rejects missing or empty ids before dispatch", () => {
    expect(parseRequestLine(JSON.stringify({ op: "ping" }))).toEqual({
      ok: false,
      response: { id: "?", ok: false, error: "request id must be a non-empty string" },
    });
    expect(parseRequestLine(JSON.stringify({ id: "", op: "ping" }))).toEqual({
      ok: false,
      response: { id: "", ok: false, error: "request id must be a non-empty string" },
    });
  });
});
