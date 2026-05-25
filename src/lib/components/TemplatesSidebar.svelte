<script lang="ts">
  import type { Template, SortMode } from "$lib/types";
  import type { Ranking } from "$lib/api";
  import { highlightName, type SearchHit } from "$lib/search";

  export type SelectModifier = "none" | "ctrl" | "shift";

  let {
    templates,
    searchResults,
    selectedTemplateId,
    bulkSelectedIds,
    searchQuery,
    rankings,
    rankLoading,
    rankError,
    pasteThreshold,
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
    onSortModeToggle,
  }: {
    templates: Template[];
    searchResults: SearchHit[];
    selectedTemplateId: string | null;
    bulkSelectedIds: Set<string>;
    searchQuery: string;
    rankings: Ranking[] | null;
    rankLoading: boolean;
    rankError: string | null;
    pasteThreshold: number;
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
    onSortModeToggle: () => void;
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

  function modifierOf(e: MouseEvent): SelectModifier {
    if (e.shiftKey) return "shift";
    if (e.ctrlKey || e.metaKey) return "ctrl";
    return "none";
  }

  const templateById = $derived.by(() => {
    const map = new Map<string, Template>();
    for (const t of templates) map.set(t.id, t);
    return map;
  });

  const inPasteMode = $derived(searchQuery.trim().length >= pasteThreshold);

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

  // Drag state. We track only the dragged id and the current hover target;
  // the actual reorder fires on drop.
  let draggingId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  let dragOverHalf = $state<"top" | "bottom">("top");

  function handleDragStart(e: DragEvent, id: string): void {
    if (!canReorder) return;
    draggingId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // Required for Firefox to actually start the drag.
      e.dataTransfer.setData("text/plain", id);
    }
  }

  function handleDragOver(e: DragEvent, overId: string): void {
    if (!canReorder || draggingId === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOverHalf = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
    dragOverId = overId;
  }

  function handleDragLeave(overId: string): void {
    if (dragOverId === overId) dragOverId = null;
  }

  function handleDrop(e: DragEvent, overId: string): void {
    if (!canReorder || draggingId === null) return;
    e.preventDefault();
    const fromId = draggingId;
    const half = dragOverHalf;
    draggingId = null;
    dragOverId = null;
    if (fromId === overId) return;
    const ids = templates.map((t) => t.id);
    const fromIdx = ids.indexOf(fromId);
    if (fromIdx < 0) return;
    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(overId);
    if (toIdx < 0) return;
    if (half === "bottom") toIdx += 1;
    ids.splice(toIdx, 0, fromId);
    onReorder(ids);
  }

  function handleDragEnd(): void {
    draggingId = null;
    dragOverId = null;
  }
</script>

<aside bind:this={sidebarEl} class="sidebar" style="width: {width}px" oncontextmenu={handleEmptyContext}>
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
              : "Sorted by lifetime copy count. Click → manual."}
          onclick={onSortModeToggle}
        >{sortMode === "manual" ? "⇅" : sortMode === "recent" ? "↻" : "★"}</button>
      {/if}
      {#if canCreate}
        <button class="new-btn" title="New template" onclick={onNew}>+</button>
      {/if}
    </div>
  </div>

  {#if bulkSelectedIds.size > 1}
    <div class="bulk-bar">
      <span class="bulk-count">{bulkSelectedIds.size} selected</span>
      <span class="bulk-hint">right-click for actions</span>
    </div>
  {/if}

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
            {@const trimmed = tpl.body.trim()}
            <li>
              <button
                class="template-item"
                class:active={selectedTemplateId === tpl.id}
                data-id={tpl.id}
                onclick={(e) => onTemplateSelect(tpl.id, modifierOf(e))}
                oncontextmenu={(e) => handleTemplateContext(e, tpl.id)}
              >
                <span class="name">{tpl.name}</span>
                {#if trimmed.length > 0}
                  <span class="excerpt">{trimmed.slice(0, 100)}{trimmed.length > 100 ? '…' : ''}</span>
                {/if}
              </button>
            </li>
          {/if}
        {/each}
      {:else}
        <li class="status">…</li>
      {/if}
    </ul>
  {:else}
    {#snippet templateRow(hit: SearchHit)}
      <li>
        <button
          class="template-item"
          class:active={selectedTemplateId === hit.template.id}
          class:bulk={bulkSelectedIds.has(hit.template.id) && bulkSelectedIds.size > 1}
          class:pinned={hit.template.pinned}
          class:dragging={draggingId === hit.template.id}
          class:drag-over-top={dragOverId === hit.template.id && dragOverHalf === "top"}
          class:drag-over-bottom={dragOverId === hit.template.id && dragOverHalf === "bottom"}
          data-id={hit.template.id}
          draggable={canReorder}
          ondragstart={(e) => handleDragStart(e, hit.template.id)}
          ondragover={(e) => handleDragOver(e, hit.template.id)}
          ondragleave={() => handleDragLeave(hit.template.id)}
          ondrop={(e) => handleDrop(e, hit.template.id)}
          ondragend={handleDragEnd}
          onclick={(e) => onTemplateSelect(hit.template.id, modifierOf(e))}
          oncontextmenu={(e) => handleTemplateContext(e, hit.template.id)}
        >
          <span class="name">
            {#if hit.template.pinned}
              <span class="pin-mark" aria-label="pinned" title="Pinned">▸</span>
            {/if}
            {#each highlightName(hit.template.name, hit.nameHits) as seg}
              {#if seg.hit}
                <span class="hit">{seg.text}</span>
              {:else}
                {seg.text}
              {/if}
            {/each}
          </span>
          {#if hit.nameHits.length === 0 && hit.bodyHit}
            <span class="excerpt">
              {#each hit.bodyHit.segments as seg}{#if seg.hit}<span class="hit">{seg.text}</span>{:else}{seg.text}{/if}{/each}
            </span>
          {/if}
        </button>
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
          <li class="folder-header">
            <button
              class="folder-toggle"
              onclick={() => toggleFolder(label)}
              title={collapsed ? "Expand" : "Collapse"}
            >
              <span class="folder-chevron">{collapsed ? "▸" : "▾"}</span>
              <span class="folder-name">{label}</span>
              <span class="folder-count">{group.hits.length}</span>
            </button>
          </li>
          {#if !collapsed}
            {#each group.hits as hit (hit.template.id)}
              {@render templateRow(hit)}
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
    padding: 12px 8px;
    overflow-y: auto;
    box-sizing: border-box;
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
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
    line-height: 1;
    padding: 0;
  }

  .new-btn:hover,
  .sort-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .bulk-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px;
    margin: 0 2px 6px;
    background: var(--accent-info-bg);
    border: 1px solid var(--accent-info-border);
    border-radius: 4px;
    font-size: 0.72rem;
    color: var(--accent-info-text);
  }

  .bulk-count {
    font-weight: 600;
  }

  .bulk-hint {
    font-style: italic;
    opacity: 0.8;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .template-list li {
    margin: 0;
  }

  .folder-header {
    margin-top: 4px;
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

  .template-item {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    position: relative;
  }

  .template-item:hover {
    background: var(--bg-hover);
  }

  .template-item.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }

  .template-item.bulk {
    box-shadow: inset 3px 0 0 var(--accent-info-border);
  }

  .template-item.dragging {
    opacity: 0.4;
  }

  .template-item.drag-over-top::before,
  .template-item.drag-over-bottom::after {
    content: "";
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    background: var(--accent-info-border);
    border-radius: 1px;
  }

  .template-item.drag-over-top::before {
    top: -1px;
  }

  .template-item.drag-over-bottom::after {
    bottom: -1px;
  }

  .template-item .name {
    display: block;
  }

  .pin-mark {
    display: inline-block;
    margin-right: 4px;
    color: var(--accent-positive-text);
    font-size: 0.7rem;
    transform: translateY(-1px);
  }

  .template-item .excerpt {
    display: block;
    margin-top: 2px;
    font-size: 0.72rem;
    color: var(--text-deemphasis);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .template-item .hit {
    background: var(--accent-warning-bg);
    color: var(--accent-warning-strong);
    border-radius: 2px;
    padding: 0 1px;
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
