<script lang="ts">
  import type { Snippet } from "svelte";
  import type { SearchHit } from "$lib/search";
  import type { TemplateGroup } from "$lib/browse";

  let {
    groups,
    collapsedFolders,
    dragOverFolder,
    onToggleFolder,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
    templateRow,
  }: {
    groups: TemplateGroup[];
    collapsedFolders: Set<string>;
    dragOverFolder: string | null;
    onToggleFolder: (label: string) => void;
    onFolderDragOver: (e: DragEvent, folder: string | null) => void;
    onFolderDragLeave: () => void;
    onFolderDrop: (e: DragEvent, folder: string | null) => void;
    templateRow: Snippet<[SearchHit, boolean]>;
  } = $props();
</script>

<ul class="template-list" role="listbox" aria-label="Templates">
  {#each groups as group (group.folder ?? "__ungrouped__")}
    {@const label = group.folder ?? "Ungrouped"}
    {@const collapsed = collapsedFolders.has(label)}
    <li
      class="folder-header"
      role="presentation"
      class:drag-over={dragOverFolder === (group.folder ?? "__ungrouped__")}
      ondragover={(e) => onFolderDragOver(e, group.folder)}
      ondragleave={onFolderDragLeave}
      ondrop={(e) => onFolderDrop(e, group.folder)}
    >
      <button
        class="folder-toggle"
        onclick={() => onToggleFolder(label)}
        title={collapsed
          ? "Expand, or drop templates here to move them"
          : "Collapse, or drop templates here to move them"}
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

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
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
</style>
