<script lang="ts">
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import CheatSheet from "$lib/components/CheatSheet.svelte";
  import {
    checkForUpdate,
    listTemplateBackups,
  } from "$lib/api";
  import { orderedTagCounts } from "$lib/tags";
  import type { Settings } from "$lib/types";
  import {
    handleExportTemplates,
    handleImportTemplates,
    templatesStore,
  } from "$lib/stores/templatesStore.svelte";
  import { selectionStore } from "$lib/stores/selectionStore.svelte";
  import { uiDialogs } from "$lib/stores/uiDialogs.svelte";

  let { appVersion }: { appVersion: string } = $props();

  // Local bind target — ConfirmDialog needs a bindable; sync into the store.
  let bulkTagDraft = $state("");
  $effect(() => {
    if (uiDialogs.bulkTagPromptOpen || uiDialogs.bulkRemoveTagPromptOpen) return;
    bulkTagDraft = "";
  });

  const templates = $derived(templatesStore.templates);
  const settings = $derived(templatesStore.settings);
  const settingsTagCounts = $derived(orderedTagCounts(templates, settings.tag_order));

  async function handleSettingsUpdate(next: Settings): Promise<void> {
    await templatesStore.persist(templatesStore.templates, next);
  }

  async function handleRenameTag(from: string, to: string): Promise<void> {
    await templatesStore.handleRenameTag(from, to);
    selectionStore.remapTag(from, to);
  }

  async function handleDeleteTag(tag: string): Promise<void> {
    await templatesStore.handleDeleteTag(tag);
    selectionStore.removeTag(tag);
  }

  async function confirmBulkTag(): Promise<void> {
    uiDialogs.bulkTagDraft = bulkTagDraft;
    await uiDialogs.confirmBulkTag();
    bulkTagDraft = "";
  }

  async function confirmBulkRemoveTag(): Promise<void> {
    uiDialogs.bulkTagDraft = bulkTagDraft;
    await uiDialogs.confirmBulkRemoveTag();
    bulkTagDraft = "";
  }
</script>

{#if uiDialogs.settingsOpen}
  <SettingsModal
    {settings}
    currentVersion={appVersion}
    tagCounts={settingsTagCounts}
    onClose={() => (uiDialogs.settingsOpen = false)}
    onUpdate={handleSettingsUpdate}
    onExportTemplates={handleExportTemplates}
    onImportTemplates={handleImportTemplates}
    onCheckUpdate={checkForUpdate}
    onListBackups={listTemplateBackups}
    onRestoreBackup={(name) => templatesStore.handleRestoreBackup(name)}
    onRenameTag={handleRenameTag}
    onDeleteTag={handleDeleteTag}
    onOpenCheatSheet={() => {
      uiDialogs.settingsOpen = false;
      uiDialogs.cheatSheetOpen = true;
    }}
  />
{/if}

{#if uiDialogs.cheatSheetOpen}
  <CheatSheet
    globalHotkey={settings.global_hotkey}
    previewHotkey={settings.preview_hotkey}
    onClose={() => (uiDialogs.cheatSheetOpen = false)}
  />
{/if}

{#if uiDialogs.bulkDeleteConfirmOpen}
  <ConfirmDialog
    title="Delete {selectionStore.bulkSelectedIds.size} templates?"
    message="Ctrl+Z will restore them."
    confirmLabel="Delete {selectionStore.bulkSelectedIds.size}"
    danger
    ariaLabel="Confirm bulk delete"
    onConfirm={() => void uiDialogs.confirmBulkDelete()}
    onCancel={() => (uiDialogs.bulkDeleteConfirmOpen = false)}
  />
{/if}

{#if uiDialogs.bulkTagPromptOpen}
  <ConfirmDialog
    title="Add tag to {selectionStore.bulkSelectedIds.size} templates"
    confirmLabel="Add"
    ariaLabel="Bulk add tag"
    input
    bind:inputValue={bulkTagDraft}
    inputPlaceholder="tag name"
    confirmDisabled={bulkTagDraft.trim().length === 0}
    onConfirm={() => void confirmBulkTag()}
    onCancel={() => {
      uiDialogs.bulkTagPromptOpen = false;
      bulkTagDraft = "";
    }}
    onDismiss={() => (uiDialogs.bulkTagPromptOpen = false)}
  />
{/if}

{#if uiDialogs.bulkRemoveTagPromptOpen}
  <ConfirmDialog
    title="Remove tag from {selectionStore.bulkSelectedIds.size} templates"
    confirmLabel="Remove"
    danger
    ariaLabel="Bulk remove tag"
    input
    bind:inputValue={bulkTagDraft}
    inputPlaceholder="tag name"
    confirmDisabled={bulkTagDraft.trim().length === 0}
    onConfirm={() => void confirmBulkRemoveTag()}
    onCancel={() => {
      uiDialogs.bulkRemoveTagPromptOpen = false;
      bulkTagDraft = "";
    }}
    onDismiss={() => (uiDialogs.bulkRemoveTagPromptOpen = false)}
  />
{/if}

{#if uiDialogs.contextMenu}
  <ContextMenu
    x={uiDialogs.contextMenu.x}
    y={uiDialogs.contextMenu.y}
    items={uiDialogs.contextMenu.items}
    onClose={() => uiDialogs.closeContextMenu()}
  />
{/if}

{#if uiDialogs.contextDeleteTarget}
  <ConfirmDialog
    title="Delete template?"
    name={uiDialogs.contextDeleteTarget.name}
    message="Ctrl+Z will restore it."
    confirmLabel="Delete"
    danger
    onConfirm={() => void uiDialogs.confirmContextDelete()}
    onCancel={() => (uiDialogs.contextDeleteTarget = null)}
  />
{/if}
