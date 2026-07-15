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