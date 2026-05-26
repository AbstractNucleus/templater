import { describe, expect, it } from "vitest";

import { explainRankError } from "./api";

describe("explainRankError", () => {
  it("maps sidecar timeouts before generic network timeouts", () => {
    expect(explainRankError("sidecar request timed out after 60s")).toBe(
      "Paste-match took too long. Retry; the sidecar will keep handling other work.",
    );
  });

  it("maps sidecar pipe failures to a retryable respawn message", () => {
    expect(explainRankError("sidecar unavailable: pipe closed")).toBe(
      "Sidecar connection dropped. Retry to let the app respawn it.",
    );
    expect(explainRankError("sidecar unavailable: writer closed")).toBe(
      "Sidecar connection dropped. Retry to let the app respawn it.",
    );
  });

  it("keeps non-sidecar timeouts as network errors", () => {
    expect(explainRankError("network timeout")).toBe(
      "Network error. Check your connection and retry.",
    );
  });
});
