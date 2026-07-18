import type { Template } from "$lib/types";

/** Modal / confirm UI owned outside the template data store. Keyboard
 *  shortcuts ask `blocksShortcuts` once instead of probing each flag. */
class UiDialogs {
  settingsOpen = $state(false);
  cheatSheetOpen = $state(false);
  bulkDeleteConfirmOpen = $state(false);
  bulkTagPromptOpen = $state(false);
  bulkRemoveTagPromptOpen = $state(false);
  contextDeleteTarget = $state<Template | null>(null);

  /** Confirm/settings/bulk prompts that own Escape/Enter themselves. */
  get blocksShortcuts(): boolean {
    return (
      this.contextDeleteTarget !== null ||
      this.settingsOpen ||
      this.bulkDeleteConfirmOpen ||
      this.bulkTagPromptOpen ||
      this.bulkRemoveTagPromptOpen
    );
  }
}

export const uiDialogs = new UiDialogs();
