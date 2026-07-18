<script lang="ts">
  import type { SearchHit } from "$lib/search";
  import { createDragReorder } from "$lib/dragReorder.svelte";
  import TemplateRow from "./TemplateRow.svelte";
  import TemplateBulkBar from "./TemplateBulkBar.svelte";
  import GroupedTemplateList from "./GroupedTemplateList.svelte";
  import { templatesStore } from "$lib/stores/templatesStore.svelte";
  import { selectionStore } from "$lib/stores/selectionStore.svelte";
  import { browseSession } from "$lib/stores/browseSession.svelte";
  import { editorSession } from "$lib/stores/editorSession.svelte";
  import { uiDialogs } from "$lib/stores/uiDialogs.svelte";

  let {
    width,
    flex = false,
  }: {
    width: number;
    /** When true, the sidebar flexes to fill available space instead of
     *  using the fixed `width` (used in minimal mode so window resizes flow
     *  into the templates column rather than exposing a dead preview area). */
    flex?: boolean;
  } = $props();

  const templates = $derived(templatesStore.templates);
  const searchResults = $derived(browseSession.results);
  const selectedTemplateId = $derived(selectionStore.selectedTemplateId);
  const bulkSelectedIds = $derived(selectionStore.bulkSelectedIds);
  const canCreate = $derived(templatesStore.isEditorMode);
  const canReorder = $derived(browseSession.canReorderTemplates);
  const sortMode = $derived(templatesStore.settings.sort_mode);

  function handleEmptyContext(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    uiDialogs.openContextForEmpty(e.clientX, e.clientY);
  }

  function handleTemplateContext(e: MouseEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    uiDialogs.openContextForTemplate(id, e.clientX, e.clientY);
  }

  const hasFolders = $derived(templates.some((t) => t.folder !== null));

  let collapsedFolders = $state<Set<string>>(new Set());

  function toggleFolder(name: string): void {
    const next = new Set(collapsedFolders);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    collapsedFolders = next;
  }

  const groupedSearchResults = $derived.by(() => {
    const groups = new Map<string | null, SearchHit[]>();
    const order: (string | null)[] = [];
    for (const hit of searchResults) {
      const key = hit.template.folder;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(hit);
    }
    return order.map((k) => ({ folder: k, hits: groups.get(k)! }));
  });

  let sidebarEl: HTMLElement | undefined = $state();

  $effect(() => {
    if (!selectedTemplateId || !sidebarEl) return;
    const btn = sidebarEl.querySelector(
      `[data-id="${CSS.escape(selectedTemplateId)}"]`,
    ) as HTMLElement | null;
    btn?.scrollIntoView({ block: "nearest" });
  });

  const drag = createDragReorder({
    enabled: () => canReorder,
    currentIds: () => templates.map((t) => t.id),
    onReorder: (ids) => void templatesStore.handleTemplatesReorder(ids),
  });

  let dragOverFolder = $state<string | null>(null);

  function draggedSelection(): Set<string> {
    if (drag.draggingId === null) return new Set();
    if (bulkSelectedIds.size > 1 && bulkSelectedIds.has(drag.draggingId)) {
      return new Set(bulkSelectedIds);
    }
    return new Set([drag.draggingId]);
  }

  function handleFolderDragOver(e: DragEvent, folder: string | null): void {
    if (!canReorder || drag.draggingId === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverFolder = folder ?? "__ungrouped__";
  }

  function handleFolderDrop(e: DragEvent, folder: string | null): void {
    if (!canReorder || drag.draggingId === null) return;
    e.preventDefault();
    const ids = draggedSelection();
    drag.reset();
    dragOverFolder = null;
    void templatesStore.moveToFolder(ids, folder);
  }

  function handleDragEnd(): void {
    drag.handleDragEnd();
    dragOverFolder = null;
  }
</script>

<aside
  bind:this={sidebarEl}
  class="sidebar"
  class:flex-grow={flex}
  style={flex ? "" : `width: ${width}px`}
  oncontextmenu={handleEmptyContext}
>
  <div class="sticky-header">
    <div class="section-row">
      <div class="section-label">Templates</div>
      <div class="header-controls">
        <button
          class="sort-btn"
          title={sortMode === "manual"
            ? "Manual order. Drag templates to reorder. Click → recent."
            : sortMode === "recent"
              ? "Sorted by most recently copied. Click → most used."
              : sortMode === "most_used"
                ? "Sorted by lifetime copy count. Click → never used."
                : "Sorted by never used first. Click → manual."}
          onclick={() => templatesStore.handleSortModeToggle()}
        >{
          sortMode === "manual" ? "Manual ↕"
          : sortMode === "recent" ? "Recent ↓"
          : sortMode === "most_used" ? "Most used ★"
          : "Never used 0"
        }</button>
        {#if canCreate}
          <button class="new-btn" title="New template" onclick={() => editorSession.startCreate()}>+</button>
        {/if}
      </div>
    </div>

    <TemplateBulkBar
      count={bulkSelectedIds.size}
      canEdit={canCreate}
      onTag={() => uiDialogs.openBulkTagPrompt()}
      onUntag={() => uiDialogs.openBulkRemoveTagPrompt()}
      onExport={() => void templatesStore.bulkExport(bulkSelectedIds)}
      onDelete={() => (uiDialogs.bulkDeleteConfirmOpen = true)}
    />
  </div>

  {#snippet templateRow(hit: SearchHit, indent: boolean = false)}
    <li class:in-folder={indent} role="presentation">
      <TemplateRow
        {hit}
        selected={selectedTemplateId === hit.template.id}
        bulkSelected={bulkSelectedIds.has(hit.template.id) && bulkSelectedIds.size > 1}
        draggable={canReorder}
        dragging={drag.draggingId === hit.template.id}
        dragOverTop={drag.dragOverId === hit.template.id && drag.dragOverHalf === "top"}
        dragOverBottom={drag.dragOverId === hit.template.id && drag.dragOverHalf === "bottom"}
        onSelect={(m) => browseSession.selectTemplate(hit.template.id, m)}
        onContext={(e) => handleTemplateContext(e, hit.template.id)}
        onDragStart={(e) => drag.handleDragStart(e, hit.template.id)}
        onDragOver={(e) => drag.handleDragOver(e, hit.template.id)}
        onDragLeave={() => drag.handleDragLeave(hit.template.id)}
        onDrop={(e) => drag.handleDrop(e, hit.template.id)}
        onDragEnd={handleDragEnd}
      />
    </li>
  {/snippet}

  {#if searchResults.length === 0}
    <ul class="template-list">
      {#if templates.length === 0}
        <li class="empty first-run">
          No templates yet{canCreate ? " — hit + to create one" : ""}.
        </li>
      {:else}
        <li class="empty no-matches">
          <span>No matches</span>
          <button class="clear-filters-btn" onclick={() => browseSession.clearFilters()}>Clear search & filters</button>
        </li>
      {/if}
    </ul>
  {:else if hasFolders}
    <GroupedTemplateList
      groups={groupedSearchResults}
      {collapsedFolders}
      {dragOverFolder}
      onToggleFolder={toggleFolder}
      onFolderDragOver={handleFolderDragOver}
      onFolderDragLeave={() => (dragOverFolder = null)}
      onFolderDrop={handleFolderDrop}
      {templateRow}
    />
  {:else}
    <ul class="template-list" role="listbox" aria-label="Templates">
      {#each searchResults as hit (hit.template.id)}
        {@render templateRow(hit)}
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 0 8px 12px;
    overflow-y: auto;
    box-sizing: border-box;
  }

  .sidebar.flex-grow {
    flex: 1 1 0;
    min-width: 0;
  }

  .sticky-header {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--bg-elevated);
    padding-top: 12px;
  }

  .section-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-right: 4px;
    margin: 0 0 4px;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-subtle);
    padding: 0 6px;
    margin: 0;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .new-btn,
  .sort-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }

  .new-btn {
    width: 22px;
    padding: 0;
    font-size: 0.9rem;
  }

  .sort-btn {
    padding: 0 8px;
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .new-btn:hover,
  .sort-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
    color: var(--text);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .template-list li {
    margin: 0;
  }

  .template-list li.in-folder {
    padding-left: 12px;
  }

  .empty {
    color: var(--text-subtle);
    font-size: 0.8rem;
    padding: 4px 6px;
    font-style: italic;
  }

  .empty.first-run {
    line-height: 1.4;
    padding: 8px 8px;
  }

  .empty.no-matches {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
  }

  .clear-filters-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-style: normal;
    font-size: 0.72rem;
  }

  .clear-filters-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
    color: var(--text);
  }
</style>
