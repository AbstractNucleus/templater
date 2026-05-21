<script lang="ts">
  import type { Template } from "$lib/types";

  let {
    templates,
    selectedTagIds,
    excludedTagIds,
    tagCombinator,
    width,
    onTagToggle,
    onTagExclude,
    onTagsClear,
    onCombinatorToggle,
    onContextEmpty,
  }: {
    templates: Template[];
    selectedTagIds: Set<string>;
    excludedTagIds: Set<string>;
    tagCombinator: "and" | "or";
    width: number;
    onTagToggle: (tag: string) => void;
    onTagExclude: (tag: string) => void;
    onTagsClear: () => void;
    onCombinatorToggle: () => void;
    onContextEmpty: (x: number, y: number) => void;
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
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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
      <li>
        <button
          class="tag"
          class:active={selectedTagIds.has(tag)}
          class:excluded={excludedTagIds.has(tag)}
          onclick={() => handleTagClick(tag)}
          oncontextmenu={(e) => handleTagContext(e, tag)}
        >
          <span class="tag-name">{tag}</span>
          <span class="tag-count">{count}</span>
        </button>
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

  .empty {
    color: var(--text-subtle);
    font-size: 0.78rem;
    padding: 6px 8px;
    font-style: italic;
    line-height: 1.4;
  }
</style>
