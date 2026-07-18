import type { Template } from "$lib/types";
import { openDataDir } from "$lib/api";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";

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
  contextDeleteTarget = $state<Template | null>(null);
  contextMenu = $state<{ x: number; y: number; items: DialogMenuItem[] } | null>(null);
  bulkTagDraft = $state("");

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
          onClick: () => (this.bulkTagPromptOpen = true),
        });
        items.push({
          label: `Remove tag from ${count}…`,
          onClick: () => (this.bulkRemoveTagPromptOpen = true),
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
        onClick: async () => {
          const copyId = await templatesStore.duplicateTemplateById(id);
          if (copyId) selectionStore.selectedTemplateId = copyId;
        },
      });
    }
    items.push({ label: "Export…", onClick: () => void templatesStore.exportSingleTemplate(id) });
    if (isEditorMode) {
      items.push({
        label: "Delete",
        danger: true,
        onClick: () => (this.contextDeleteTarget = tpl),
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
            openDataDir().catch((e) => (templatesStore.loadError = `open folder failed: ${e}`));
          },
        },
      ],
    };
  }

  closeContextMenu(): void {
    this.contextMenu = null;
  }

  async confirmBulkDelete(): Promise<void> {
    const ids = new Set(selectionStore.bulkSelectedIds);
    this.bulkDeleteConfirmOpen = false;
    await templatesStore.bulkDelete(ids);
    selectionStore.bulkSelectedIds = new Set();
    if (selectionStore.selectedTemplateId !== null && ids.has(selectionStore.selectedTemplateId)) {
      selectionStore.selectedTemplateId = templatesStore.templates[0]?.id ?? null;
    }
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

  async confirmContextDelete(): Promise<void> {
    if (!this.contextDeleteTarget) return;
    const id = this.contextDeleteTarget.id;
    this.contextDeleteTarget = null;
    await templatesStore.deleteTemplateById(id);
    selectionStore.pruneBulkSelection(new Set([id]));
    if (selectionStore.selectedTemplateId === id) {
      selectionStore.selectedTemplateId = templatesStore.templates[0]?.id ?? null;
    }
  }
}

export const uiDialogs = new UiDialogs();
