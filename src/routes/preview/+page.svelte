<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { emit } from "@tauri-apps/api/event";
  import type { Template, Settings } from "$lib/types";
  import { composeText, splitPlaceholders, extractPlaceholders } from "$lib/compose";
  import CopyButton from "$lib/components/CopyButton.svelte";
  import PlaceholderFills from "$lib/components/PlaceholderFills.svelte";

  /** Payload pushed from the main window whenever the selection or relevant
   *  settings change. The pop-out renders directly from this; it owns no
   *  template state of its own. */
  interface PreviewPayload {
    template: Template | null;
    globalSignature: string;
    snippets: Record<string, string>;
    placeholderValues: Record<string, string>;
    canEdit: boolean;
    theme: "dark" | "light";
  }

  let payload = $state<PreviewPayload | null>(null);

  let includeOpening = $state(true);
  let includeSignature = $state(true);

  let placeholderValues = $state<Record<string, string>>({});

  let copyState = $state<"idle" | "ok" | "error">("idle");
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  // Persisted-fill debounce back to the main window so its store stays the
  // source of truth for cross-session survival.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const PERSIST_DEBOUNCE_MS = 400;

  $effect(() => {
    if (payload && typeof document !== "undefined") {
      document.documentElement.dataset.theme = payload.theme;
    }
  });

  $effect(() => {
    const unlisten = listen<PreviewPayload>("preview-payload", (e) => {
      payload = e.payload;
      if (payload) {
        placeholderValues = { ...payload.placeholderValues };
      }
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  // Ask the main window for the current selection as soon as we mount. It
  // responds by emitting preview-payload (handled above).
  $effect(() => {
    void emit("preview-request-payload");
  });

  const template = $derived(payload?.template ?? null);
  const globalSignature = $derived(payload?.globalSignature ?? "");
  const snippets = $derived(payload?.snippets ?? {});

  const composed = $derived(
    template ? composeText(template, includeOpening, includeSignature, globalSignature) : "",
  );
  const previewSegments = $derived(
    template ? splitPlaceholders(composed, placeholderValues, new Date(), snippets) : [],
  );
  const composedFilled = $derived(previewSegments.map((s) => s.text).join(""));
  const placeholders = $derived(template ? extractPlaceholders(composed, snippets) : []);
  const signatureAvailable = $derived(globalSignature.trim().length > 0);

  function setPlaceholderValue(key: string, value: string): void {
    placeholderValues = { ...placeholderValues, [key]: value };
    if (persistTimer) clearTimeout(persistTimer);
    const id = template?.id;
    if (!id) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void emit("preview-placeholder-change", { templateId: id, values: placeholderValues });
    }, PERSIST_DEBOUNCE_MS);
  }

  async function copyToClipboard(): Promise<void> {
    if (!template || composedFilled.trim().length === 0) return;
    const id = template.id;
    try {
      await writeText(composedFilled);
      copyState = "ok";
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        void emit("preview-placeholder-change", { templateId: id, values: placeholderValues });
      }
      void emit("preview-copy-success", { templateId: id });
    } catch {
      copyState = "error";
    }
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = "idle"), 1500);
  }
</script>

<svelte:window />

