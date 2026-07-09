<script lang="ts">
  import type { Template, SortMode } from "$lib/types";
  import type { Ranking } from "$lib/api";
  import type { SearchHit } from "$lib/search";
  import { createDragReorder } from "$lib/dragReorder.svelte";
  import TemplateRow from "./TemplateRow.svelte";

  export type SelectModifier = "none" | "ctrl" | "shift";

  let {
    templates,
    searchResults,
    selectedTemplateId,
    bulkSelectedIds,
    inPasteMode,
    rankings,
    rankLoading,
    rankError,
    width,
    canCreate,
    canReorder,
    sortMode,
    onTemplateSelect,
    onNew,
    onRetryRank,
    onContextTemplate,
    onContextEmpty,
    onReorder,
    onMoveToFolder,
    onSortModeToggle,
    onBulkAddTag,
    onBulkRemoveTag,
    onBulkExport,
    onBulkDelete,
  }: {
    templates: Template[];
    searchResults: SearchHit[];
    selectedTemplateId: string | null;
    bulkSelectedIds: Set<string>;
    /** True when the page is in AI paste-match mode — the list shows ranked
     *  matches instead of literal search results. Computed by the parent so
     *  the AI master switch gates it in one place. */
    inPasteMode: boolean;
    rankings: Ranking[] | null;
    rankLoading: boolean;
    rankError: string | null;
    width: number;
    canCreate: boolean;
    /** True only when the visible order matches the underlying array order
     *  (browse mode, no search, no tag filter, manual sort). Drag is gated
     *  on this so the user can't reorder a filtered view ambiguously. */
    canReorder: boolean;
    sortMode: SortMode;
    onTemplateSelect: (id: string, modifier: SelectModifier) => void;
    onNew: () => void;
    onRetryRank: () => void;
    onContextTemplate: (id: string, x: number, y: number) => void;
    onContextEmpty: (x: number, y: number) => void;
    onReorder: (newOrderIds: string[]) => void;
    onMoveToFolder: (ids: Set<string>, folder: string | null) => void;
    onSortModeToggle: () => void;
    onBulkAddTag: () => void;
    onBulkRemoveTag: () => void;
    onBulkExport: () => void;
    onBulkDelete: () => void;
  } = $props();

  function handleEmptyContext(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    onContextEmpty(e.clientX, e.clientY);
  }

  function handleTemplateContext(e: MouseEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    onContextTemplate(id, e.clientX, e.clientY);
  }

  const templateById = $derived.by(() => {
    const map = new Map<string, Template>();
    for (const t of templates) map.set(t.id, t);
    return map;
  });

  // True when at least one template carries a folder. Groups render only when
  // the catalog uses folders — otherwise it's a flat list, just like before.
  const hasFolders = $derived(templates.some((t) => t.folder !== null));

  // Per-folder collapse state. The null key is the "ungrouped" bucket. Empty
  // set = everything expanded; touched names persist within the session.
  let collapsedFolders = $state<Set<string>>(new Set());

  function toggleFolder(name: string): void {
    const next = new Set(collapsedFolders);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    collapsedFolders = next;
  }

  // Ordered (folder | null, hits) groups, preserving the first-seen order of
  // each folder within `searchResults`. Pinned-sort logic is upstream — by the
  // time hits land here they're already in the order the user wanted.
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

  // Keep the active row visible when arrow-key navigation moves selection
  // off-screen. `block: "nearest"` avoids reflowing if it's already visible.
  $effect(() => {
    if (!selectedTemplateId || !sidebarEl) return;
    const btn = sidebarEl.querySelector(
      `[data-id="${CSS.escape(selectedTemplateId)}"]`,
    ) as HTMLElement | null;
    btn?.scrollIntoView({ block: "nearest" });
  });

  // Drag-to-reorder. The shared helper tracks the dragged id, hover target,
  // and hover half; the reorder fires on drop. Gated on `canReorder` so a
  // filtered view can't be reordered ambiguously.
  const drag = createDragReorder({
    enabled: () => canReorder,
    currentIds: () => templates.map((t) => t.id),
    onReorder: (ids) => onReorder(ids),
  });

  // Folder drop state lives outside the shared helper — it's specific to the
  // Templates sidebar's grouped view.
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
    onMoveToFolder(ids, folder);
  }

  function handleDragEnd(): void {
    drag.handleDragEnd();
    dragOverFolder = null;
  }
</script>

