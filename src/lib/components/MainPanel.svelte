<script lang="ts">
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import type { Template, TemplateDraft } from "$lib/types";
  import { composeText, splitPlaceholders, extractPlaceholders, applyValues } from "$lib/compose";
  import TemplateForm from "./TemplateForm.svelte";

  type DraftContent = { opening: string; body: string };
  type BodyUpdate = { templateId: string; body: string; seq: number };

  const EMPTY_DRAFT: TemplateDraft = {
    name: "",
    tags: [],
    opening: "",
    body: "",
    folder: null,
    signatureOverride: null,
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

  const effectiveSignature = $derived(
    template?.signature_override !== null && template?.signature_override !== undefined
      ? template.signature_override
      : globalSignature,
  );
  const signatureAvailable = $derived(effectiveSignature.trim().length > 0);

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
        signatureOverride: template.signature_override,
      };
    }
  });

  $effect(() => {
    if (!editing || !template) return;
    onDraftChange({ opening: draft.opening, body: draft.body });
  });

  $effect(() => {
    if (!editing || !template || aiBodyUpdate === null) return;
    if (aiBodyUpdate.templateId !== template.id || aiBodyUpdate.seq === lastAiBodyUpdateSeq) return;
    lastAiBodyUpdateSeq = aiBodyUpdate.seq;
    draft = { ...draft, body: aiBodyUpdate.body };
  });

  let historyOpen = $state(false);
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

  const breadcrumb = $derived.by(() => {
    if (!template) return "";
    const firstTag = template.tags[0] ?? "untagged";
    return `${firstTag} / ${template.name}`;
  });

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
    const sig = draft.signatureOverride !== null && draft.signatureOverride.length > 0
      ? draft.signatureOverride
      : null;
    const folder = draft.folder !== null && draft.folder.trim().length > 0 ? draft.folder.trim() : null;
    onSave({
      ...template,
      name: draft.name.trim() || "Untitled",
      tags: draft.tags,
      opening: draft.opening,
      body: draft.body,
      signature_override: sig,
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
      {canEdit
        ? "Select a template from the sidebar, or create a new one."
        : "Select a template from the sidebar."}
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
      <div>
        <div class="breadcrumb">{breadcrumb}</div>
        <h2 class="name">{template.name}</h2>
        <div class="meta">
          Created {new Date(template.created_at).toLocaleString()}
          · Updated {new Date(template.updated_at).toLocaleString()}
        </div>
      </div>
      {#if canEdit}
        <div class="actions">
          <button class="icon-btn" onclick={onEnterEdit}>Edit</button>
          <button class="icon-btn" onclick={onDuplicate}>Duplicate</button>
          <button class="icon-btn danger" onclick={handleDelete}>Delete</button>
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
              type="text"
              placeholder={`{{${p.key}}}`}
              value={placeholderValues[p.key] ?? ""}
              oninput={(e) => setPlaceholderValue(p.key, e.currentTarget.value)}
            />
          {/if}
        {/each}
      </div>
    {/if}

    {#if canEdit && template.history.length > 0}
      <div class="history">
        <button class="history-toggle" onclick={() => (historyOpen = !historyOpen)}>
          {historyOpen ? "Hide" : "Show"} history ({template.history.length})
        </button>
        {#if historyOpen}
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
      </div>
    {/if}

    {#if adaptError}
      <div class="adapt-error">
        <span class="adapt-error-text">{adaptError}</span>
        <button class="adapt-retry" onclick={onAdaptToInbound} disabled={adaptBusy}>Retry</button>
        <button class="adapt-dismiss" aria-label="Dismiss" onclick={onClearAdaptError}>×</button>
      </div>
    {/if}

    <div class="footer">
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
      <button class="copy" onclick={copyToClipboard}>
        {#if copyState === "ok"}
          Copied
        {:else if copyState === "error"}
          Copy failed
        {:else}
          Copy
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

  .name {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-strong);
  }

  .meta {
    margin-top: 4px;
    font-size: 0.72rem;
    color: var(--text-subtle);
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

  .icon-btn.danger:hover {
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
    padding: 12px 14px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-y: auto;
    min-height: 120px;
  }

  .preview .placeholder {
    color: var(--accent-info-text);
    background: var(--accent-info-bg);
    border-radius: 3px;
    padding: 0 2px;
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
    width: 140px;
    outline: none;
  }

  .placeholder-input::placeholder {
    color: var(--accent-info-text);
    opacity: 0.55;
  }

  .placeholder-input:focus {
    border-color: var(--border-focus);
  }

  .placeholder-select {
    width: auto;
    min-width: 100px;
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

  .history {
    margin: 0 0 12px;
  }

  .history-toggle {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.72rem;
  }

  .history-toggle:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .history-list {
    list-style: none;
    margin: 6px 0 0;
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
    justify-content: flex-end;
    gap: 8px;
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
    background: var(--bg-active);
    color: var(--text);
    border: 1px solid var(--border-strong);
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .copy:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
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