{#if template}
  <div class="frame">
    <header class="titlebar" data-tauri-drag-region>
      <span class="name" data-tauri-drag-region>{template.name}</span>
      <span class="drag-spacer" data-tauri-drag-region></span>
    </header>

    <div class="body">
      {#if template.tags.length > 0}
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
            onchange={(e) => (includeOpening = e.currentTarget.checked)}
          />
          Include opening
        </label>
        <label class:disabled={!signatureAvailable}>
          <input
            type="checkbox"
            checked={includeSignature}
            disabled={!signatureAvailable}
            onchange={(e) => (includeSignature = e.currentTarget.checked)}
          />
          Include signature
        </label>
      </div>

      <pre class="preview">{#each previewSegments as seg}{#if seg.placeholder}<span class="placeholder">{seg.text}</span>{:else}{seg.text}{/if}{/each}</pre>

      <PlaceholderFills {placeholders} values={placeholderValues} onSetValue={setPlaceholderValue} />

      <div class="footer">
        <div class="footer-spacer"></div>
        <CopyButton
          {copyState}
          showKbd
          disabled={composedFilled.trim().length === 0}
          onclick={() => void copyToClipboard()}
        />
      </div>
    </div>
  </div>
{:else}
  <div class="frame">
    <div class="empty">Select a template to preview.</div>
  </div>
{/if}

<style>
  :global(html) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: transparent;
    color: var(--text);
    font-family: Inter, system-ui, sans-serif;
    overflow: hidden;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    height: 100vh;
    background: transparent;
    overflow: hidden;
  }

  :global(#svelte) {
    height: 100%;
  }

  :global(:root) {
    --bg-base: #1c1c1e;
    --bg-elevated: #18181a;
    --bg-titlebar: #141416;
    --bg-input: #121214;
    --bg-hover: #25252a;
    --bg-active: #2d2d33;
    --border: #2a2a2e;
    --border-strong: #3a3a40;
    --border-focus: #5a5a62;
    --text: #e8e6e3;
    --text-strong: #f3f1ee;
    --text-muted: #8c8a86;
    --text-subtle: #6a6862;
    --text-placeholder: #56544f;
    --shadow: rgba(0, 0, 0, 0.6);
    --accent-brand: #cc785c;
    --accent-brand-hover: #d88a6f;
    --accent-brand-soft: #3a2419;
    --accent-brand-text: #f5d4c4;
    --accent-positive-bg: #2a3a2a;
    --accent-positive-border: #3a5a3a;
    --accent-positive-text: #d0e0d0;
    --accent-danger-bg: #3a2222;
    --accent-danger-border: #5a3030;
    --accent-danger-text: #ff9a9a;
    --accent-info-bg: #1a2a3a;
    --accent-info-border: #2a4a6a;
    --accent-info-text: #a8c8e8;
  }

  :global([data-theme="light"]) {
    --bg-base: #f7f5f1;
    --bg-elevated: #f1ede6;
    --bg-titlebar: #ebe7df;
    --bg-input: #fdfcf9;
    --bg-hover: #e4dfd5;
    --bg-active: #d8d2c5;
    --border: #ddd6c8;
    --border-strong: #c2bbac;
    --border-focus: #8a8275;
    --text: #2a2724;
    --text-strong: #161310;
    --text-muted: #5c5852;
    --text-subtle: #8c8780;
    --text-placeholder: #b0aa9e;
    --shadow: rgba(60, 50, 35, 0.18);
    --accent-brand: #c5613e;
    --accent-brand-hover: #b4542f;
    --accent-brand-soft: #f5e0d4;
    --accent-brand-text: #6d2c14;
    --accent-positive-bg: #d4eada;
    --accent-positive-border: #88c896;
    --accent-positive-text: #1e5f2e;
    --accent-danger-bg: #fbe2e2;
    --accent-danger-border: #e0a0a0;
    --accent-danger-text: #9a2a2a;
    --accent-info-bg: #dde8f4;
    --accent-info-border: #a0b8d0;
    --accent-info-text: #2a4a6a;
  }

  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 24px var(--shadow), 0 0 0 1px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .name {
    color: var(--text-strong);
    font-size: 0.85rem;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drag-spacer {
    flex: 1;
    align-self: stretch;
    min-width: 8px;
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 18px;
    overflow-y: auto;
  }

  .empty {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: auto;
    text-align: center;
  }

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
    margin-bottom: 10px;
    font-size: 0.82rem;
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
    margin: 0 0 14px;
    padding: 16px 18px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: -apple-system, "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
    font-size: 0.9rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-y: auto;
    min-height: 100px;
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
