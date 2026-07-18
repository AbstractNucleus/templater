import { describe, expect, it, vi } from "vitest";
import {
  applyMinimalGeometry,
  createMinimalGeometryState,
  type MinimalWindowAdapter,
} from "./minimalGeometry";
import { buildContextMenu } from "./contextMenu";
import { isEditableTarget } from "./domFocus";
import { matchesAccelerator } from "./keyboard";

describe("isEditableTarget", () => {
  it("detects input, textarea, and contenteditable", () => {
    expect(isEditableTarget({ tagName: "INPUT", isContentEditable: false } as HTMLElement)).toBe(
      true,
    );
    expect(isEditableTarget({ tagName: "TEXTAREA", isContentEditable: false } as HTMLElement)).toBe(
      true,
    );
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true } as HTMLElement)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: false } as HTMLElement)).toBe(
      false,
    );
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("matchesAccelerator", () => {
  it("matches bare and modified codes", () => {
    const space = {
      code: "Space",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent;
    expect(matchesAccelerator(space, "Space")).toBe(true);
    expect(
      matchesAccelerator(
        { ...space, ctrlKey: true, code: "KeyP" } as KeyboardEvent,
        "Ctrl+KeyP",
      ),
    ).toBe(true);
    expect(matchesAccelerator(space, "Ctrl+Space")).toBe(false);
  });
});

describe("buildContextMenu", () => {
  it("returns paste/copy/select-all descriptors for inputs", () => {
    const input = {
      tagName: "INPUT",
      value: "hello",
      selectionStart: 0,
      selectionEnd: 2,
      isContentEditable: false,
    } as unknown as HTMLInputElement;
    const result = buildContextMenu({ target: input } as unknown as MouseEvent);
    expect(result.action).toBe("menu");
    if (result.action !== "menu") return;
    expect(result.items.map((i) => i.kind)).toEqual(["paste", "copy-text", "select-all"]);
  });

  it("suppresses empty non-editable clicks", () => {
    const g = globalThis as { window?: { getSelection: () => { toString: () => string } } };
    const prev = g.window;
    g.window = { getSelection: () => ({ toString: () => "" }) };
    try {
      const div = { tagName: "DIV", isContentEditable: false } as HTMLElement;
      expect(buildContextMenu({ target: div } as unknown as MouseEvent).action).toBe("suppress");
    } finally {
      g.window = prev;
    }
  });
});

describe("applyMinimalGeometry", () => {
  it("ignores stale async work after a rapid toggle", async () => {
    const setSize = vi.fn(async () => {});
    let resolveOuter!: (v: { width: number; height: number }) => void;
    const outerGate = new Promise<{ width: number; height: number }>((r) => {
      resolveOuter = r;
    });
    const win: MinimalWindowAdapter = {
      outerSize: () => outerGate,
      scaleFactor: async () => 1,
      setSize,
    };
    const state = createMinimalGeometryState();
    applyMinimalGeometry(state, false, 100, 200, win); // prime
    applyMinimalGeometry(state, true, 100, 200, win); // shrink (gen 1, blocked)
    applyMinimalGeometry(state, false, 100, 200, win); // restore (gen 2)

    resolveOuter({ width: 900, height: 600 });
    await Promise.resolve();
    await Promise.resolve();
    // Generation 1's setSize must not run; gen 2 may no-op without preMinimalWidth.
    expect(setSize).not.toHaveBeenCalled();
  });
});