<aside bind:this={sidebarEl} class="sidebar" style="width: {width}px" oncontextmenu={handleEmptyContext}>
  <div class="sticky-header">
    <div class="section-row">
      <div class="section-label">
        {inPasteMode ? "Ranked matches" : "Templates"}
      </div>
      <div class="header-controls">
        {#if !inPasteMode}
          <button
            class="sort-btn"
            title={sortMode === "manual"
              ? "Manual order. Drag templates to reorder. Click → recent."
              : sortMode === "recent"
                ? "Sorted by most recently copied. Click → most used."
                : sortMode === "most_used"
                  ? "Sorted by lifetime copy count. Click → never used."
                  : "Sorted by never used first. Click → manual."}
            onclick={onSortModeToggle}
          >{
            sortMode === "manual" ? "Manual ↕"
            : sortMode === "recent" ? "Recent ↓"
            : sortMode === "most_used" ? "Most used ★"
            : "Never used 0"
          }</button>
        {/if}
        {#if canCreate}
          <button class="new-btn" title="New template" onclick={onNew}>+</button>
        {/if}
      </div>
    </div>

    {#if bulkSelectedIds.size > 1}
      <div class="bulk-bar">
        <span class="bulk-count">{bulkSelectedIds.size} selected</span>
        <div class="bulk-actions">
          {#if canCreate}
            <button class="bulk-btn" onclick={onBulkAddTag} title="Add tag to selected">Tag</button>
            <button class="bulk-btn" onclick={onBulkRemoveTag} title="Remove tag from selected">Untag</button>
          {/if}
          <button class="bulk-btn" onclick={onBulkExport} title="Export selected">Export</button>
          {#if canCreate}
            <button class="bulk-btn danger" onclick={onBulkDelete} title="Delete selected">Delete</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if inPasteMode}
    <ul class="template-list">
      {#if rankLoading}
        <li class="status">Ranking via Haiku…</li>
      {:else if rankError}
        <li class="rank-error">
          <div class="error-text">{rankError}</div>
          <button class="retry-btn" onclick={onRetryRank}>Retry</button>
        </li>
      {:else if rankings && rankings.length === 0}
        <li class="empty">No strong matches</li>
      {:else if rankings}
        {#each rankings as r (r.template_id)}
          {@const tpl = templateById.get(r.template_id)}
          {#if tpl}
            {@const rankedHit = { template: tpl, score: 0, matchedWords: 0, nameHits: [], tagHits: [], bodyHit: null } satisfies SearchHit}
            <li>
              <TemplateRow
                hit={rankedHit}
                selected={selectedTemplateId === tpl.id}
                plainExcerpt={tpl.body.trim()}
                onSelect={(m) => onTemplateSelect(tpl.id, m)}
                onContext={(e) => handleTemplateContext(e, tpl.id)}
              />
            </li>
          {/if}
        {/each}
      {:else}
        <li class="status">…</li>
      {/if}
    </ul>
  {:else}
    {#snippet templateRow(hit: SearchHit, indent: boolean = false)}
      <li class:in-folder={indent}>
        <TemplateRow
          {hit}
          selected={selectedTemplateId === hit.template.id}
          bulkSelected={bulkSelectedIds.has(hit.template.id) && bulkSelectedIds.size > 1}
          draggable={canReorder}
          dragging={drag.draggingId === hit.template.id}
          dragOverTop={drag.dragOverId === hit.template.id && drag.dragOverHalf === "top"}
          dragOverBottom={drag.dragOverId === hit.template.id && drag.dragOverHalf === "bottom"}
          onSelect={(m) => onTemplateSelect(hit.template.id, m)}
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
          <li class="empty">No matches</li>
        {/if}
      </ul>
    {:else if hasFolders}
      <ul class="template-list">
        {#each groupedSearchResults as group (group.folder ?? "__ungrouped__")}
          {@const label = group.folder ?? "Ungrouped"}
          {@const collapsed = collapsedFolders.has(label)}
          <li
            class="folder-header"
            class:drag-over={dragOverFolder === (group.folder ?? "__ungrouped__")}
            ondragover={(e) => handleFolderDragOver(e, group.folder)}
            ondragleave={() => (dragOverFolder = null)}
            ondrop={(e) => handleFolderDrop(e, group.folder)}
          >
            <button
              class="folder-toggle"
              onclick={() => toggleFolder(label)}
              title={collapsed ? "Expand, or drop templates here to move them" : "Collapse, or drop templates here to move them"}
            >
              <span class="folder-chevron">{collapsed ? "▸" : "▾"}</span>
              <span class="folder-name">{label}</span>
              <span class="folder-count">{group.hits.length}</span>
            </button>
          </li>
          {#if !collapsed}
            {#each group.hits as hit (hit.template.id)}
              {@render templateRow(hit, true)}
            {/each}
          {/if}
        {/each}
      </ul>
    {:else}
      <ul class="template-list">
        {#each searchResults as hit (hit.template.id)}
          {@render templateRow(hit)}
        {/each}
      </ul>
    {/if}
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

  .bulk-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 4px 3px 8px;
    margin: 0 2px 6px;
    background: var(--accent-info-bg);
    border: 1px solid var(--accent-info-border);
    border-radius: 4px;
    font-size: 0.72rem;
    color: var(--accent-info-text);
  }

  .bulk-count {
    font-weight: 600;
    flex-shrink: 0;
  }

  .bulk-actions {
    display: flex;
    gap: 2px;
  }

  .bulk-btn {
    background: transparent;
    border: 1px solid transparent;
    color: inherit;
    padding: 2px 7px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    line-height: 1.3;
  }

  .bulk-btn:hover {
    background: var(--accent-info-border);
    color: var(--bg-base);
  }

  .bulk-btn.danger:hover {
    background: var(--accent-danger-border);
    color: var(--bg-base);
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

  .folder-header {
    margin-top: 4px;
  }

  .folder-header.drag-over .folder-toggle {
    background: var(--accent-info-bg);
    color: var(--accent-info-text);
    outline: 1px solid var(--accent-info-border);
  }

  .folder-header:first-child {
    margin-top: 0;
  }

  .folder-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text-deemphasis);
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .folder-toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .folder-chevron {
    width: 10px;
    color: var(--text-subtle);
  }

  .folder-name {
    flex: 1;
  }

  .folder-count {
    color: var(--text-subtle);
    font-size: 0.65rem;
  }

  .empty,
  .status {
    color: var(--text-subtle);
    font-size: 0.8rem;
    padding: 4px 6px;
    font-style: italic;
  }

  .empty.first-run {
    line-height: 1.4;
    padding: 8px 8px;
  }

  .rank-error {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    margin: 4px 0;
    background: var(--rank-error-bg);
    border: 1px solid var(--accent-danger-border);
    border-radius: 4px;
  }

  .error-text {
    color: var(--accent-danger-text);
    font-size: 0.75rem;
    line-height: 1.3;
    word-break: break-word;
  }

  .retry-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--accent-danger-border);
    color: var(--accent-danger-text);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
  }

  .retry-btn:hover {
    background: var(--accent-danger-bg);
  }
</style>
