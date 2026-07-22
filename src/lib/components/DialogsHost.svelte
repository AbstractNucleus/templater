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

  const templates = $derived(templatesStore.templates);
  const settings = $derived(templatesStore.settings);
  const settingsTagCounts = $derived(orderedTagCounts(templates, settings.tag_order));

  /** Coalesce settings keystrokes — preference patches only, after quiet period. */
  const PREFS_DEBOUNCE_MS = 400;
  let prefsTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPrefs: Settings | null = null;

  function handleSettingsUpdate(next: Settings): void {
    templatesStore.settings = next;
    pendingPrefs = next;
    if (prefsTimer) clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => {
      prefsTimer = null;
      const s = pendingPrefs;
      pendingPrefs = null;
      if (!s) return;
      void templatesStore.persist(templatesStore.templates, s).catch(() => {});
    }, PREFS_DEBOUNCE_MS);
  }

  async function flushPendingPrefs(): Promise<void> {
    if (prefsTimer) {
      clearTimeout(prefsTimer);
      prefsTimer = null;
    }
    const s = pendingPrefs;
    pendingPrefs = null;
    if (!s) return;
    try {
      await templatesStore.persist(templatesStore.templates, s);
    } catch {
      /* appErrors already set by persist */
    }
  }

  async function closeSettings(): Promise<void> {
    await flushPendingPrefs();
    uiDialogs.settingsOpen = false;
  }
</script>

{#if uiDialogs.settingsOpen}
  <SettingsModal
    {settings}
    currentVersion={appVersion}
    tagCounts={settingsTagCounts}
    onClose={() => void closeSettings()}
    onUpdate={handleSettingsUpdate}
    onExportTemplates={handleExportTemplates}
    onImportTemplates={handleImportTemplates}
    onCheckUpdate={checkForUpdate}
    onListBackups={listTemplateBackups}
    onRestoreBackup={(name) => templatesStore.handleRestoreBackup(name).catch(() => {})}
    onRenameTag={(from, to) => templatesStore.handleRenameTag(from, to).catch(() => {})}
    onDeleteTag={(tag) => templatesStore.handleDeleteTag(tag).catch(() => {})}
    onOpenCheatSheet={() => {
      void flushPendingPrefs().then(() => {
        uiDialogs.settingsOpen = false;
        uiDialogs.cheatSheetOpen = true;
      });
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
    onConfirm={() => void uiDialogs.confirmBulkDelete().catch(() => {})}
    onCancel={() => (uiDialogs.bulkDeleteConfirmOpen = false)}
  />
{/if}

{#if uiDialogs.bulkTagPromptOpen}
  <ConfirmDialog
    title="Add tag to {selectionStore.bulkSelectedIds.size} templates"
    confirmLabel="Add"
    ariaLabel="Bulk add tag"
    input
    bind:inputValue={uiDialogs.bulkTagDraft}
    inputPlaceholder="tag name"
    confirmDisabled={uiDialogs.bulkTagDraft.trim().length === 0}
    onConfirm={() => void uiDialogs.confirmBulkTag().catch(() => {})}
    onCancel={() => uiDialogs.closeBulkTagPrompt()}
    onDismiss={() => uiDialogs.closeBulkTagPrompt()}
  />
{/if}

{#if uiDialogs.bulkRemoveTagPromptOpen}
  <ConfirmDialog
    title="Remove tag from {selectionStore.bulkSelectedIds.size} templates"
    confirmLabel="Remove"
    danger
    ariaLabel="Bulk remove tag"
    input
    bind:inputValue={uiDialogs.bulkTagDraft}
    inputPlaceholder="tag name"
    confirmDisabled={uiDialogs.bulkTagDraft.trim().length === 0}
    onConfirm={() => void uiDialogs.confirmBulkRemoveTag().catch(() => {})}
    onCancel={() => uiDialogs.closeBulkRemoveTagPrompt()}
    onDismiss={() => uiDialogs.closeBulkRemoveTagPrompt()}
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

{#if uiDialogs.deleteConfirmTarget}
  <ConfirmDialog
    title="Delete template?"
    name={uiDialogs.deleteConfirmTarget.name}
    message="Ctrl+Z will restore it."
    confirmLabel="Delete"
    danger
    onConfirm={() => void uiDialogs.confirmDelete().catch(() => {})}
    onCancel={() => (uiDialogs.deleteConfirmTarget = null)}
  />
{/if}
