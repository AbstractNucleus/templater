<script lang="ts">
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import type { Template, TemplateDraft } from "$lib/types";
  import { composeText, splitPlaceholders, extractPlaceholders, applyValues } from "$lib/compose";
  import TemplateForm from "./TemplateForm.svelte";

  type DraftContent = { opening: string; body: string };
  /** `templateId` is null in the create-new-template flow (no template yet);
   *  in edit mode it's the edited template's id so a stale signal from a
   *  prior selection can be rejected. */
  type BodyUpdate = { templateId: string | null; body: string; seq: number };

  const EMPTY_DRAFT: TemplateDraft = {
    name: "",
    tags: [],
    opening: "",
    body: "",
    folder: null,
  };

  let {
    template,
    includeOpening,
    includeSignature,
    editing,
    globalSignature,
    snippets,
    canEdit,
    availableTags,
    availableFolders,
    copyTrigger,
    savedPlaceholderValues,
    inboundText,
    adaptBusy,
    adaptError,
    creatingDraft = null,
    onToggleOpening,
    onToggleSignature,
    onEnterEdit,
    onCancelEdit,
    onSave,
    onCreate = () => {},
    onDuplicate,
    onDelete,
    onBaseOnTemplate,
    onAdaptToInbound,
    onClearAdaptError,
    onCopySuccess,
    onPlaceholderValuesChange,
    onRevertHistory,
    aiBodyUpdate = null,
    onDraftChange = () => {},
  }: {
    template: Template | null;
    includeOpening: boolean;
    includeSignature: boolean;
    editing: boolean;
    globalSignature: string;
    snippets: Record<string, string>;
    canEdit: boolean;
    availableTags: string[];
    availableFolders: string[];
    copyTrigger: number;
    /** Persisted per-template fill-ins. Outer key: template id. */
    savedPlaceholderValues: Record<string, Record<string, string>>;
    /** The pasted inbound message in paste-match mode. null/empty disables Adapt. */
    inboundText: string | null;
    /** True while an adapt-to-inbound request is in flight. */
    adaptBusy: boolean;
    /** Last adapt-to-inbound error message. Null when no error or after retry. */
    adaptError: string | null;
    /** When non-null, the panel renders the new-template form seeded from this
     *  draft (instead of an existing template). Parent must hold a stable
     *  reference for the form's lifetime. */
    creatingDraft?: TemplateDraft | null;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onEnterEdit: () => void;
    onCancelEdit: () => void;
    onSave: (t: Template) => void;
    onCreate?: (draft: TemplateDraft) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onBaseOnTemplate: () => void;
    onAdaptToInbound: () => void;
    onClearAdaptError: () => void;
    onCopySuccess: (templateId: string) => void;
    onPlaceholderValuesChange: (templateId: string, values: Record<string, string>) => void;
    onRevertHistory: (templateId: string, versionIdx: number) => void;
    aiBodyUpdate?: BodyUpdate | null;
    onDraftChange?: (draft: DraftContent) => void;
  } = $props();

  const signatureAvailable = $derived(globalSignature.trim().length > 0);

  let copyState = $state<"idle" | "ok" | "error">("idle");
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  // Draft state — used by both edit and create flows.
  let draft = $state<TemplateDraft>({ ...EMPTY_DRAFT });
  let lastAiBodyUpdateSeq = $state(0);

  // Seed draft whenever we enter edit/create mode or switch templates.
  // Reference identity on `template` and `creatingDraft` keeps this stable
  // during ongoing edits — the effect only refires when the parent swaps
  // the source.
  $effect(() => {
    if (creatingDraft) {
      draft = { ...creatingDraft };
      return;
    }
    if (editing && template) {
      draft = {
        name: template.name,
        tags: [...template.tags],
        opening: template.opening,
        body: template.body,
        folder: template.folder,
      };
    }
  });

  $effect(() => {
    if (!creatingDraft && (!editing || !template)) return;
    onDraftChange({ opening: draft.opening, body: draft.body });
  });

  $effect(() => {
    if (aiBodyUpdate === null) return;
    if (creatingDraft) {
      if (aiBodyUpdate.seq === lastAiBodyUpdateSeq) return;
      lastAiBodyUpdateSeq = aiBodyUpdate.seq;
      draft = { ...draft, body: aiBodyUpdate.body };
      return;
    }
    if (!editing || !template) return;
    if (aiBodyUpdate.templateId !== template.id || aiBodyUpdate.seq === lastAiBodyUpdateSeq) return;
    lastAiBodyUpdateSeq = aiBodyUpdate.seq;
    draft = { ...draft, body: aiBodyUpdate.body };
  });

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
  const composedFilled = $derived(applyValues(composed, placeholderValues, new Date(), snippets));

  const previewSegments = $derived(
    template ? splitPlaceholders(composed, placeholderValues, new Date(), snippets) : [],
  );
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

  type HistoryDiff = { field: string; before: string; after: string };

  function formatTags(tags: string[]): string {
    return tags.length > 0 ? tags.join(", ") : "(none)";
  }

  function historyDiff(current: Template, prior: Template["history"][number]): HistoryDiff[] {
    const changes: HistoryDiff[] = [];
    if (prior.tags.join("\0") !== current.tags.join("\0")) {
      changes.push({ field: "Tags", before: formatTags(prior.tags), after: formatTags(current.tags) });
    }
    if (prior.opening !== current.opening) {
      changes.push({ field: "Opening", before: prior.opening || "(empty)", after: current.opening || "(empty)" });
    }
    if (prior.body !== current.body) {
      changes.push({ field: "Body", before: prior.body || "(empty)", after: current.body || "(empty)" });
    }
    return changes;
  }

  async function copyToClipboard(): Promise<void> {
    if (!template) return;
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

  function handleSave(): void {
    if (!template) return;
    const folder = draft.folder !== null && draft.folder.trim().length > 0 ? draft.folder.trim() : null;
    onSave({
      ...template,
      name: draft.name.trim() || "Untitled",
      tags: draft.tags,
      opening: draft.opening,
      body: draft.body,
      folder,
      updated_at: new Date().toISOString(),
    });
  }

  function handleCreate(): void {
    onCreate(draft);
  }

  function handleFormSubmit(): void {
    if (creatingDraft) handleCreate();
    else handleSave();
  }

  function handleFormKey(e: KeyboardEvent): void {
    if (!canEdit) return;
    if (!creatingDraft && !editing) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleFormSubmit();
    } else if (e.key === "Escape" && creatingDraft) {
      // Mirrors the old SaveAsModal cancel-on-Escape. Pickers stopPropagation
      // when their dropdown is open, so this only fires from "outside" focus.
      e.preventDefault();
      onCancelEdit();
    }
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

  function handleConfirmKey(e: KeyboardEvent): void {
    if (!confirmingDelete) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cancelDelete();
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirmDelete();
    }
  }
