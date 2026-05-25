<script lang="ts">
  let {
    tagCounts,
    renamingTag = $bindable(),
    confirmingDeleteTag = $bindable(),
    onRenameTag,
    onDeleteTag,
  }: {
    tagCounts: [string, number][];
    /** Bound to the parent: parent's Escape handler reads + clears it. */
    renamingTag: string | null;
    /** Bound to the parent: parent's Escape handler reads + clears it. */
    confirmingDeleteTag: string | null;
    onRenameTag: (from: string, to: string) => Promise<void>;
    onDeleteTag: (tag: string) => Promise<void>;
  } = $props();

  let renameDraft = $state("");
  let tagBusy = $state(false);
  let tagError = $state<string | null>(null);

  function startRename(tag: string): void {
    renamingTag = tag;
    renameDraft = tag;
    tagError = null;
  }

  function cancelRename(): void {
    renamingTag = null;
    renameDraft = "";
  }

  async function commitRename(): Promise<void> {
    if (!renamingTag) return;
    const from = renamingTag;
    const to = renameDraft.trim();
    if (to.length === 0 || to === from) {
      cancelRename();
      return;
    }
    tagBusy = true;
    tagError = null;
    try {
      await onRenameTag(from, to);
      cancelRename();
    } catch (e) {
      tagError = String(e);
    } finally {
      tagBusy = false;
    }
  }

  async function commitDelete(tag: string): Promise<void> {
    tagBusy = true;
    tagError = null;
    try {
      await onDeleteTag(tag);
      confirmingDeleteTag = null;
    } catch (e) {
      tagError = String(e);
    } finally {
      tagBusy = false;
    }
  }
</script>

<section>
  <div class="section-label">Tags</div>
  {#if tagCounts.length === 0}
    <div class="hint">No tags yet.</div>
  {:else}
    <ul class="tag-manage-list">
      {#each tagCounts as [tag, count] (tag)}
        <li class="tag-manage-row">
          {#if renamingTag === tag}
            <input
              class="tag-rename-input"
              type="text"
              bind:value={renameDraft}
              disabled={tagBusy}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void commitRename();
                } else if (e.key === "Escape") {
                  // stopPropagation so the modal-level Escape handler
                  // doesn't see renamingTag=null after this clears it
                  // and close the whole modal.
                  e.preventDefault();
                  e.stopPropagation();
                  cancelRename();
                }
              }}
            />
            <button class="tag-btn" disabled={tagBusy} onclick={() => void commitRename()}>
              Save
            </button>
            <button class="tag-btn" disabled={tagBusy} onclick={cancelRename}>Cancel</button>
          {:else if confirmingDeleteTag === tag}
            <span class="tag-confirm-text">Remove "{tag}" from {count} template{count === 1 ? "" : "s"}?</span>
            <div class="tag-actions">
              <button class="tag-btn" disabled={tagBusy} onclick={() => (confirmingDeleteTag = null)}>
                Cancel
              </button>
              <!-- svelte-ignore a11y_autofocus -->
              <button
                class="tag-btn danger"
                disabled={tagBusy}
                onclick={() => void commitDelete(tag)}
                autofocus
              >
                {tagBusy ? "Removing…" : "Remove"}
              </button>
            </div>
          {:else}
            <span class="tag-name">{tag}</span>
            <span class="tag-count-tag">{count}</span>
            <div class="tag-actions">
              <button class="tag-btn" disabled={tagBusy} onclick={() => startRename(tag)}>
                Rename
              </button>
              <button
                class="tag-btn danger"
                disabled={tagBusy}
                onclick={() => (confirmingDeleteTag = tag)}
              >
                Remove
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if tagError}
    <div class="capture-error">{tagError}</div>
  {/if}
  <div class="hint">
    Rename moves every occurrence; Remove strips the tag from every template that has it.
    Both go through the undo stack — Ctrl+Z reverts.
  </div>
</section>

<style>
  section {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  section:last-of-type {
    border-bottom: none;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
    margin-bottom: 8px;
  }

  .hint {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .capture-error {
    color: var(--accent-danger-text);
    font-size: 0.78rem;
    margin-top: 6px;
  }

  .tag-manage-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  .tag-manage-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
  }

  .tag-manage-row:last-child {
    border-bottom: none;
  }

  .tag-manage-row .tag-name {
    flex: 1;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag-confirm-text {
    flex: 1;
    color: var(--accent-warning-text);
    font-size: 0.78rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-manage-row .tag-count-tag {
    color: var(--text-subtle);
    font-size: 0.74rem;
    min-width: 28px;
    text-align: right;
  }

  .tag-actions {
    display: flex;
    gap: 4px;
  }

  .tag-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.72rem;
  }

  .tag-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .tag-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .tag-btn.danger {
    color: var(--accent-danger-text);
    border-color: var(--accent-danger-border);
  }

  .tag-btn.danger:hover:not(:disabled) {
    background: var(--accent-danger-bg);
  }

  .tag-rename-input {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 2px 8px;
    border-radius: 3px;
    font: inherit;
    font-size: 0.78rem;
  }

  .tag-rename-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }
</style>
