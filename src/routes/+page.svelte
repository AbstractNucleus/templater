<script lang="ts">
  import TagsSidebar from "$lib/components/TagsSidebar.svelte";
  import TemplatesSidebar, { type SelectModifier } from "$lib/components/TemplatesSidebar.svelte";
  import MainPanel from "$lib/components/MainPanel.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import ResizeHandles from "$lib/components/ResizeHandles.svelte";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ContextMenu.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import CheatSheet from "$lib/components/CheatSheet.svelte";
  import OnboardingTour from "$lib/components/OnboardingTour.svelte";
  import { readText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { searchTemplates } from "$lib/search";
  import {
    canReorder,
    filterByTags,
    groupPinnedHits,
    sortTemplates,
  } from "$lib/browse";
  import { orderedTagCounts } from "$lib/tags";
  import { buildContextMenu } from "$lib/contextMenu";
  import {
    getAppVersion,
    openDataDir,
    checkForUpdate,
    listTemplateBackups,
  } from "$lib/api";
  import {
    DEFAULT_COLUMN_WIDTHS,
    type Settings,
    type Template,
    type TemplateDraft,
  } from "$lib/types";
  import {
    templatesStore,
    handleExportTemplates,
    handleImportTemplates,
  } from "$lib/stores/templatesStore.svelte";
  import { selectionStore } from "$lib/stores/selectionStore.svelte";
  import { popouts } from "$lib/stores/popouts.svelte";
  import { uiDialogs } from "$lib/stores/uiDialogs.svelte";
  import { createGlobalKeydownHandler } from "$lib/keyboard";

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.1;

  const TAGS_MIN = 100;
  const TAGS_MAX = 400;
  const TEMPLATES_MIN = 160;
  const TEMPLATES_MAX = 500;

  let tagsWidth = $state(DEFAULT_COLUMN_WIDTHS.tags);
  let templatesWidth = $state(DEFAULT_COLUMN_WIDTHS.templates);
  let searchInput: HTMLInputElement | undefined = $state();

  // New-template flow state. When non-null, the template form opens for creation.
  let creatingDraft = $state<TemplateDraft | null>(null);

  function clearSearch(): void {
    searchQuery = "";
    searchInput?.focus();
  }

  function handleGlobalContextMenu(e: MouseEvent): void {
    const result = buildContextMenu(e);
    if (result.action === "default") return;
    e.preventDefault();
    if (result.action === "menu") {
      contextMenu = { x: e.clientX, y: e.clientY, items: result.items };
    }
  }

  function setZoom(next: number): void {
    // Round to one decimal to avoid 0.1-step float drift (0.7 + 0.1 = 0.7999…).
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 10) / 10));
    if (clamped === templatesStore.settings.zoom) return;
    void templatesStore.persist(templatesStore.templates, { ...templatesStore.settings, zoom: clamped });
  }

  function isInputFocused(): boolean {
    const ae = document.activeElement;
    if (!ae || ae === document.body) return false;
    const tag = ae.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if ((ae as HTMLElement).isContentEditable) return true;
    return false;
  }

  function moveSelection(delta: number): void {
    selectionStore.moveSelection(visibleTemplateIds, delta);
  }

  function copySelected(): void {
    if (selectionStore.selectedTemplateId === null) return;
    copyTrigger++;
  }

  function startResize(target: "tags" | "templates"): (e: PointerEvent) => void {
    return (e) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      const startX = e.clientX;
      const widthOf = (t: typeof target): number =>
        t === "tags" ? tagsWidth : templatesWidth;
      const startWidth = widthOf(target);
      const min =
        target === "tags"
          ? TAGS_MIN
          : TEMPLATES_MIN;
      const max =
        target === "tags"
          ? TAGS_MAX
          : TEMPLATES_MAX;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");

      function onMove(ev: PointerEvent): void {
        const next = Math.round(Math.max(min, Math.min(max, startWidth + (ev.clientX - startX))));
        if (target === "tags") tagsWidth = next;
        else templatesWidth = next;
      }

      function onUp(): void {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("dragging");
        const final = widthOf(target);
        if (final !== templatesStore.settings.column_widths[target]) {
          void templatesStore.persist(templatesStore.templates, {
            ...templatesStore.settings,
            column_widths: { ...templatesStore.settings.column_widths, [target]: final },
          });
        }
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    };
  }

  let appVersion = $state("0.0.0");

  let searchQuery = $state("");
  let includeOpening = $state(true);
  let includeSignature = $state(true);
  let editing = $state(false);

  let copyTrigger = $state(0);

  let contextMenu = $state<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  let bulkTagDraft = $state("");

  // Read-only aliases keep template + derivation code readable. Mutations go
  // directly through the stores so reactivity propagates back.
  const templates = $derived(templatesStore.templates);
  const settings = $derived(templatesStore.settings);
  const loaded = $derived(templatesStore.loaded);
  const undoToast = $derived(templatesStore.undoToast);

  const selectedTemplate = $derived(
    templates.find((t) => t.id === selectionStore.selectedTemplateId) ?? null,
  );

  const isEditorMode = $derived(templatesStore.isEditorMode);

  const isMinimal = $derived(settings.minimal);

  const availableTags = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templates) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  });

  const availableFolders = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.folder !== null) set.add(t.folder);
    return [...set].sort();
  });

  const browseOrdered = $derived(sortTemplates(templates, settings.sort_mode));

  const tagFiltered = $derived(
    filterByTags(
      browseOrdered,
      selectionStore.selectedTagIds,
      selectionStore.excludedTagIds,
      selectionStore.tagCombinator,
    ),
  );

  const rawHits = $derived(searchTemplates(searchQuery, tagFiltered));

  // Group pinned to the top regardless of search score. Within each tier the
  // searchTemplates ordering (full-match → score → name) is preserved.
  const searchResults = $derived(groupPinnedHits(rawHits));

  // Drag-reorder is only safe when the visible order IS the underlying array
  // order. Any filter, search, or paste-mode ranking breaks that invariant.
  const canReorderTemplates = $derived(
    canReorder({
      isEditorMode,
      searchQuery,
      selectedTagIds: selectionStore.selectedTagIds,
      excludedTagIds: selectionStore.excludedTagIds,
      sortMode: settings.sort_mode,
    }),
  );

  // Tag counts shared between the Tags sidebar UI and the SettingsModal tag
  // manager.
  const settingsTagCounts = $derived(orderedTagCounts(templates, settings.tag_order));

  // Props the MainPanel takes identically in all three render modes (create /
  // edit / browse). Spread at each site with `{...sharedMainPanelProps}`;
  // per-branch props (template, editing, creatingDraft, action callbacks) are
  // passed explicitly alongside the spread.
  const sharedMainPanelProps = $derived({
    globalSignature: settings.global_signature,
    snippets: settings.snippets,
    canEdit: isEditorMode,
    availableTags,
    availableFolders,
    copyTrigger,
    savedPlaceholderValues: settings.placeholder_values,
    includeOpening,
    includeSignature,
    onToggleOpening: (v: boolean) => (includeOpening = v),
    onToggleSignature: (v: boolean) => (includeSignature = v),
    onCopySuccess: (id: string) => void templatesStore.recordCopy(id),
    onPlaceholderValuesChange: (id: string, vals: Record<string, string>) =>
      void templatesStore.recordPlaceholderValues(id, vals),
    onRevertHistory: (id: string, idx: number) => void templatesStore.revertHistory(id, idx),
  });

  // Ordered IDs the user can step through with ↑/↓. Only browse search results.
  const visibleTemplateIds = $derived(
    searchResults.map((h) => h.template.id),
  );

  // Snap selection to the first visible row when the current pick drops out
  // of the result set (e.g. user typed and the previous selection no longer
  // matches). Skip during editing where the selection is locked.
  $effect(() => {
    if (editing || creatingDraft) return;
    selectionStore.ensureSelection(visibleTemplateIds);
  });

  $effect(() => {
    void (async () => {
      try {
        const [version] = await Promise.all([
          getAppVersion().catch(() => "0.0.0"),
        ]);
        appVersion = version;
        await templatesStore.load();
        selectionStore.selectInitial(templatesStore.templates);
        const s = templatesStore.settings;
        tagsWidth = s.column_widths.tags;
        templatesWidth = s.column_widths.templates;
      } catch (e) {
        // Surface the error and leave templates empty — DON'T fall back to
        // starter templates here. Any subsequent persist would overwrite the
        // user's (presumably recoverable) on-disk file with the starter set.
        templatesStore.loadError = String(e);
      }
    })();
  });

  function handleTemplateSelect(id: string, modifier: SelectModifier = "none"): void {
    if (editing) {
      editing = false;
    }
    selectionStore.selectTemplate(id, visibleTemplateIds, modifier);
  }

  function handleSearchChange(q: string): void {
    searchQuery = q;
  }

  // The Rust handler emits this when the quick-capture hotkey is pressed.
  // Read the clipboard and open the new-template form with the body
  // pre-filled. Skipped in User mode (no template creation allowed).
  $effect(() => {
    const unlisten = listen("quick-capture", async () => {
      if (!isEditorMode) return;
      let text = "";
      try {
        text = (await readText()) ?? "";
      } catch {
        text = "";
      }
      handleNew(text);
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  async function handleSave(updated: Template): Promise<void> {
    await templatesStore.handleSave(updated);
    editing = false;
  }

  function enterEditMode(): void {
    if (!selectedTemplate) return;
    editing = true;
  }

  function cancelEditMode(): void {
    editing = false;
  }

  async function handleNew(prefilledBody: string = ""): Promise<void> {
    if (!isEditorMode) return;
    creatingDraft = {
      name: "",
      tags: [],
      opening: "Hello,",
      body: prefilledBody,
      folder: null,
    };
  }

  async function handleCreateDraft(draft: TemplateDraft): Promise<void> {
    const id = await templatesStore.createTemplate(draft);
    if (!id) return;
    selectionStore.selectedTemplateId = id;
    creatingDraft = null;
  }

  function cancelCreateDraft(): void {
    creatingDraft = null;
  }

  async function duplicateSelectedTemplate(): Promise<void> {
    if (!selectedTemplate) return;
    const id = await templatesStore.duplicateTemplateById(selectedTemplate.id);
    if (id) selectionStore.selectedTemplateId = id;
  }

  async function deleteSelectedTemplate(): Promise<void> {
    if (!selectedTemplate) return;
    const id = selectedTemplate.id;
    await templatesStore.deleteTemplateById(id);
    selectionStore.pruneBulkSelection(new Set([id]));
    selectionStore.selectedTemplateId = templatesStore.templates[0]?.id ?? null;
  }

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

  function openContextForTemplate(id: string, x: number, y: number): void {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;

    // Bulk menu: when the right-clicked row is part of a >1 selection, show
    // bulk actions instead of per-template ones. Otherwise fall through to
    // the single-template menu.
    const bulk = selectionStore.bulkSelectedIds;
    if (bulk.size > 1 && bulk.has(id)) {
      const count = bulk.size;
      const items: ContextMenuItem[] = [];
      if (isEditorMode) {
        items.push({
          label: `Add tag to ${count}…`,
          onClick: () => (uiDialogs.bulkTagPromptOpen = true),
        });
        items.push({
          label: `Remove tag from ${count}…`,
          onClick: () => (uiDialogs.bulkRemoveTagPromptOpen = true),
        });
      }
      items.push({ label: `Export ${count}…`, onClick: () => void templatesStore.bulkExport(bulk) });
      if (isEditorMode) {
        items.push({
          label: `Delete ${count}`,
          danger: true,
          onClick: () => (uiDialogs.bulkDeleteConfirmOpen = true),
        });
      }
      contextMenu = { x, y, items };
      return;
    }

    const items: ContextMenuItem[] = [];
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
        onClick: () => (uiDialogs.contextDeleteTarget = tpl),
      });
    }
    contextMenu = { x, y, items };
  }

  async function confirmBulkDelete(): Promise<void> {
    const ids = new Set(selectionStore.bulkSelectedIds);
    uiDialogs.bulkDeleteConfirmOpen = false;
    await templatesStore.bulkDelete(ids);
    selectionStore.bulkSelectedIds = new Set();
    if (selectionStore.selectedTemplateId !== null && ids.has(selectionStore.selectedTemplateId)) {
      selectionStore.selectedTemplateId = templates[0]?.id ?? null;
    }
  }

  async function confirmBulkTag(): Promise<void> {
    const tag = bulkTagDraft.trim();
    if (tag.length === 0) return;
    uiDialogs.bulkTagPromptOpen = false;
    bulkTagDraft = "";
    await templatesStore.bulkAddTag(selectionStore.bulkSelectedIds, tag);
  }

  async function confirmBulkRemoveTag(): Promise<void> {
    const tag = bulkTagDraft.trim();
    if (tag.length === 0) return;
    uiDialogs.bulkRemoveTagPromptOpen = false;
    bulkTagDraft = "";
    await templatesStore.bulkRemoveTag(selectionStore.bulkSelectedIds, tag);
  }

  function openContextForEmpty(x: number, y: number): void {
    contextMenu = {
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

  function closeContextMenu(): void {
    contextMenu = null;
  }

  async function confirmContextDelete(): Promise<void> {
    if (!uiDialogs.contextDeleteTarget) return;
    const id = uiDialogs.contextDeleteTarget.id;
    uiDialogs.contextDeleteTarget = null;
    await templatesStore.deleteTemplateById(id);
    selectionStore.pruneBulkSelection(new Set([id]));
    if (selectionStore.selectedTemplateId === id) {
      selectionStore.selectedTemplateId = templatesStore.templates[0]?.id ?? null;
    }
  }

  function cancelContextDelete(): void {
    uiDialogs.contextDeleteTarget = null;
  }

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = settings.theme;
    }
  });

  $effect(() => {
    // Webview-level zoom (Ctrl+/− style) reflows scrollbars and hit-testing
    // correctly — CSS `zoom` clips fixed-height flex layouts.
    const z = settings.zoom ?? 1;
    void getCurrentWebview().setZoom(z).catch(() => {});
  });

  // Tray menu → Settings emits this; Rust has already shown + focused the window.
  $effect(() => {
    const unlisten = listen("open-settings", () => {
      uiDialogs.settingsOpen = true;
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  const handleGlobalKeydown = createGlobalKeydownHandler({
    getZoom: () => templatesStore.settings.zoom ?? 1,
    setZoom,
    zoomStep: ZOOM_STEP,
    getSearchInput: () => searchInput,
    getSearchQuery: () => searchQuery,
    clearSearch,
    isEditing: () => editing || creatingDraft !== null,
    isInputFocused,
    moveSelection,
    copySelected,
    isMinimal: () => isMinimal,
  });

  function previewPayload() {
    return popouts.buildPreviewPayload(isEditorMode, selectedTemplate);
  }

  // Push the current template to the pop-out whenever the selection or any
  // relevant setting changes — but only while the pop-out is open.
  $effect(() => {
    void selectedTemplate;
    void settings.global_signature;
    void settings.snippets;
    void settings.placeholder_values;
    void settings.theme;
    void settings.preview_hotkey;
    popouts.pushPreview(previewPayload());
  });

  $effect(() => {
    void settings.openrouter_api_key;
    void settings.translation_model;
    void settings.theme;
    popouts.pushTranslator(popouts.buildTranslatorPayload());
  });

  $effect(() => {
    return popouts.mountListeners({
      getPreviewPayload: previewPayload,
      getTranslatorPayload: () => popouts.buildTranslatorPayload(),
    });
  });

  // When minimal mode turns off, hide any stray preview window so the toggle
  // state can't dangle open without the affordance that controls it.
  $effect(() => {
    if (!isMinimal) popouts.closePreviewForMinimalOff();
  });

  // Shrink the main window to just Tags + Templates when minimal mode engages,
  // and restore the prior width when it disengages. Fires only on transitions,
  // not on the initial mount — `prevMinimal` is undefined until the effect has
  // run once, so the first run just primes the flag.
  let prevMinimal: boolean | undefined;
  let preMinimalWidth: number | null = null;
  $effect(() => {
    if (prevMinimal === undefined) {
      prevMinimal = isMinimal;
      return;
    }
    if (isMinimal === prevMinimal) return;
    prevMinimal = isMinimal;
    void (async () => {
      try {
        const win = getCurrentWindow();
        if (isMinimal) {
          const size = await win.outerSize();
          const factor = await win.scaleFactor().catch(() => 1);
          const logicalW = size.width / factor;
          // Account for the OS frame's vertical chrome; only width matters.
          const minimalW = tagsWidth + templatesWidth + 6 /* col-resize */ + 2 /* frame borders */;
          // Only stash if the window is actually wider than the minimal target —
          // otherwise restoring later would grow a window the user already had narrow.
          if (logicalW > minimalW + 8) {
            preMinimalWidth = logicalW;
          }
          await win.setSize(new LogicalSize(minimalW, size.height / factor));
        } else if (preMinimalWidth !== null) {
          const size = await win.outerSize();
          const factor = await win.scaleFactor().catch(() => 1);
          await win.setSize(new LogicalSize(preMinimalWidth, size.height / factor));
          preMinimalWidth = null;
        }
      } catch {
        /* best-effort */
      }
    })();
  });

  // On first load, query whether satellite windows are already open.
  $effect(() => {
    void popouts.syncOpenFlags();
  });

</script>

<svelte:window onkeydown={handleGlobalKeydown} oncontextmenu={handleGlobalContextMenu} />

<div class="frame">
  <TitleBar
    onOpenSettings={() => (uiDialogs.settingsOpen = true)}
    showSearch={!editing && creatingDraft === null}
    {searchQuery}
    onSearchChange={handleSearchChange}
    onClearSearch={clearSearch}
    onSearchInputMount={(el) => (searchInput = el ?? undefined)}
    minimal={isMinimal}
    previewOpen={popouts.previewOpen}
    onTogglePreview={() => void popouts.togglePreview(previewPayload)}
    translatorOpen={popouts.translatorOpen}
    onToggleTranslator={() =>
      void popouts.toggleTranslator(() => popouts.buildTranslatorPayload())
    }
  />
  <div class="shell">
    {#if !loaded}
      <aside class="skel skel-tags" style="width: {tagsWidth}px" aria-hidden="true">
        {#each Array(7) as _, i (i)}
          <div class="skel-row" style="animation-delay: {i * 80}ms"></div>
        {/each}
      </aside>
      <aside class="skel skel-templates" style="width: {templatesWidth}px" aria-hidden="true">
        {#each Array(9) as _, i (i)}
          <div class="skel-row tall" style="animation-delay: {i * 80}ms"></div>
        {/each}
      </aside>
      <section class="skel skel-main" aria-hidden="true">
        <div class="skel-line wide"></div>
        <div class="skel-line"></div>
        <div class="skel-block"></div>
      </section>
    {:else if creatingDraft !== null}
      <MainPanel
        {...sharedMainPanelProps}
        mode={{
          kind: "create",
          draft: creatingDraft,
          onCancel: cancelCreateDraft,
          onCreate: handleCreateDraft,
        }}
      />
    {:else if editing && selectedTemplate}
      <MainPanel
        {...sharedMainPanelProps}
        mode={{
          kind: "edit",
          template: selectedTemplate,
          onCancel: cancelEditMode,
          onSave: handleSave,
          onDuplicate: () => void duplicateSelectedTemplate(),
          onDelete: () => void deleteSelectedTemplate(),
        }}
      />
    {:else}
      <TagsSidebar
        {templates}
        selectedTagIds={selectionStore.selectedTagIds}
        excludedTagIds={selectionStore.excludedTagIds}
        tagCombinator={selectionStore.tagCombinator}
        tagOrder={settings.tag_order}
        width={tagsWidth}
        onTagToggle={(tag) => selectionStore.toggleTag(tag)}
        onTagExclude={(tag) => selectionStore.excludeTag(tag)}
        onTagsClear={() => selectionStore.clearTags()}
        onCombinatorToggle={() => selectionStore.toggleTagCombinator()}
        onContextEmpty={openContextForEmpty}
        onTagReorder={(next) => void templatesStore.handleTagsReorder(next)}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("tags")}
      ></div>
      <TemplatesSidebar
        {searchResults}
        {templates}
        selectedTemplateId={selectionStore.selectedTemplateId}
        bulkSelectedIds={selectionStore.bulkSelectedIds}
        width={templatesWidth}
        flex={isMinimal}
        canCreate={isEditorMode}
        canReorder={canReorderTemplates}
        sortMode={settings.sort_mode}
        onTemplateSelect={handleTemplateSelect}
        onNew={() => void handleNew()}
        onClearFilters={() => {
          selectionStore.clearTags();
          clearSearch();
        }}
        onContextTemplate={openContextForTemplate}
        onContextEmpty={openContextForEmpty}
        onReorder={(ids) => void templatesStore.handleTemplatesReorder(ids)}
        onMoveToFolder={(ids, folder) => void templatesStore.moveToFolder(ids, folder)}
        onSortModeToggle={() => templatesStore.handleSortModeToggle()}
        onBulkAddTag={() => (uiDialogs.bulkTagPromptOpen = true)}
        onBulkRemoveTag={() => (uiDialogs.bulkRemoveTagPromptOpen = true)}
        onBulkExport={() => void templatesStore.bulkExport(selectionStore.bulkSelectedIds)}
        onBulkDelete={() => (uiDialogs.bulkDeleteConfirmOpen = true)}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      {#if !isMinimal}
        <div
          class="col-resize"
          title="Drag to resize"
          onpointerdown={startResize("templates")}
        ></div>
        <MainPanel
          {...sharedMainPanelProps}
          mode={{
            kind: "browse",
            template: selectedTemplate,
            onEnterEdit: enterEditMode,
            onSave: handleSave,
            onDuplicate: () => void duplicateSelectedTemplate(),
            onDelete: () => void deleteSelectedTemplate(),
          }}
        />
      {/if}
    {/if}
    {#if templatesStore.loadError}
      <div class="error-banner">
        <span class="error-text">{templatesStore.loadError}</span>
        <button class="error-close" aria-label="Dismiss error" onclick={() => (templatesStore.loadError = null)}>×</button>
      </div>
    {/if}
    {#if undoToast}
      <div class="undo-toast" style="bottom: {templatesStore.loadError ? 48 : 12}px">{undoToast}</div>
    {/if}
  </div>
</div>

<ResizeHandles />

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

{#if loaded && !settings.onboarding_complete}
  <OnboardingTour
    onDismiss={() => {
      void templatesStore.persist(templatesStore.templates, {
        ...templatesStore.settings,
        onboarding_complete: true,
        close_hint_shown: true,
      });
    }}
  />
{/if}

{#if uiDialogs.bulkDeleteConfirmOpen}
  <ConfirmDialog
    title="Delete {selectionStore.bulkSelectedIds.size} templates?"
    message="Ctrl+Z will restore them."
    confirmLabel="Delete {selectionStore.bulkSelectedIds.size}"
    danger
    ariaLabel="Confirm bulk delete"
    onConfirm={() => void confirmBulkDelete()}
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

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={closeContextMenu}
  />
{/if}

{#if uiDialogs.contextDeleteTarget}
  <ConfirmDialog
    title="Delete template?"
    name={uiDialogs.contextDeleteTarget.name}
    message="Ctrl+Z will restore it."
    confirmLabel="Delete"
    danger
    onConfirm={() => void confirmContextDelete()}
    onCancel={cancelContextDelete}
  />
{/if}

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 24px var(--shadow), 0 0 0 1px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    position: relative;
  }

  .shell {
    display: flex;
    flex: 1;
    width: 100%;
    position: relative;
    min-height: 0;
  }

  .skel {
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 12px 8px;
    box-sizing: border-box;
  }

  .skel-main {
    flex: 1;
    padding: 20px 24px;
    background: var(--bg-base);
    border-right: none;
  }

  .skel-row,
  .skel-line,
  .skel-block {
    background: var(--bg-hover);
    border-radius: 4px;
    animation: skel-pulse 1.4s ease-in-out infinite;
  }

  .skel-row {
    height: 18px;
    margin: 6px 4px;
  }

  .skel-row.tall {
    height: 28px;
  }

  .skel-line {
    height: 14px;
    width: 60%;
    margin-bottom: 12px;
  }

  .skel-line.wide {
    width: 80%;
    height: 22px;
    margin-bottom: 8px;
  }

  .skel-block {
    height: 240px;
    margin-top: 16px;
  }

  @keyframes skel-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 0.85; }
  }

  .col-resize {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background 120ms;
    margin-left: -1px;
    margin-right: -1px;
    position: relative;
    z-index: 2;
  }

  .col-resize:hover,
  :global(.col-resize.dragging) {
    background: var(--border-focus);
  }

  .error-banner {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
    padding: 6px 12px;
    font-size: 0.8rem;
    border-top: 1px solid var(--accent-danger-border);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
  }

  .error-close {
    background: transparent;
    border: none;
    color: var(--accent-danger-text);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .error-close:hover {
    opacity: 0.7;
  }

  .undo-toast {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-active);
    color: var(--text-strong);
    border: 1px solid var(--border-strong);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.8rem;
    pointer-events: none;
    box-shadow: 0 4px 12px var(--shadow);
    z-index: 200;
  }
</style>