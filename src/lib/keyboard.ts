import { isInputFocused } from "$lib/domFocus";
import { popouts } from "$lib/stores/popouts.svelte";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { uiDialogs } from "$lib/stores/uiDialogs.svelte";

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

/** Builds the `svelte:window` keydown handler. Dialog / popout / mode flags
 *  come from stores; the page only passes search/zoom/selection actions. */
export function createGlobalKeydownHandler(
  deps: GlobalKeydownDeps,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (uiDialogs.blocksShortcuts) return;
    // ? toggles the cheat sheet — runs before the cheatSheetOpen guard so the
    // same key both opens AND closes. Skip when typing in an input so Shift+/
    // still types literally.
    if (e.key === "?" && !isInputFocused()) {
      e.preventDefault();
      uiDialogs.cheatSheetOpen = !uiDialogs.cheatSheetOpen;
      return;
    }
    if (uiDialogs.cheatSheetOpen) {
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
      void popouts.togglePreview();
      return;
    }
    // Configurable in-app shortcut: toggle the preview pop-out in minimal
    // mode. Default "Space". Bare key mirrors the "?" cheat-sheet shortcut —
    // gated on no input being focused so typing in search/tag fields doesn't
    // trigger it.
    if (
      deps.isMinimal() &&
      !isInputFocused() &&
      document.activeElement !== deps.getSearchInput() &&
      matchesAccelerator(e, templatesStore.settings.preview_hotkey)
    ) {
      e.preventDefault();
      void popouts.togglePreview();
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
      void popouts.toggleTranslator();
      return;
    }
    // Esc in the search box clears it — matches the Gmail/Slack convention.
    // Scoped to the search input so Esc in other fields keeps native behaviour.
    if (
      e.key === "Escape" &&
      document.activeElement === deps.getSearchInput() &&
      deps.getSearchQuery().length > 0
    ) {
      e.preventDefault();
      deps.clearSearch();
      return;
    }

    if (deps.isEditing()) return;
    const inSearch = document.activeElement === deps.getSearchInput();
    if (!inSearch && isInputFocused()) return;

    // Ctrl/Cmd+Z: undo the last template-list mutation. Native text undo wins
    // inside inputs — including the search box, which we let through the
    // isInputFocused guard above. Disabled in User mode where mutations can't
    // happen anyway.
    if (
      ctrlOnly &&
      !e.shiftKey &&
      e.key.toLowerCase() === "z" &&
      templatesStore.isEditorMode &&
      !inSearch
    ) {
      e.preventDefault();
      void templatesStore.performUndo();
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
