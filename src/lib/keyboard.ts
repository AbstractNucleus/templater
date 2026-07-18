import { isInputFocused } from "$lib/domFocus";

/** Dependencies the global keydown handler closes over. Reads are getters so
 *  the handler always sees live values; writes/actions are callbacks. */
export interface GlobalKeydownDeps {
  getZoom: () => number;
  setZoom: (next: number) => void;
  zoomStep: number;
  getSearchInput: () => HTMLInputElement | undefined;
  getSearchQuery: () => string;
  clearSearch: () => void;
  isEditing: () => boolean;
  moveSelection: (delta: number) => void;
  copySelected: () => void;
  isMinimal: () => boolean;
  /** Dialogs / cheat sheet that own their own Escape handling. */
  blocksShortcuts: () => boolean;
  cheatSheetOpen: () => boolean;
  toggleCheatSheet: () => void;
  togglePreview: () => void;
  toggleTranslator: () => void;
  getPreviewHotkey: () => string;
  canUndo: () => boolean;
  performUndo: () => void;
}

/** True if a KeyboardEvent matches an accelerator string of the form
 *  "[Mod+...+]Code" (e.g. "Space", "Ctrl+Space", "Shift+KeyP"). Mirrors the
 *  format the SettingsModal capture handler writes into settings. Bare keys are
 *  allowed — used for the in-app pop-out binding. */
export function matchesAccelerator(e: KeyboardEvent, accelerator: string): boolean {
  const parts = accelerator.split("+").filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  const code = parts[parts.length - 1];
  const wantMods = new Set(parts.slice(0, -1));
  const hasCtrl = wantMods.has("Ctrl");
  const hasShift = wantMods.has("Shift");
  const hasAlt = wantMods.has("Alt");
  const hasCmd = wantMods.has("Cmd");
  // Exact modifier match — reject stray modifiers the user didn't ask for.
  if (
    e.ctrlKey !== hasCtrl ||
    e.shiftKey !== hasShift ||
    e.altKey !== hasAlt ||
    e.metaKey !== hasCmd
  ) {
    return false;
  }
  return e.code === code;
}

type KeyMatch = (e: KeyboardEvent, deps: GlobalKeydownDeps) => boolean;

/** Ordered keymap (after cheat-sheet gating). First match wins. */
const KEYMAP: Array<{
  match: KeyMatch;
  run: (e: KeyboardEvent, deps: GlobalKeydownDeps) => void;
}> = [
  {
    match: (e) => {
      const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
      return ctrlOnly && (e.key === "+" || e.key === "=");
    },
    run: (e, deps) => {
      e.preventDefault();
      deps.setZoom(deps.getZoom() + deps.zoomStep);
    },
  },
  {
    match: (e) => {
      const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
      return ctrlOnly && (e.key === "-" || e.key === "_");
    },
    run: (e, deps) => {
      e.preventDefault();
      deps.setZoom(deps.getZoom() - deps.zoomStep);
    },
  },
  {
    match: (e) => {
      const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
      return ctrlOnly && e.key === "0";
    },
    run: (e, deps) => {
      e.preventDefault();
      deps.setZoom(1);
    },
  },
  {
    match: (e) =>
      e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "l",
    run: (e, deps) => {
      e.preventDefault();
      deps.clearSearch();
    },
  },
  {
    match: (e) =>
      e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f",
    run: (e, deps) => {
      e.preventDefault();
      const searchInput = deps.getSearchInput();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    },
  },
  {
    match: (e, deps) =>
      e.ctrlKey &&
      e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "p" &&
      deps.isMinimal(),
    run: (e, deps) => {
      e.preventDefault();
      deps.togglePreview();
    },
  },
  {
    match: (e, deps) =>
      deps.isMinimal() &&
      !isInputFocused() &&
      document.activeElement !== deps.getSearchInput() &&
      matchesAccelerator(e, deps.getPreviewHotkey()),
    run: (e, deps) => {
      e.preventDefault();
      deps.togglePreview();
    },
  },
  {
    match: (e) =>
      e.ctrlKey &&
      e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "t",
    run: (e, deps) => {
      e.preventDefault();
      deps.toggleTranslator();
    },
  },
  {
    match: (e, deps) =>
      e.key === "Escape" &&
      document.activeElement === deps.getSearchInput() &&
      deps.getSearchQuery().length > 0,
    run: (e, deps) => {
      e.preventDefault();
      deps.clearSearch();
    },
  },
];

/** Builds the `svelte:window` keydown handler. All store / popout / dialog
 *  mutations go through `deps` — this module only matches and dispatches. */
export function createGlobalKeydownHandler(
  deps: GlobalKeydownDeps,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (deps.blocksShortcuts()) return;
    // ? toggles the cheat sheet — runs before the cheatSheetOpen guard so the
    // same key both opens AND closes. Skip when typing in an input so Shift+/
    // still types literally.
    if (e.key === "?" && !isInputFocused()) {
      e.preventDefault();
      deps.toggleCheatSheet();
      return;
    }
    if (deps.cheatSheetOpen()) {
      // CheatSheet.svelte has its own window listener for Escape — just
      // suppress global shortcuts so e.g. arrow keys don't move selection.
      return;
    }

    for (const binding of KEYMAP) {
      if (!binding.match(e, deps)) continue;
      binding.run(e, deps);
      return;
    }

    if (deps.isEditing()) return;
    const inSearch = document.activeElement === deps.getSearchInput();
    if (!inSearch && isInputFocused()) return;

    const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
    // Ctrl/Cmd+Z: undo. Native text undo wins inside inputs — including search.
    if (ctrlOnly && !e.shiftKey && e.key.toLowerCase() === "z" && deps.canUndo() && !inSearch) {
      e.preventDefault();
      deps.performUndo();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      deps.moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      deps.moveSelection(-1);
      return;
    }
    // Enter copies when search is focused OR when no element is focused (body).
    const activeIsBody = document.activeElement === document.body;
    if (
      e.key === "Enter" &&
      (inSearch || activeIsBody) &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      deps.copySelected();
    }
  };
}
