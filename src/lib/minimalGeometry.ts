/** Mutable state for minimal-mode width shrink/restore across `$effect` ticks. */
export type MinimalGeometryState = {
  prevMinimal: boolean | undefined;
  preMinimalWidth: number | null;
  /** Bumped on each toggle so stale async resizes are ignored. */
  generation: number;
};

/** Narrow window surface so the geometry logic stays testable without Tauri. */
export type MinimalWindowAdapter = {
  outerSize: () => Promise<{ width: number; height: number }>;
  scaleFactor: () => Promise<number>;
  setSize: (width: number, height: number) => Promise<void>;
};

export function createMinimalGeometryState(): MinimalGeometryState {
  return { prevMinimal: undefined, preMinimalWidth: null, generation: 0 };
}

/**
 * Shrink the main window to Tags + Templates when minimal mode engages, and
 * restore the prior width when it disengages. First call only primes
 * `prevMinimal` (no resize on mount). Best-effort — errors are swallowed.
 * Rapid toggles: only the latest generation's async work applies size changes.
 */
export function applyMinimalGeometry(
  state: MinimalGeometryState,
  isMinimal: boolean,
  tagsWidth: number,
  templatesWidth: number,
  win: MinimalWindowAdapter = defaultTauriWindow(),
): void {
  if (state.prevMinimal === undefined) {
    state.prevMinimal = isMinimal;
    return;
  }
  if (isMinimal === state.prevMinimal) return;
  state.prevMinimal = isMinimal;
  const generation = ++state.generation;
  void (async () => {
    try {
      if (isMinimal) {
        const size = await win.outerSize();
        if (generation !== state.generation) return;
        const factor = await win.scaleFactor().catch(() => 1);
        if (generation !== state.generation) return;
        const logicalW = size.width / factor;
        // Account for the OS frame's vertical chrome; only width matters.
        const minimalW = tagsWidth + templatesWidth + 6 /* col-resize */ + 2 /* frame borders */;
        // Only stash if the window is actually wider than the minimal target —
        // otherwise restoring later would grow a window the user already had narrow.
        if (logicalW > minimalW + 8) {
          state.preMinimalWidth = logicalW;
        }
        await win.setSize(minimalW, size.height / factor);
      } else if (state.preMinimalWidth !== null) {
        const restoreW = state.preMinimalWidth;
        const size = await win.outerSize();
        if (generation !== state.generation) return;
        const factor = await win.scaleFactor().catch(() => 1);
        if (generation !== state.generation) return;
        await win.setSize(restoreW, size.height / factor);
        if (generation === state.generation) {
          state.preMinimalWidth = null;
        }
      }
    } catch {
      /* best-effort */
    }
  })();
}

function defaultTauriWindow(): MinimalWindowAdapter {
  return {
    async outerSize() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().outerSize();
    },
    async scaleFactor() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow().scaleFactor();
    },
    async setSize(width, height) {
      const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setSize(new LogicalSize(width, height));
    },
  };
}
