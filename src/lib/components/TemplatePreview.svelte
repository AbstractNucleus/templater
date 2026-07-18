<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import type { Template } from "$lib/types";
  import { composeText, splitPlaceholders, extractPlaceholders } from "$lib/compose";
  import CopyButton from "./CopyButton.svelte";
  import PlaceholderFills from "./PlaceholderFills.svelte";

  /** Debounce for placeholder persist — single source for main view and pop-out. */
  const PERSIST_DEBOUNCE_MS = 400;

  let {
    template,
    includeOpening,
    includeSignature,
    globalSignature,
    snippets,
    savedPlaceholderValues,
    onToggleOpening,
    onToggleSignature,
    onCopySuccess,
    onPlaceholderValuesChange,
    copyTrigger = 0,
    showTags = true,
    showCopyKbd = true,
    valuesRevision,
    afterFills,
    footerLeading,
  }: {
    template: Template;
    includeOpening: boolean;
    includeSignature: boolean;
    globalSignature: string;
    snippets: Record<string, string>;
    /** Persisted per-template fill-ins. Outer key: template id. */
    savedPlaceholderValues: Record<string, Record<string, string>>;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onCopySuccess: (templateId: string) => void;
    onPlaceholderValuesChange: (templateId: string, values: Record<string, string>) => void;
    /** Bump from parent to run the same copy flow as the Copy button. */
    copyTrigger?: number;
    showTags?: boolean;
    showCopyKbd?: boolean;
    /** Bump to re-seed fills from `savedPlaceholderValues` without changing
     *  template id (preview pop-out re-pushes payload). Defaults to template id
     *  so the main view only reloads on selection change. */
    valuesRevision?: string | number;
    afterFills?: Snippet;
    footerLeading?: Snippet;
  } = $props();

  const signatureAvailable = $derived(globalSignature.trim().length > 0);

  let copyState = $state<"idle" | "ok" | "error">("idle");
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  // Per-template fill-in values. Loaded from the persisted map on template
  // switch (or valuesRevision bump) and written back on edit via a debounced
  // callback — values survive across template switches AND app restarts.
  let placeholderValues = $state<Record<string, string>>({});
  let lastTemplateId: string | null = null;
  let lastRevision: string | number | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const id = template?.id ?? null;
    const rev = valuesRevision ?? id;
    if (id !== lastTemplateId || rev !== lastRevision) {
      // Flush any pending writes for the previous template before swapping.
      if (id !== lastTemplateId && persistTimer && lastTemplateId !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
        onPlaceholderValuesChange(lastTemplateId, placeholderValues);
      }
      lastTemplateId = id;
      lastRevision = rev;
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
    composeText(template, includeOpening, includeSignature, globalSignature),
  );
  const previewSegments = $derived(
    splitPlaceholders(composed, placeholderValues, new Date(), snippets),
  );
  // The copied text is exactly the preview with each segment flattened — one
  // parse and one `now`, so the clipboard output can't drift from what's shown.
  const composedFilled = $derived(previewSegments.map((s) => s.text).join(""));
  const placeholders = $derived(extractPlaceholders(composed, snippets));

  async function copyToClipboard(): Promise<void> {
    if (composedFilled.trim().length === 0) return;
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
  // Copy button — keeps the "Copied"/"Copy failed" feedback shared.
  //
  // Copy ONLY when the counter actually increments. The effect must not pick
  // up any other dependency: copyToClipboard reads `template` and
  // `composedFilled` synchronously, and recordCopy replaces the template
  // object after every copy — tracked, that re-fires the effect and copies
  // forever. `untrack` keeps the dep set to {copyTrigger}; the equality guard
  // ignores spurious re-runs (e.g. sibling fields of the parent's spread
  // props changing); seeding from the current value makes remounts inert.
  let lastCopyTrigger = untrack(() => copyTrigger);
  $effect(() => {
    const t = copyTrigger;
    if (t === lastCopyTrigger) return;
    lastCopyTrigger = t;
    untrack(() => void copyToClipboard());
  });
</script>

{#if showTags && template.tags.length > 0}
  <div class="tag-chips">
    {#each template.tags as t (t)}
      <span class="tag-chip">{t}</span>
    {/each}
  </div>
{/if}

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

{@render afterFills?.()}

<div class="footer">
  {@render footerLeading?.()}
  <div class="footer-spacer"></div>
  <CopyButton
    {copyState}
    showKbd={showCopyKbd}
    disabled={composedFilled.trim().length === 0}
    onclick={() => void copyToClipboard()}
  />
</div>

<style>
  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
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

  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .footer-spacer {
    flex: 1;
  }
</style>
