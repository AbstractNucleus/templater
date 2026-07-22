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

/** At most one modal owns Escape/Enter. Context menu is separate overlay state. */
export type ActiveModal =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "cheatSheet" }
  | { kind: "bulkDelete" }
  | { kind: "bulkTag" }
  | { kind: "bulkRemoveTag" }
  | { kind: "deleteConfirm"; template: Template };

/** Modal / confirm UI + context-menu orchestration. */
class UiDialogs {
  activeModal = $state<ActiveModal>({ kind: "none" });
  contextMenu = $state<{ x: number; y: number; items: DialogMenuItem[] } | null>(null);
  bulkTagDraft = $state("");

  get settingsOpen(): boolean {
    return this.activeModal.kind === "settings";
  }
  set settingsOpen(open: boolean) {
    this.activeModal = open ? { kind: "settings" } : { kind: "none" };
  }

  get cheatSheetOpen(): boolean {
    return this.activeModal.kind === "cheatSheet";
  }
  set cheatSheetOpen(open: boolean) {
    this.activeModal = open ? { kind: "cheatSheet" } : { kind: "none" };
  }

  get bulkDeleteConfirmOpen(): boolean {
    return this.activeModal.kind === "bulkDelete";
  }
  set bulkDeleteConfirmOpen(open: boolean) {
    this.activeModal = open ? { kind: "bulkDelete" } : { kind: "none" };
  }

  get bulkTagPromptOpen(): boolean {
    return this.activeModal.kind === "bulkTag";
  }

  get bulkRemoveTagPromptOpen(): boolean {
    return this.activeModal.kind === "bulkRemoveTag";
  }

  get deleteConfirmTarget(): Template | null {
    return this.activeModal.kind === "deleteConfirm" ? this.activeModal.template : null;
  }
  set deleteConfirmTarget(template: Template | null) {
    this.activeModal = template ? { kind: "deleteConfirm", template } : { kind: "none" };
  }

  /** Confirm/settings/bulk prompts that own Escape/Enter themselves. */
  get blocksShortcuts(): boolean {
    return this.activeModal.kind !== "none" && this.activeModal.kind !== "cheatSheet";
  }

  requestDelete(template: Template): void {
    this.activeModal = { kind: "deleteConfirm", template };
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
      items.push({
        label: `Export ${count}…`,
        onClick: () => void templatesStore.bulkExport(bulk).catch(() => {}),
      });
      if (isEditorMode) {
        items.push({
          label: `Delete ${count}`,
          danger: true,
          onClick: () => (this.activeModal = { kind: "bulkDelete" }),
        });
      }
      this.contextMenu = { x, y, items };
      return;
    }

    const items: DialogMenuItem[] = [];
    if (isEditorMode) {
      items.push({
        label: tpl.pinned ? "Unpin" : "Pin",
        onClick: () => void templatesStore.togglePin(id).catch(() => {}),
      });
      items.push({
        label: "Duplicate",
        onClick: () => void templatesStore.duplicateId(id).catch(() => {}),
      });
    }
    items.push({
      label: "Export…",
      onClick: () => void templatesStore.exportSingleTemplate(id).catch(() => {}),
    });
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
    this.activeModal = { kind: "bulkTag" };
  }

  openBulkRemoveTagPrompt(): void {
    this.bulkTagDraft = "";
    this.activeModal = { kind: "bulkRemoveTag" };
  }

  closeBulkTagPrompt(): void {
    this.activeModal = { kind: "none" };
    this.bulkTagDraft = "";
  }

  closeBulkRemoveTagPrompt(): void {
    this.activeModal = { kind: "none" };
    this.bulkTagDraft = "";
  }

  closeContextMenu(): void {
    this.contextMenu = null;
  }

  closeModal(): void {
    this.activeModal = { kind: "none" };
  }

  async confirmBulkDelete(): Promise<void> {
    const ids = new Set(selectionStore.bulkSelectedIds);
    this.activeModal = { kind: "none" };
    await templatesStore.deleteIds(ids);
  }

  async confirmBulkTag(): Promise<void> {
    const tag = this.bulkTagDraft.trim();
    if (tag.length === 0) return;
    this.activeModal = { kind: "none" };
    this.bulkTagDraft = "";
    await templatesStore.bulkAddTag(selectionStore.bulkSelectedIds, tag);
  }

  async confirmBulkRemoveTag(): Promise<void> {
    const tag = this.bulkTagDraft.trim();
    if (tag.length === 0) return;
    this.activeModal = { kind: "none" };
    this.bulkTagDraft = "";
    await templatesStore.bulkRemoveTag(selectionStore.bulkSelectedIds, tag);
  }

  async confirmDelete(): Promise<void> {
    if (this.activeModal.kind !== "deleteConfirm") return;
    const id = this.activeModal.template.id;
    this.activeModal = { kind: "none" };
    await templatesStore.deleteIds([id]);
  }
}

export const uiDialogs = new UiDialogs();
