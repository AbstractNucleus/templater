<script lang="ts">
  import type { Template } from "$lib/types";
  import type { Ranking } from "$lib/api";
  import { highlightName, type SearchHit } from "$lib/search";

  let {
    templates,
    searchResults,
    selectedTemplateId,
    searchQuery,
    rankings,
    rankLoading,
    rankError,
    pasteThreshold,
    width,
    canCreate,
    onTemplateSelect,
    onNew,
    onRetryRank,
    onContextTemplate,
    onContextEmpty,
  }: {
    templates: Template[];
    searchResults: SearchHit[];
    selectedTemplateId: string | null;
    searchQuery: string;
    rankings: Ranking[] | null;
    rankLoading: boolean;
    rankError: string | null;
    pasteThreshold: number;
    width: number;
    canCreate: boolean;
    onTemplateSelect: (id: string) => void;
    onNew: () => void;
    onRetryRank: () => void;
    onContextTemplate: (id: string, x: number, y: number) => void;
    onContextEmpty: (x: number, y: number) => void;
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

  const inPasteMode = $derived(searchQuery.trim().length >= pasteThreshold);

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
</script>

<aside bind:this={sidebarEl} class="sidebar" style="width: {width}px" oncontextmenu={handleEmptyContext}>
  <div class="section-row">
    <div class="section-label">
      {inPasteMode ? "Ranked matches" : "Templates"}
    </div>
    {#if canCreate}
      <button class="new-btn" title="New template" onclick={onNew}>+</button>
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
            <li>
              <button
                class="template-item"
                class:active={selectedTemplateId === tpl.id}
                data-id={tpl.id}
                onclick={() => onTemplateSelect(tpl.id)}
                oncontextmenu={(e) => handleTemplateContext(e, tpl.id)}
              >
                {tpl.name}
              </button>
            </li>
          {/if}
        {/each}
      {:else}
        <li class="status">…</li>
      {/if}
    </ul>
  {:else}
    <ul class="template-list">
      {#each searchResults as hit (hit.template.id)}
        <li>
          <button
            class="template-item"
            class:active={selectedTemplateId === hit.template.id}
            data-id={hit.template.id}
            onclick={() => onTemplateSelect(hit.template.id)}
            oncontextmenu={(e) => handleTemplateContext(e, hit.template.id)}
          >
            <span class="name">
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
      {:else}
        {#if templates.length === 0}
          <li class="empty first-run">
            No templates yet{canCreate ? " — hit + to create one" : ""}.
          </li>
        {:else}
          <li class="empty">No matches</li>
        {/if}
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

  .new-btn {
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

  .new-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .template-list li {
    margin: 0;
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
  }

  .template-item:hover {
    background: var(--bg-hover);
  }

  .template-item.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }

  .template-item .name {
    display: block;
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
