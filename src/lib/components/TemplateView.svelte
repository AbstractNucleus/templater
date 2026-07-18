<script lang="ts">
  import type { Template } from "$lib/types";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import TemplatePreview from "./TemplatePreview.svelte";

  let {
    template,
    includeOpening,
    includeSignature,
    globalSignature,
    snippets,
    canEdit,
    copyTrigger,
    savedPlaceholderValues,
    onToggleOpening,
    onToggleSignature,
    onEnterEdit,
    onSave,
    onDuplicate,
    onDelete,
    onCopySuccess,
    onPlaceholderValuesChange,
    onRevertHistory,
  }: {
    template: Template;
    includeOpening: boolean;
    includeSignature: boolean;
    globalSignature: string;
    snippets: Record<string, string>;
    canEdit: boolean;
    copyTrigger: number;
    /** Persisted per-template fill-ins. Outer key: template id. */
    savedPlaceholderValues: Record<string, Record<string, string>>;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onEnterEdit: () => void;
    onSave: (t: Template) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onCopySuccess: (templateId: string) => void;
    onPlaceholderValuesChange: (templateId: string, values: Record<string, string>) => void;
    onRevertHistory: (templateId: string, versionIdx: number) => void;
  } = $props();

  let historyOpen = $state(false);

  let renamingTitle = $state(false);
  let renameDraft = $state("");

  function startRename(): void {
    if (!template || !canEdit) return;
    renameDraft = template.name;
    renamingTitle = true;
  }

  function commitRename(): void {
    if (!template) {
      renamingTitle = false;
      return;
    }
    const trimmed = renameDraft.trim();
    if (trimmed.length > 0 && trimmed !== template.name) {
      onSave({
        ...template,
        name: trimmed,
        updated_at: new Date().toISOString(),
      });
    }
    renamingTitle = false;
  }

  function cancelRename(): void {
    renamingTitle = false;
  }

  function handleRenameKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  // Svelte action: focus + select on mount, used by the inline-rename input.
  function focusOnMount(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
  // Close the history panel when the template changes so it never claims to
  // show one template's history while another is selected.
  $effect(() => {
    void template?.id;
    historyOpen = false;
  });

  function compactDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  }

  let confirmingDelete = $state(false);

  function handleDelete(): void {
    if (!template) return;
    confirmingDelete = true;
  }

  function confirmDelete(): void {
    confirmingDelete = false;
    onDelete();
  }

  function cancelDelete(): void {
    confirmingDelete = false;
  }
</script>

<div class="header-row">
  <div class="title-block">
    {#if template.tags.length > 0}
      <div class="tag-chips">
        {#each template.tags as t (t)}
          <span class="tag-chip">{t}</span>
        {/each}
      </div>
    {/if}
    <div class="title-row">
      {#if renamingTitle}
        <input
          class="name-input"
          type="text"
          bind:value={renameDraft}
          onblur={commitRename}
          onkeydown={handleRenameKey}
          use:focusOnMount
        />
      {:else}
        <h2 class="name">{template.name}</h2>
        {#if canEdit}
          <button
            class="name-edit-btn"
            onclick={startRename}
            title="Rename template"
            aria-label="Rename template"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        {/if}
        <span
          class="meta"
          title={`Created ${new Date(template.created_at).toLocaleString()} · Updated ${new Date(template.updated_at).toLocaleString()}`}
        >
          Created {compactDate(template.created_at)} · Updated {compactDate(template.updated_at)}
        </span>
      {/if}
    </div>
  </div>
  {#if canEdit}
    <div class="actions">
      <button class="icon-action" onclick={onEnterEdit} title="Edit (or click the body to inline-edit)" aria-label="Edit template">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
      <button class="icon-action" onclick={onDuplicate} title="Duplicate" aria-label="Duplicate template">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button class="icon-action danger" onclick={handleDelete} title="Delete" aria-label="Delete template">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </div>
  {/if}
</div>

<TemplatePreview
  {template}
  {includeOpening}
  {includeSignature}
  {globalSignature}
  {snippets}
  {savedPlaceholderValues}
  {onToggleOpening}
  {onToggleSignature}
  {onCopySuccess}
  {onPlaceholderValuesChange}
  {copyTrigger}
  showTags={false}
>
  {#snippet afterFills()}
    {#if canEdit}
      <HistoryPanel {template} open={historyOpen} {onRevertHistory} />
    {/if}
  {/snippet}
  {#snippet footerLeading()}
    {#if canEdit && template.history.length > 0}
      <button
        class="history-toggle"
        onclick={() => (historyOpen = !historyOpen)}
        title={historyOpen ? "Collapse history" : "Show previous saved versions"}
      >
        {historyOpen ? "Hide" : "Show"} history ({template.history.length})
      </button>
    {/if}
  {/snippet}
</TemplatePreview>

{#if confirmingDelete && template}
  <ConfirmDialog
    title="Delete template?"
    name={template.name}
    message="Ctrl+Z will restore it."
    confirmLabel="Delete"
    danger
    onConfirm={confirmDelete}
    onCancel={cancelDelete}
  />
{/if}

<style>
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
  }

  .title-block {
    min-width: 0;
    flex: 1 1 auto;
  }

  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .tag-chip {
    font-size: 0.68rem;
    line-height: 1;
    padding: 3px 7px;
    border-radius: 999px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
  }

  .name {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--text-strong);
    min-width: 0;
  }

  .name-edit-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 100ms;
  }

  .title-row:hover .name-edit-btn,
  .title-row:focus-within .name-edit-btn {
    opacity: 1;
  }

  .name-edit-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .name-input {
    flex: 1;
    min-width: 0;
    background: var(--bg-input);
    border: 1px solid var(--accent-brand);
    border-radius: 4px;
    color: var(--text-strong);
    font: inherit;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    padding: 2px 8px;
    outline: none;
  }

  .meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .icon-action {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-action:hover {
    background: var(--bg-hover);
    border-color: var(--border);
    color: var(--text);
  }

  .icon-action.danger:hover {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .history-toggle {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
  }

  .history-toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