</script>

<svelte:window onkeydown={(e) => { handleConfirmKey(e); handleFormKey(e); }} />

<section class="main">
  {#if !template && !creatingDraft}
    <div class="empty">
      <p class="empty-line">
        {canEdit
          ? "Select a template from the sidebar, or create a new one."
          : "Select a template from the sidebar."}
      </p>
      <div class="empty-kbd-row">
        <span><kbd>↑</kbd><kbd>↓</kbd> pick</span>
        <span class="empty-sep">·</span>
        <span><kbd>⏎</kbd> copy</span>
        <span class="empty-sep">·</span>
        <span><kbd>?</kbd> all shortcuts</span>
      </div>
    </div>
  {:else if canEdit && (creatingDraft || editing)}
    <div class="header-row">
      <div class="breadcrumb">{creatingDraft ? "new template" : "editing"}</div>
      <div class="actions">
        <button class="icon-btn" onclick={onCancelEdit}>Cancel</button>
        <button class="icon-btn primary" onclick={handleFormSubmit}>Save</button>
      </div>
    </div>

    <TemplateForm
      value={draft}
      {availableTags}
      {availableFolders}
      bodyGrow
      autofocusName={!!creatingDraft}
      onChange={(next) => (draft = next)}
    />
  {:else if template}
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

    {#if placeholders.length > 0}
      <div class="placeholders">
        <span class="placeholders-label">Fill</span>
        {#each placeholders as p (p.key)}
          {#if p.kind.type === "choice"}
            <select
              class="placeholder-input placeholder-select"
              class:filled={(placeholderValues[p.key] ?? "") !== ""}
              value={placeholderValues[p.key] ?? ""}
              onchange={(e) => setPlaceholderValue(p.key, e.currentTarget.value)}
              title={p.label}
            >
              <option value="">{`{{${p.key}}}`}</option>
              {#each p.kind.options as opt}
                <option value={opt}>{opt}</option>
              {/each}
            </select>
          {:else}
            <input
              class="placeholder-input"
              class:filled={(placeholderValues[p.key] ?? "") !== ""}
              type="text"
              placeholder={`{{${p.key}}}`}
              value={placeholderValues[p.key] ?? ""}
              oninput={(e) => setPlaceholderValue(p.key, e.currentTarget.value)}
            />
          {/if}
        {/each}
      </div>
    {/if}

    {#if canEdit && template.history.length > 0 && historyOpen}
      <ul class="history-list">
        {#each [...template.history].reverse() as v, idx (v.saved_at + idx)}
          {@const realIdx = template.history.length - 1 - idx}
          {@const changes = historyDiff(template, v)}
          <li class="history-row">
            <div class="history-meta">
              <span class="history-time">{new Date(v.saved_at).toLocaleString()}</span>
              <button
                class="history-revert"
                onclick={() => onRevertHistory(template.id, realIdx)}
              >Revert</button>
            </div>
            {#if changes.length === 0}
              <div class="history-empty">No visible diff.</div>
            {:else}
              <div class="history-diff">
                {#each changes as change (change.field)}
                  <div class="history-diff-field">{change.field}</div>
                  <pre class="history-diff-line removed">- {change.before}</pre>
                  <pre class="history-diff-line added">+ {change.after}</pre>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
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
      <button class="base-btn" onclick={onBaseOnTemplate} title="Open this template in the agent editor">
        Base on template
      </button>
      <button class="copy" class:ok={copyState === "ok"} class:err={copyState === "error"} onclick={copyToClipboard}>
        {#if copyState === "ok"}
          <span class="copy-label">Copied</span>
        {:else if copyState === "error"}
          <span class="copy-label">Copy failed</span>
        {:else}
          <span class="copy-label">Copy</span>
          <kbd class="copy-kbd">⏎</kbd>
        {/if}
      </button>
    </div>
  {/if}
</section>

{#if confirmingDelete && template}
  <div
    class="confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-title"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && cancelDelete()}
    onkeydown={() => {}}
  >
    <div class="confirm-modal">
      <h3 id="confirm-title">Delete template?</h3>
      <p class="confirm-name">"{template.name}"</p>
      <p class="confirm-warn">Ctrl+Z will restore it.</p>
      <div class="confirm-actions">
        <button class="confirm-btn" onclick={cancelDelete}>Cancel</button>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="confirm-btn danger" onclick={confirmDelete} autofocus>Delete</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
    overflow-y: auto;
    background: var(--bg-base);
    box-sizing: border-box;
  }

  .empty {
    color: var(--text-placeholder);
    font-size: 0.9rem;
    margin: auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
  }

  .empty-line {
    margin: 0;
  }

  .empty-kbd-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.78rem;
    color: var(--text-subtle);
  }

  .empty-kbd-row kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 18px;
    padding: 0 5px;
    margin-right: 3px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    background: var(--bg-elevated);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.7rem;
    color: var(--text-muted);
    line-height: 1;
  }

  .empty-sep {
    color: var(--text-subtle);
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
  }

  .breadcrumb {
    color: var(--text-deemphasis);
    font-size: 0.78rem;
    margin-bottom: 4px;
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
    color: var(--text-subtle);
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .icon-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .icon-btn.primary {
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .icon-btn.primary:hover {
    background: var(--accent-positive-hover);
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
    accent-color: var(--text-muted);
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

  .placeholders {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0 0 12px;
  }

  .placeholders-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
  }

  .placeholder-input {
    background: var(--accent-info-bg);
    color: var(--accent-info-text);
    border: 1px solid var(--accent-info-border);
    padding: 1px 7px;
    border-radius: 10px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.72rem;
    field-sizing: content;
    min-width: 4ch;
    max-width: 32ch;
    outline: none;
  }

  .placeholder-input.filled {
    background: var(--bg-input);
    color: var(--text);
    border-color: var(--border);
  }

  .placeholder-input::placeholder {
    color: var(--accent-info-text);
    opacity: 0.55;
  }

  .placeholder-input:focus {
    border-color: var(--border-focus);
  }

  .placeholder-select {
    min-width: 6ch;
    padding-right: 18px;
    appearance: none;
    background-image: linear-gradient(
      45deg,
      transparent 50%,
      var(--accent-info-text) 50%
    ),
    linear-gradient(
      135deg,
      var(--accent-info-text) 50%,
      transparent 50%
    );
    background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
  }

  .placeholder-select.filled {
    background-image: linear-gradient(
      45deg,
      transparent 50%,
      var(--text-muted) 50%
    ),
    linear-gradient(
      135deg,
      var(--text-muted) 50%,
      transparent 50%
    );
    background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
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

  .history-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  .history-row {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .history-row:last-child {
    border-bottom: none;
  }

  .history-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .history-time {
    font-size: 0.72rem;
    color: var(--text-subtle);
  }

  .history-revert {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 1px 8px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
  }

  .history-revert:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .history-empty {
    color: var(--text-subtle);
    font-size: 0.74rem;
  }

  .history-diff {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .history-diff-field {
    color: var(--text-subtle);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .history-diff-line {
    margin: 0;
    padding: 6px 8px;
    background: var(--bg-input);
    border-radius: 3px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
    line-height: 1.4;
    color: var(--text-muted);
    white-space: pre-wrap;
    max-height: 90px;
    overflow-y: auto;
  }

  .history-diff-line.removed {
    border-left: 2px solid var(--accent-danger-border);
  }

  .history-diff-line.added {
    border-left: 2px solid var(--accent-positive-border);
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

  .copy {
    background: var(--accent-brand);
    color: #fff;
    border: 1px solid var(--accent-brand);
    padding: 7px 14px 7px 16px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.18);
    transition: background 120ms, transform 80ms;
  }

  .copy:hover {
    background: var(--accent-brand-hover);
    border-color: var(--accent-brand-hover);
  }

  .copy:active {
    transform: translateY(1px);
  }

  .copy.ok {
    background: var(--accent-positive-border);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
    animation: copy-success 380ms ease-out;
  }

  @keyframes copy-success {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 0 var(--accent-positive-border);
    }
    35% {
      transform: scale(1.035);
      box-shadow: 0 0 0 4px rgba(136, 200, 150, 0.35);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.18);
    }
  }

  .copy.err {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .copy-kbd {
    font-family: inherit;
    font-size: 0.72rem;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.92);
  }

  .confirm-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .confirm-modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 22px;
    width: 360px;
    max-width: calc(100vw - 48px);
    color: var(--text);
    box-shadow: 0 8px 32px var(--shadow);
  }

  .confirm-modal h3 {
    margin: 0 0 8px;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .confirm-name {
    margin: 0 0 4px;
    font-size: 0.85rem;
    color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    word-break: break-word;
  }

  .confirm-warn {
    margin: 0 0 18px;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .confirm-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .confirm-btn.danger {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .confirm-btn.danger:hover {
    background: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }
</style>
