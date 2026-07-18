<script lang="ts">
  import { listen, emit } from "@tauri-apps/api/event";
  import TemplatePreview from "$lib/components/TemplatePreview.svelte";
  import PopoutFrame from "$lib/components/PopoutFrame.svelte";
  import { matchesAccelerator } from "$lib/keyboard";
  import { isInputFocused } from "$lib/domFocus";
  import type { PreviewPayload } from "$lib/stores/popouts.svelte";

  let payload = $state<PreviewPayload | null>(null);

  let includeOpening = $state(true);
  let includeSignature = $state(true);

  $effect(() => {
    if (payload && typeof document !== "undefined") {
      document.documentElement.dataset.theme = payload.theme;
    }
  });

  // Update payload for theme/compose/selection — do NOT force-reset fills.
  // TemplatePreview re-seeds on template.id change; bumping a revision on every
  // push (theme, snippets, echoed placeholder_values) wiped mid-edit values.
  $effect(() => {
    const unlisten = listen<PreviewPayload>("preview-payload", (e) => {
      payload = e.payload;
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
  <PopoutFrame title={template.name}>
    <div class="padded">
      <TemplatePreview
        {template}
        {includeOpening}
        {includeSignature}
        {globalSignature}
        {snippets}
        {savedPlaceholderValues}
        onToggleOpening={(v) => (includeOpening = v)}
        onToggleSignature={(v) => (includeSignature = v)}
        onCopySuccess={handleCopySuccess}
        onPlaceholderValuesChange={handlePlaceholderChange}
      />
    </div>
  </PopoutFrame>
{:else}
  <PopoutFrame title="Preview">
    <div class="empty">Select a template to preview.</div>
  </PopoutFrame>
{/if}

<style>
  .padded {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px 18px;
    overflow-y: auto;
    min-height: 0;
  }

  .empty {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: auto;
    text-align: center;
  }
</style>
