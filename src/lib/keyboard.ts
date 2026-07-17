/** Dependencies the global keydown handler closes over. Reads are getters so
 *  the handler always sees live values; writes/actions are callbacks. The
 *  factory exists purely to lift this ~140-line handler out of `+page.svelte`
 *  without changing any branch behaviour. */
export interface GlobalKeydownDeps {
  // Confirm/prompt dialogs own Escape/Enter themselves; these just let the
  // handler bail so other shortcuts don't run underneath an open dialog.
  isContextDeleteOpen: () => boolean;
  isSettingsOpen: () => boolean;
  isBulkDeleteConfirmOpen: () => boolean;
  isBulkTagPromptOpen: () => boolean;
  isBulkRemoveTagPromptOpen: () => boolean;
  // Cheat sheet: read state to toggle, and to suppress shortcuts while open.
  isCheatSheetOpen: () => boolean;
  setCheatSheetOpen: (v: boolean) => void;
  // Zoom: current effective zoom (already defaulted), the setter, and the step.
  getZoom: () => number;
  setZoom: (next: number) => void;
  zoomStep: number;
  // Search box element + query.
  getSearchInput: () => HTMLInputElement | undefined;
  getSearchQuery: () => string;
  clearSearch: () => void;
  // Mode flags.
  isEditing: () => boolean;
  isEditorMode: () => boolean;
  // Focus probe + selection/clipboard/undo actions.
  isInputFocused: () => boolean;
  moveSelection: (delta: number) => void;
  copySelected: () => void;
  performUndo: () => void;
  // Minimal-mode pop-out toggle.
  isMinimal: () => boolean;
  isPreviewOpen: () => boolean;
  togglePreview: () => void;
  /** Persisted in-app accelerator for the pop-out toggle (e.g. "Space",
   *  "Ctrl+Space"). DOM KeyboardEvent.code parts joined by +. Bare keys are
   *  allowed — the pop-out only matters when Templater has focus. */
  previewHotkey: () => string;
  // Translator pop-out toggle.
  isTranslatorOpen: () => boolean;
  toggleTranslator: () => void;
}

/** True if a KeyboardEvent matches an accelerator string of the form
 *  "[Mod+...+]Code" (e.g. "Space", "Ctrl+Space", "Shift+KeyP"). Mirrors the
 *  format the SettingsModal capture handler writes into settings. Bare keys
 *  (no modifiers) are allowed — used for the in-app pop-out binding. */
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

/** Builds the `svelte:window` keydown handler. The body is a verbatim lift of
 *  the original inline handler — only free-variable access was replaced with
 *  `deps`; every early-return order and branch condition is preserved. */
export function createGlobalKeydownHandler(
  deps: GlobalKeydownDeps,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    // Confirm/prompt dialogs (context-delete + the three bulk modals) own
    // Escape/Enter via ConfirmDialog's own backdrop listener. Returning here
    // just suppresses the rest of the global handler (e.g. arrow keys moving
    // selection underneath an open dialog).
    if (deps.isContextDeleteOpen()) return;
    if (deps.isSettingsOpen()) return;
    if (deps.isBulkDeleteConfirmOpen()) return;
    if (deps.isBulkTagPromptOpen()) return;
    if (deps.isBulkRemoveTagPromptOpen()) return;
    // ? toggles the cheat sheet — runs before the cheatSheetOpen guard so the
    // same key both opens AND closes. Skip when typing in an input so Shift+/
    // still types literally.
    if (e.key === "?" && !deps.isInputFocused()) {
      e.preventDefault();
      deps.setCheatSheetOpen(!deps.isCheatSheetOpen());
      return;
    }
    if (deps.isCheatSheetOpen()) {
      // CheatSheet.svelte has its own window listener for Escape — just
      // suppress global shortcuts so e.g. arrow keys don't move selection.
      return;
    }
    const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (ctrlOnly && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      deps.setZoom(deps.getZoom() + deps.zoomStep);
      return;
    }
    if (ctrlOnly && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      deps.setZoom(deps.getZoom() - deps.zoomStep);
      return;
    }
    if (ctrlOnly && e.key === "0") {
      e.preventDefault();
      deps.setZoom(1);
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      deps.clearSearch();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f") {
      // Suppress the webview's default Find dialog — the search input IS our find.
      e.preventDefault();
      const searchInput = deps.getSearchInput();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
    // Ctrl+Shift+P: toggle the preview pop-out (only meaningful in minimal mode).
    if (
      e.ctrlKey &&
      e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "p" &&
      deps.isMinimal()
    ) {
      e.preventDefault();
      deps.togglePreview();
      return;
    }
    // Configurable in-app shortcut: toggle the preview pop-out in minimal
    // mode. Default "Space". Bare key mirrors the "?" cheat-sheet shortcut —
    // gated on no input being focused so typing in search/tag fields doesn't
    // trigger it.
    if (
      deps.isMinimal() &&
      !deps.isInputFocused() &&
      document.activeElement !== deps.getSearchInput() &&
      matchesAccelerator(e, deps.previewHotkey())
    ) {
      e.preventDefault();
      deps.togglePreview();
      return;
    }
    // Ctrl+Shift+T: toggle the translator pop-out (always available).
    if (
      e.ctrlKey &&
      e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key.toLowerCase() === "t"
    ) {
      e.preventDefault();
      deps.toggleTranslator();
      return;
    }
    // Esc in the search box clears it — matches the Gmail/Slack convention.
    // Scoped to the search input so Esc in other fields keeps native behaviour.
    if (e.key === "Escape" && document.activeElement === deps.getSearchInput() && deps.getSearchQuery().length > 0) {
      e.preventDefault();
      deps.clearSearch();
      return;
    }

    if (deps.isEditing()) return;
    const inSearch = document.activeElement === deps.getSearchInput();
    if (!inSearch && deps.isInputFocused()) return;

    // Ctrl/Cmd+Z: undo the last template-list mutation. Native text undo wins
    // inside inputs — including the search box, which we let through the
    // isInputFocused guard above. Disabled in User mode where mutations can't
    // happen anyway.
    if (ctrlOnly && !e.shiftKey && e.key.toLowerCase() === "z" && deps.isEditorMode() && !inSearch) {
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
    // Excludes a focused button — that case already gets a native Enter→click,
    // so firing copySelected() too would double-trigger.
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