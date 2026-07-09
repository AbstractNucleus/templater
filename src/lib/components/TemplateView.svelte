<script lang="ts">
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import type { Template } from "$lib/types";
  import { composeText, splitPlaceholders, extractPlaceholders } from "$lib/compose";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CopyButton from "./CopyButton.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import PlaceholderFills from "./PlaceholderFills.svelte";

  let {
    template,
    includeOpening,
    includeSignature,
    globalSignature,
    snippets,
    canEdit,
    copyTrigger,
    savedPlaceholderValues,
    inboundText,
    adaptBusy,
    adaptError,
    onToggleOpening,
    onToggleSignature,
    onEnterEdit,
    onSave,
    onDuplicate,
    onDelete,
    onBaseOnTemplate,
    onAdaptToInbound,
    onClearAdaptError,
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
    /** The pasted inbound message in paste-match mode. null/empty disables Adapt. */
    inboundText: string | null;
    /** True while an adapt-to-inbound request is in flight. */
    adaptBusy: boolean;
    /** Last adapt-to-inbound error message. Null when no error or after retry. */
    adaptError: string | null;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onEnterEdit: () => void;
    onSave: (t: Template) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onBaseOnTemplate: () => void;
    onAdaptToInbound: () => void;
    onClearAdaptError: () => void;
    onCopySuccess: (templateId: string) => void;
    onPlaceholderValuesChange: (templateId: string, values: Record<string, string>) => void;
    onRevertHistory: (templateId: string, versionIdx: number) => void;
  } = $props();

  const signatureAvailable = $derived(globalSignature.trim().length > 0);

  let copyState = $state<"idle" | "ok" | "error">("idle");
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Per-template fill-in values. Loaded from the persisted map on template
  // switch and written back on edit via a debounced callback — values
  // survive across template switches AND app restarts.
  let placeholderValues = $state<Record<string, string>>({});
  let lastTemplateId: string | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const PERSIST_DEBOUNCE_MS = 400;

  $effect(() => {
    const id = template?.id ?? null;
    if (id !== lastTemplateId) {
      // Flush any pending writes for the previous template before swapping.
      if (persistTimer && lastTemplateId !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
        onPlaceholderValuesChange(lastTemplateId, placeholderValues);
      }
      lastTemplateId = id;
      placeholderValues = id ? { ...(savedPlaceholderValues[id] ?? {}) } : {};
    }
  });

  function setPlaceholderValue(key: string, value: string): void {
    placeholderValues = { ...placeholderValues, [key]: value };
    if (persistTimer) clearTimeout(persistTimer);
    const id = template?.id;
    if (!id) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      onPlaceholderValuesChange(id, placeholderValues);
    }, PERSIST_DEBOUNCE_MS);
  }

  const composed = $derived(
    template ? composeText(template, includeOpening, includeSignature, globalSignature) : "",
  );
  const previewSegments = $derived(
    template ? splitPlaceholders(composed, placeholderValues, new Date(), snippets) : [],
  );
  // The copied text is exactly the preview with each segment flattened — one
  // parse and one `now`, so the clipboard output can't drift from what's shown.
  const composedFilled = $derived(previewSegments.map((s) => s.text).join(""));
  const placeholders = $derived(template ? extractPlaceholders(composed, snippets) : []);
  const canAdapt = $derived(inboundText != null && inboundText.trim().length > 0);

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

  async function copyToClipboard(): Promise<void> {
    if (!template || composedFilled.trim().length === 0) return;
    const id = template.id;
    try {
      await writeText(composedFilled);
      copyState = "ok";
      // Flush any pending debounced placeholder write so a copy-then-close
      // doesn't lose the fill-ins the user just typed.
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        onPlaceholderValuesChange(id, placeholderValues);
      }
      onCopySuccess(id);
    } catch {
      copyState = "error";
    }
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = "idle"), 1500);
  }

  // Bumping `copyTrigger` from the parent runs the same copy flow as the
  // Copy button — keeps the "Copied"/"Copy failed" feedback shared. Skips the
  // mount run so the initial render doesn't fire a stray copy.
  let skipInitialCopy = true;
  $effect(() => {
    // Read so the effect tracks the prop.
    void copyTrigger;
    if (skipInitialCopy) {
      skipInitialCopy = false;
      return;
    }
    void copyToClipboard();
  });

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

