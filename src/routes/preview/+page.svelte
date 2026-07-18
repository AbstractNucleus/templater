<script lang="ts">
  import { listen, emit } from "@tauri-apps/api/event";
  import TemplatePreview from "$lib/components/TemplatePreview.svelte";
  import { matchesAccelerator } from "$lib/keyboard";
  import { isInputFocused } from "$lib/domFocus";
  import type { PreviewPayload } from "$lib/stores/popouts.svelte";

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
