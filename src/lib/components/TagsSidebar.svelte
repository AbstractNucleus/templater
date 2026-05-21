<script lang="ts">
  import type { Template } from "$lib/types";

  let {
    templates,
    selectedTagIds,
    width,
    onTagToggle,
    onContextEmpty,
  }: {
    templates: Template[];
    selectedTagIds: Set<string>;
    width: number;
    onTagToggle: (tag: string, additive: boolean) => void;
    onContextEmpty: (x: number, y: number) => void;
  } = $props();

  function handleContext(e: MouseEvent): void {
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

  function handleTagClick(e: MouseEvent, tag: string) {
    onTagToggle(tag, e.ctrlKey || e.metaKey);
  }
</script>

<aside class="sidebar" style="width: {width}px" oncontextmenu={handleContext}>
  <div class="section-label">Tags</div>
  <ul class="tag-list">
    {#each tagCounts as [tag, count] (tag)}
      <li>
        <button
          class="tag"
          class:active={selectedTagIds.has(tag)}
          onclick={(e) => handleTagClick(e, tag)}
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

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-subtle);
    padding: 0 6px;
    margin: 0 0 4px;
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

  .empty {
    color: var(--text-subtle);
    font-size: 0.78rem;
    padding: 6px 8px;
    font-style: italic;
    line-height: 1.4;
  }
</style>
