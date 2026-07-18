<script lang="ts">
  let {
    count,
    canEdit,
    onTag,
    onUntag,
    onExport,
    onDelete,
  }: {
    count: number;
    canEdit: boolean;
    onTag: () => void;
    onUntag: () => void;
    onExport: () => void;
    onDelete: () => void;
  } = $props();
</script>

{#if count > 1}
  <div class="bulk-bar">
    <span class="bulk-count">{count} selected</span>
    <div class="bulk-actions">
      {#if canEdit}
        <button class="bulk-btn" onclick={onTag} title="Add tag to selected">Tag</button>
        <button class="bulk-btn" onclick={onUntag} title="Remove tag from selected">Untag</button>
      {/if}
      <button class="bulk-btn" onclick={onExport} title="Export selected">Export</button>
      {#if canEdit}
        <button class="bulk-btn danger" onclick={onDelete} title="Delete selected">Delete</button>
      {/if}
    </div>
  </div>
{/if}

<style>
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
    animation: bulk-in 120ms ease-out;
  }

  @keyframes bulk-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
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
</style>
