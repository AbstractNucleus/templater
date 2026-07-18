import { describe, expect, it } from "vitest";
import { formatAccelerator, keyLabel, splitAccelerator } from "./hotkeyLabels";

describe("hotkeyLabels", () => {
  it("maps codes and key prefixes", () => {
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("KeyP")).toBe("P");
    expect(keyLabel("Digit1")).toBe("1");
    expect(keyLabel("Ctrl")).toBe("Ctrl");
  });

  it("formats and splits accelerators", () => {
    expect(splitAccelerator("Ctrl+Shift+KeyP")).toEqual(["Ctrl", "Shift", "KeyP"]);
    expect(formatAccelerator("Ctrl+Shift+KeyP")).toBe("Ctrl+Shift+P");
  });
});