<div class="toggles">
  <label class:disabled={template.opening.trim().length === 0}>
    <input
      type="checkbox"
      checked={includeOpening}
      disabled={template.opening.trim().length === 0}
      onchange={(e) => onToggleOpening(e.currentTarget.checked)}
    />
    Include opening
  </label>
  <label class:disabled={!signatureAvailable}>
    <input
      type="checkbox"
      checked={includeSignature}
      disabled={!signatureAvailable}
      onchange={(e) => onToggleSignature(e.currentTarget.checked)}
    />
    Include signature
  </label>
</div>

<pre class="preview">{#each previewSegments as seg}{#if seg.placeholder}<span class="placeholder">{seg.text}</span>{:else}{seg.text}{/if}{/each}</pre>

<PlaceholderFills {placeholders} values={placeholderValues} onSetValue={setPlaceholderValue} />

{#if canEdit}
  <HistoryPanel {template} open={historyOpen} {onRevertHistory} />
{/if}

{#if adaptError}
  <div class="adapt-error">
    <span class="adapt-error-text">{adaptError}</span>
    <button class="adapt-retry" onclick={onAdaptToInbound} disabled={adaptBusy}>Retry</button>
    <button class="adapt-dismiss" aria-label="Dismiss" onclick={onClearAdaptError}>×</button>
  </div>
{/if}

<div class="footer">
  {#if canEdit && template.history.length > 0}
    <button
      class="history-toggle"
      onclick={() => (historyOpen = !historyOpen)}
      title={historyOpen ? "Collapse history" : "Show previous saved versions"}
    >
      {historyOpen ? "Hide" : "Show"} history ({template.history.length})
    </button>
  {/if}
  <div class="footer-spacer"></div>
  {#if canAdapt}
    <button
      class="base-btn"
      onclick={onAdaptToInbound}
      disabled={adaptBusy}
      title="Adapt this draft to fit the pasted inbound message (uses Sonnet)"
    >
      {adaptBusy ? "Adapting…" : "Adapt to inbound"}
    </button>
  {/if}
  <button class="base-btn" onclick={onBaseOnTemplate} title="Start a new draft based on this template">
    Base on template
  </button>
  <CopyButton
    {copyState}
    showKbd
    disabled={composedFilled.trim().length === 0}
    onclick={() => void copyToClipboard()}
  />
</div>

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

  .toggles {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 0.85rem;
    color: var(--text);
  }

  .toggles label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .toggles label.disabled {
    color: var(--text-placeholder);
    cursor: default;
  }

  .toggles input[type="checkbox"] {
    accent-color: var(--accent-brand);
  }

  .preview {
    flex: 1;
    margin: 0 0 16px;
    padding: 18px 20px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: -apple-system, "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
    font-size: 0.9rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-y: auto;
    min-height: 120px;
  }

  .preview .placeholder {
    color: var(--accent-info-text);
    background: var(--accent-info-bg);
    border-radius: 3px;
    padding: 0 3px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.82em;
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

  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .footer-spacer {
    flex: 1;
  }

  .adapt-error {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--accent-danger-bg);
    border: 1px solid var(--accent-danger-border);
    color: var(--accent-danger-text);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.78rem;
    margin-bottom: 8px;
    animation: banner-in 140ms ease-out;
  }

  @keyframes banner-in {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .adapt-error-text {
    flex: 1;
    min-width: 0;
  }

  .adapt-retry,
  .adapt-dismiss {
    background: transparent;
    border: 1px solid var(--accent-danger-border);
    color: var(--accent-danger-text);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    padding: 2px 10px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .adapt-retry:hover:not(:disabled),
  .adapt-dismiss:hover {
    background: var(--accent-danger-border);
    color: var(--bg-base);
  }

  .adapt-retry:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .adapt-dismiss {
    padding: 2px 8px;
    font-size: 1rem;
    line-height: 1;
  }

  .base-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .base-btn:hover {
    background: var(--accent-info-bg);
    border-color: var(--accent-info-border);
    color: var(--accent-info-text);
  }

</style>
