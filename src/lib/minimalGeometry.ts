import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** Mutable state for minimal-mode width shrink/restore across `$effect` ticks. */
export type MinimalGeometryState = {
  prevMinimal: boolean | undefined;
  preMinimalWidth: number | null;
};

export function createMinimalGeometryState(): MinimalGeometryState {
  return { prevMinimal: undefined, preMinimalWidth: null };
}

/**
 * Shrink the main window to Tags + Templates when minimal mode engages, and
 * restore the prior width when it disengages. First call only primes
 * `prevMinimal` (no resize on mount). Best-effort — errors are swallowed.
 */
export function applyMinimalGeometry(
  state: MinimalGeometryState,
  isMinimal: boolean,
  tagsWidth: number,
  templatesWidth: number,
): void {
  if (state.prevMinimal === undefined) {
    state.prevMinimal = isMinimal;
    return;
  }
  if (isMinimal === state.prevMinimal) return;
  state.prevMinimal = isMinimal;
  void (async () => {
    try {
      const win = getCurrentWindow();
      if (isMinimal) {
        const size = await win.outerSize();
        const factor = await win.scaleFactor().catch(() => 1);
        const logicalW = size.width / factor;
        // Account for the OS frame's vertical chrome; only width matters.
        const minimalW = tagsWidth + templatesWidth + 6 /* col-resize */ + 2 /* frame borders */;
        // Only stash if the window is actually wider than the minimal target —
        // otherwise restoring later would grow a window the user already had narrow.
        if (logicalW > minimalW + 8) {
          state.preMinimalWidth = logicalW;
        }
        await win.setSize(new LogicalSize(minimalW, size.height / factor));
      } else if (state.preMinimalWidth !== null) {
        const size = await win.outerSize();
        const factor = await win.scaleFactor().catch(() => 1);
        await win.setSize(new LogicalSize(state.preMinimalWidth, size.height / factor));
        state.preMinimalWidth = null;
      }
    } catch {
      /* best-effort */
    }
  })();
}
