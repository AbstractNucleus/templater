<script lang="ts">
  import { listen, emit } from "@tauri-apps/api/event";
  import type { Template } from "$lib/types";
  import TemplatePreview from "$lib/components/TemplatePreview.svelte";
  import { matchesAccelerator } from "$lib/keyboard";

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
    previewHotkey: string;
  }

  let payload = $state<PreviewPayload | null>(null);
  /** Bumped on each payload so TemplatePreview re-seeds fills from the store. */
  let valuesRevision = $state(0);

  let includeOpening = $state(true);
  let includeSignature = $state(true);

  $effect(() => {
    if (payload && typeof document !== "undefined") {
      document.documentElement.dataset.theme = payload.theme;
    }
  });

  $effect(() => {
    const unlisten = listen<PreviewPayload>("preview-payload", (e) => {
      payload = e.payload;
      valuesRevision += 1;
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
  const savedPlaceholderValues = $derived(
    template && payload
      ? { [template.id]: payload.placeholderValues }
      : ({} as Record<string, Record<string, string>>),
  );

  function handlePlaceholderChange(
    templateId: string,
    values: Record<string, string>,
  ): void {
    void emit("preview-placeholder-change", { templateId, values });
  }

  function handleCopySuccess(templateId: string): void {
    void emit("preview-copy-success", { templateId });
    // Hide the pop-out — the copy is done, no reason to linger. The main
    // window owns the hide() call via its preview-request-close listener.
    void emit("preview-request-close");
  }

  // Bare Space closes the pop-out — mirrors the main window's Space→toggle
  // shortcut. Without this, opening the pop-out grabs focus and leaves the
  // user stranded (Space in the main window no longer fires). Gated on no
  // input being focused so the placeholder/checkbox fields keep working.
  function isInputFocused(): boolean {
    const ae = document.activeElement;
    if (!ae || ae === document.body) return false;
    const tag = ae.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if ((ae as HTMLElement).isContentEditable) return true;
    return false;
  }

  function handlePreviewKeydown(e: KeyboardEvent): void {
    if (
      !isInputFocused() &&
      payload &&
      matchesAccelerator(e, payload.previewHotkey)
    ) {
      e.preventDefault();
      void emit("preview-request-close");
    }
  }
</script>

<svelte:window onkeydown={handlePreviewKeydown} />

{#if template}
  <div class="frame">
    <header class="titlebar" data-tauri-drag-region>
      <span class="name" data-tauri-drag-region>{template.name}</span>
      <span class="drag-spacer" data-tauri-drag-region></span>
    </header>

    <div class="body">
      <TemplatePreview
        {template}
        {includeOpening}
        {includeSignature}
        {globalSignature}
        {snippets}
        {savedPlaceholderValues}
        {valuesRevision}
        onToggleOpening={(v) => (includeOpening = v)}
        onToggleSignature={(v) => (includeSignature = v)}
        onCopySuccess={handleCopySuccess}
        onPlaceholderValuesChange={handlePlaceholderChange}
      />
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
</style>
