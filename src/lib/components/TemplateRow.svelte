<script lang="ts">
  import { highlightName, type SearchHit } from "$lib/search";
  import type { SelectModifier } from "$lib/stores/selectionStore.svelte";

  let {
    hit,
    selected,
    bulkSelected = false,
    draggable = false,
    dragging = false,
    dragOverTop = false,
    dragOverBottom = false,
    onSelect,
    onContext,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
  }: {
    hit: SearchHit;
    selected: boolean;
    bulkSelected?: boolean;
    draggable?: boolean;
    dragging?: boolean;
    dragOverTop?: boolean;
    dragOverBottom?: boolean;
    onSelect: (modifier: SelectModifier) => void;
    onContext: (e: MouseEvent) => void;
    onDragStart?: (e: DragEvent) => void;
    onDragOver?: (e: DragEvent) => void;
    onDragLeave?: () => void;
    onDrop?: (e: DragEvent) => void;
    onDragEnd?: () => void;
  } = $props();

  function modifierOf(e: MouseEvent): SelectModifier {
    if (e.shiftKey) return "shift";
    if (e.ctrlKey || e.metaKey) return "ctrl";
    return "none";
  }
</script>

<button
  class="template-item"
  class:active={selected}
  class:bulk={bulkSelected}
  class:pinned={hit.template.pinned}
  class:dragging
  class:drag-over-top={dragOverTop}
  class:drag-over-bottom={dragOverBottom}
  data-id={hit.template.id}
  role="option"
  aria-selected={selected}
  {draggable}
  ondragstart={onDragStart}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  ondragend={onDragEnd}
  onclick={(e) => onSelect(modifierOf(e))}
  oncontextmenu={onContext}
>
  <span class="name">
    {#if hit.template.pinned}
      <svg class="pin-mark" viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-label="pinned" role="img"><title>Pinned</title>
        <path d="M12 17v5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" fill="none" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      </svg>
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

<style>
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
    color: var(--accent-brand);
    vertical-align: -1px;
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
</style>
