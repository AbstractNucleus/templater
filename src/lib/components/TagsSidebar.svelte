<script lang="ts">
  import type { Template } from "$lib/types";

  let {
    templates,
    selectedTagIds,
    excludedTagIds,
    tagCombinator,
    tagOrder,
    width,
    onTagToggle,
    onTagExclude,
    onTagsClear,
    onCombinatorToggle,
    onContextEmpty,
    onTagReorder,
  }: {
    templates: Template[];
    selectedTagIds: Set<string>;
    excludedTagIds: Set<string>;
    tagCombinator: "and" | "or";
    /** Persisted order from drag-reorder. Tags not in this list fall back to count-desc. */
    tagOrder: string[];
    width: number;
    onTagToggle: (tag: string) => void;
    onTagExclude: (tag: string) => void;
    onTagsClear: () => void;
    onCombinatorToggle: () => void;
    onContextEmpty: (x: number, y: number) => void;
    onTagReorder: (newOrder: string[]) => void;
  } = $props();

  function handleSidebarContext(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    onContextEmpty(e.clientX, e.clientY);
  }

  const tagCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const t of templates) {
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    // Honor persisted order first, then fall back to count-desc / name-asc.
    const orderIndex = new Map<string, number>();
    tagOrder.forEach((t, i) => orderIndex.set(t, i));
    const all = [...counts.entries()];
    all.sort((a, b) => {
      const ai = orderIndex.get(a[0]);
      const bi = orderIndex.get(b[0]);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    return all;
  });

  const hasAnyFilter = $derived(selectedTagIds.size > 0 || excludedTagIds.size > 0);
  const showCombinator = $derived(selectedTagIds.size >= 2);

  function handleTagClick(tag: string) {
    onTagToggle(tag);
  }

  function handleTagContext(e: MouseEvent, tag: string) {
    e.preventDefault();
    e.stopPropagation();
    onTagExclude(tag);
  }

  let draggingTag = $state<string | null>(null);
  let dragOverTag = $state<string | null>(null);
  let dragOverHalf = $state<"top" | "bottom">("top");

  function handleDragStart(e: DragEvent, tag: string): void {
    draggingTag = tag;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tag);
    }
  }

  function handleDragOver(e: DragEvent, overTag: string): void {
    if (draggingTag === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOverHalf = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
    dragOverTag = overTag;
  }

  function handleDragLeave(overTag: string): void {
    if (dragOverTag === overTag) dragOverTag = null;
  }

  function handleDrop(e: DragEvent, overTag: string): void {
    if (draggingTag === null) return;
    e.preventDefault();
    const fromTag = draggingTag;
    const half = dragOverHalf;
    draggingTag = null;
    dragOverTag = null;
    if (fromTag === overTag) return;
    const visible = tagCounts.map(([tag]) => tag);
    const fromIdx = visible.indexOf(fromTag);
    if (fromIdx < 0) return;
    visible.splice(fromIdx, 1);
    let toIdx = visible.indexOf(overTag);
    if (toIdx < 0) return;
    if (half === "bottom") toIdx += 1;
    visible.splice(toIdx, 0, fromTag);
    onTagReorder(visible);
  }

  function handleDragEnd(): void {
    draggingTag = null;
    dragOverTag = null;
  }
</script>

<aside class="sidebar" style="width: {width}px" oncontextmenu={handleSidebarContext}>
  <div class="header">
    <span class="section-label">Tags</span>
    <div class="header-controls">
      {#if showCombinator}
        <button
          class="combinator"
          title={tagCombinator === "and"
            ? "Matching all selected tags. Click to switch to any."
            : "Matching any selected tag. Click to switch to all."}
          onclick={onCombinatorToggle}
        >
          <span class:on={tagCombinator === "and"}>ALL</span>
          <span class="sep">/</span>
          <span class:on={tagCombinator === "or"}>ANY</span>
        </button>
      {/if}
      {#if hasAnyFilter}
        <button class="clear" title="Clear tag filters" onclick={onTagsClear}>Clear</button>
      {/if}
    </div>
  </div>
  <ul class="tag-list">
    {#each tagCounts as [tag, count] (tag)}
      <li class="tag-row">
        <button
          class="tag"
          class:active={selectedTagIds.has(tag)}
          class:excluded={excludedTagIds.has(tag)}
          class:dragging={draggingTag === tag}
          class:drag-over-top={dragOverTag === tag && dragOverHalf === "top"}
          class:drag-over-bottom={dragOverTag === tag && dragOverHalf === "bottom"}
          draggable={true}
          ondragstart={(e) => handleDragStart(e, tag)}
          ondragover={(e) => handleDragOver(e, tag)}
          ondragleave={() => handleDragLeave(tag)}
          ondrop={(e) => handleDrop(e, tag)}
          ondragend={handleDragEnd}
          onclick={() => handleTagClick(tag)}
          oncontextmenu={(e) => handleTagContext(e, tag)}
        >
          <span class="tag-name">{tag}</span>
          <span class="tag-count">{count}</span>
        </button>
        <button
          class="tag-exclude"
          title={excludedTagIds.has(tag) ? `Un-exclude ${tag}` : `Exclude ${tag}`}
          aria-label={excludedTagIds.has(tag) ? `Un-exclude ${tag}` : `Exclude ${tag}`}
          onclick={(e) => { e.stopPropagation(); onTagExclude(tag); }}
        >−</button>
      </li>
    {:else}
      <li class="empty">Tags will appear here as you add them.</li>
    {/each}
  </ul>
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

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 6px;
    margin: 0 0 4px;
    min-height: 18px;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-subtle);
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .combinator,
  .clear {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-subtle);
    font: inherit;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    line-height: 1.2;
  }

  .combinator:hover,
  .clear:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .combinator .sep {
    margin: 0 3px;
    color: var(--text-subtle);
  }

  .combinator .on {
    color: var(--text-strong);
    font-weight: 600;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tag-list li {
    margin: 0;
  }

  .tag-row {
    position: relative;
  }

  .tag-exclude {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--bg-base);
    border: 1px solid var(--border-strong);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 100ms;
  }

  .tag-row:hover .tag-exclude,
  .tag-row:focus-within .tag-exclude {
    opacity: 1;
    pointer-events: auto;
  }

  .tag-row:hover .tag-count {
    opacity: 0;
  }

  .tag-exclude:hover {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .tag {
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
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
  }

  .tag-count {
    color: var(--text-subtle);
    font-size: 0.75rem;
  }

  .tag:hover {
    background: var(--bg-hover);
  }

  .tag.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }

  .tag.excluded {
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
  }

  .tag.excluded .tag-name {
    text-decoration: line-through;
  }

  .tag.excluded .tag-count {
    color: var(--accent-danger-text);
    opacity: 0.7;
  }

  .tag.dragging {
    opacity: 0.4;
  }

  .tag.drag-over-top::before,
  .tag.drag-over-bottom::after {
    content: "";
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    background: var(--accent-info-border);
    border-radius: 1px;
  }

  .tag.drag-over-top::before {
    top: -1px;
  }

  .tag.drag-over-bottom::after {
    bottom: -1px;
  }

  .empty {
    color: var(--text-subtle);
    font-size: 0.78rem;
    padding: 6px 8px;
    font-style: italic;
    line-height: 1.4;
  }
</style>
