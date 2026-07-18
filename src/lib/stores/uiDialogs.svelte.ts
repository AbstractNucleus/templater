import type { Template } from "$lib/types";
import { openDataDir } from "$lib/api/windows";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";
import { appErrors } from "$lib/stores/appErrors.svelte";

export type DialogMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/** Modal / confirm UI + context-menu orchestration. Keyboard shortcuts ask
 *  `blocksShortcuts` once instead of probing each flag. */
class UiDialogs {
  settingsOpen = $state(false);
  cheatSheetOpen = $state(false);
  bulkDeleteConfirmOpen = $state(false);
  bulkTagPromptOpen = $state(false);
  bulkRemoveTagPromptOpen = $state(false);
  /** Shared single-template delete confirm (toolbar + context menu). */
  deleteConfirmTarget = $state<Template | null>(null);
  contextMenu = $state<{ x: number; y: number; items: DialogMenuItem[] } | null>(null);
  bulkTagDraft = $state("");

  /** Confirm/settings/bulk prompts that own Escape/Enter themselves. */
  get blocksShortcuts(): boolean {
    return (
      this.deleteConfirmTarget !== null ||
      this.settingsOpen ||
      this.bulkDeleteConfirmOpen ||
      this.bulkTagPromptOpen ||
      this.bulkRemoveTagPromptOpen
    );
  }

  requestDelete(template: Template): void {
    this.deleteConfirmTarget = template;
  }

  openContextForTemplate(id: string, x: number, y: number): void {
    const tpl = templatesStore.templates.find((t) => t.id === id);
    if (!tpl) return;

    const bulk = selectionStore.bulkSelectedIds;
    const isEditorMode = templatesStore.isEditorMode;
    if (bulk.size > 1 && bulk.has(id)) {
      const count = bulk.size;
      const items: DialogMenuItem[] = [];
      if (isEditorMode) {
        items.push({
          label: `Add tag to ${count}…`,
          onClick: () => this.openBulkTagPrompt(),
        });
        items.push({
          label: `Remove tag from ${count}…`,
          onClick: () => this.openBulkRemoveTagPrompt(),
        });
      }
      items.push({ label: `Export ${count}…`, onClick: () => void templatesStore.bulkExport(bulk) });
      if (isEditorMode) {
        items.push({
          label: `Delete ${count}`,
          danger: true,
          onClick: () => (this.bulkDeleteConfirmOpen = true),
        });
      }
      this.contextMenu = { x, y, items };
      return;
    }

    const items: DialogMenuItem[] = [];
    if (isEditorMode) {
      items.push({
        label: tpl.pinned ? "Unpin" : "Pin",
        onClick: () => void templatesStore.togglePin(id),
      });
      items.push({
        label: "Duplicate",
        onClick: () => void templatesStore.duplicateId(id),
      });
    }
    items.push({ label: "Export…", onClick: () => void templatesStore.exportSingleTemplate(id) });
    if (isEditorMode) {
      items.push({
        label: "Delete",
        danger: true,
        onClick: () => this.requestDelete(tpl),
      });
    }
    this.contextMenu = { x, y, items };
  }

  openContextForEmpty(x: number, y: number): void {
    this.contextMenu = {
      x,
      y,
      items: [
        {
          label: "Open data folder",
          onClick: () => {
            openDataDir().catch((e) => appErrors.setAction(`open folder failed: ${e}`));
          },
        },
      ],
    };
  }

  openBulkTagPrompt(): void {
    this.bulkTagDraft = "";
    this.bulkTagPromptOpen = true;
  }

  openBulkRemoveTagPrompt(): void {
    this.bulkTagDraft = "";
    this.bulkRemoveTagPromptOpen = true;
  }

  closeBulkTagPrompt(): void {
    this.bulkTagPromptOpen = false;
    this.bulkTagDraft = "";
  }

  closeBulkRemoveTagPrompt(): void {
    this.bulkRemoveTagPromptOpen = false;
    this.bulkTagDraft = "";
  }

  closeContextMenu(): void {
    this.contextMenu = null;
  }

  async confirmBulkDelete(): Promise<void> {
    const ids = new Set(selectionStore.bulkSelectedIds);
    this.bulkDeleteConfirmOpen = false;
    await templatesStore.deleteIds(ids);
  }

  async confirmBulkTag(): Promise<void> {
    const tag = this.bulkTagDraft.trim();
    if (tag.length === 0) return;
    this.bulkTagPromptOpen = false;
    this.bulkTagDraft = "";
    await templatesStore.bulkAddTag(selectionStore.bulkSelectedIds, tag);
  }

  async confirmBulkRemoveTag(): Promise<void> {
    const tag = this.bulkTagDraft.trim();
    if (tag.length === 0) return;
    this.bulkRemoveTagPromptOpen = false;
    this.bulkTagDraft = "";
    await templatesStore.bulkRemoveTag(selectionStore.bulkSelectedIds, tag);
  }

  async confirmDelete(): Promise<void> {
    if (!this.deleteConfirmTarget) return;
    const id = this.deleteConfirmTarget.id;
    this.deleteConfirmTarget = null;
    await templatesStore.deleteIds([id]);
  }
}

export const uiDialogs = new UiDialogs();
