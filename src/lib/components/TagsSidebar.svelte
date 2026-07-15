<script lang="ts">
  import type { Template } from "$lib/types";
  import { orderedTagCounts } from "$lib/tags";
  import { createDragReorder } from "$lib/dragReorder.svelte";

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

  const tagCounts = $derived(orderedTagCounts(templates, tagOrder));

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

  const drag = createDragReorder({
    enabled: () => true,
    currentIds: () => tagCounts.map(([tag]) => tag),
    onReorder: (next) => onTagReorder(next),
  });
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
          class:dragging={drag.draggingId === tag}
          class:drag-over-top={drag.dragOverId === tag && drag.dragOverHalf === "top"}
          class:drag-over-bottom={drag.dragOverId === tag && drag.dragOverHalf === "bottom"}
          draggable={true}
          ondragstart={(e) => drag.handleDragStart(e, tag)}
          ondragover={(e) => drag.handleDragOver(e, tag)}
          ondragleave={() => drag.handleDragLeave(tag)}
          ondrop={(e) => drag.handleDrop(e, tag)}
          ondragend={drag.handleDragEnd}
          onclick={() => handleTagClick(tag)}
          oncontextmenu={(e) => handleTagContext(e, tag)}
          title="Click to filter · right-click to exclude · drag to reorder"
          aria-pressed={selectedTagIds.has(tag)}
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
    color: var(--text-muted);
    font: inherit;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 7px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
  }

  .combinator:hover,
  .clear:hover {
    background: var(--bg-hover);
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

  /* Slide the count left on hover so the exclude button lands beside it
     instead of covering it. */
  .tag-row:hover .tag-count,
  .tag-row:focus-within .tag-count {
    margin-right: 22px;
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
    transition: margin 100ms ease-out;
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
