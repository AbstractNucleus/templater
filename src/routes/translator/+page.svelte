<script lang="ts">
  import { listen, emit } from "@tauri-apps/api/event";
  import { translateText } from "$lib/api";
  import PopoutFrame from "$lib/components/PopoutFrame.svelte";
  import ResizeHandles from "$lib/components/ResizeHandles.svelte";
  import type { TranslatorPayload } from "$lib/stores/popouts.svelte";

  const PANE_MIN = 56;
  /** Source pane share of the two panes (output is the remainder). */
  const SOURCE_SHARE_DEFAULT = 0.38;

  let payload = $state<TranslatorPayload | null>(null);

  let sourceText = $state("");
  let translatedText = $state("");
  let translating = $state(false);
  let error = $state<string | null>(null);
  let sourceShare = $state(SOURCE_SHARE_DEFAULT);

  let outputPaneEl = $state<HTMLElement | undefined>();
  let sourcePaneEl = $state<HTMLElement | undefined>();

  $effect(() => {
    if (payload && typeof document !== "undefined") {
      document.documentElement.dataset.theme = payload.theme;
    }
  });

  $effect(() => {
    const unlisten = listen<TranslatorPayload>("translator-payload", (e) => {
      payload = e.payload;
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  // Ask the main window for current payload on mount.
  $effect(() => {
    void emit("translator-request-payload");
  });

  async function doTranslate(): Promise<void> {
    if (sourceText.trim().length === 0) return;
    translating = true;
    error = null;
    translatedText = "";
    try {
      const result = await translateText(sourceText);
      translatedText = result;
    } catch (e) {
      error = String(e);
    } finally {
      translating = false;
    }
  }

  function handlePaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData("text") ?? "";
    if (text.trim().length > 0) {
      // Prevent the browser from also inserting — we'd end up with the text twice.
      e.preventDefault();
      sourceText = text;
      // Translate on next tick so the UI updates the source text first.
      setTimeout(() => void doTranslate(), 0);
    }
  }

  // Also allow manual typing + Ctrl+Enter to translate.
  function handleKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void doTranslate();
    }
  }

  function startPaneResize(e: PointerEvent): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const outputH = outputPaneEl?.offsetHeight ?? 0;
    const sourceH = sourcePaneEl?.offsetHeight ?? 0;
    const total = outputH + sourceH;
    if (total <= 0) return;

    const startY = e.clientY;
    const startSourceH = sourceH;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");

    function onMove(ev: PointerEvent): void {
      const next = Math.round(
        Math.max(PANE_MIN, Math.min(total - PANE_MIN, startSourceH - (ev.clientY - startY))),
      );
      sourceShare = next / total;
    }

    function onUp(): void {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove("dragging");
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<PopoutFrame title="Translate">
  <div class="body">
    <div
      class="pane"
      bind:this={outputPaneEl}
      style="flex: {1 - sourceShare} 1 0; min-height: {PANE_MIN}px"
    >
      <div class="pane-label">English translation</div>
      <div class="output-pane" class:loading={translating}>
        {#if translating}
          <div class="overlay">
            <div class="spinner"></div>
            <span>Translating...</span>
          </div>
        {:else if error}
          <div class="error">{error}</div>
        {:else if translatedText}
          <pre class="output-text">{translatedText}</pre>
        {:else}
          <div class="empty">Paste text below to translate to English</div>
        {/if}
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="row-resize"
      title="Drag to resize panes"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize source and translation panes"
      aria-valuenow={Math.round(sourceShare * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onpointerdown={startPaneResize}
    ></div>

    <div
      class="pane"
      bind:this={sourcePaneEl}
      style="flex: {sourceShare} 1 0; min-height: {PANE_MIN}px"
    >
      <div class="pane-label">
        Source text
        {#if sourceText.trim().length > 0}
          <span class="hint">Ctrl+Enter to translate</span>
        {/if}
      </div>
      <textarea
        class="source-input"
        placeholder="Paste text to translate to English..."
        value={sourceText}
        oninput={(e) => (sourceText = e.currentTarget.value)}
        onpaste={handlePaste}
      ></textarea>
    </div>
  </div>
</PopoutFrame>
<ResizeHandles />

<style>
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
    overflow: hidden;
    min-height: 0;
  }

  .pane {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    overflow: hidden;
  }

  .pane-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .hint {
    font-weight: 400;
    text-transform: none;
    color: var(--text-subtle);
    font-size: 0.7rem;
  }

  .output-pane {
    flex: 1;
    min-height: 0;
    position: relative;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow-y: auto;
    scrollbar-width: none;
    padding: 10px 12px;
  }

  .output-pane::-webkit-scrollbar {
    display: none;
  }

  .output-pane.loading {
    border-color: var(--accent-brand);
  }

  .output-text {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: -apple-system, "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text);
  }

  .empty {
    color: var(--text-placeholder);
    font-size: 0.82rem;
    text-align: center;
    margin-top: 20%;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: var(--bg-input);
    opacity: 0.85;
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent-brand);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error {
    color: var(--accent-danger-text);
    font-size: 0.82rem;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .row-resize {
    height: 5px;
    flex-shrink: 0;
    cursor: row-resize;
    background: transparent;
    transition: background 120ms;
    margin-top: 4px;
    margin-bottom: 4px;
    position: relative;
    z-index: 2;
  }

  .row-resize:hover,
  :global(.row-resize.dragging) {
    background: var(--border-focus);
  }

  .source-input {
    flex: 1;
    min-height: 0;
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: -apple-system, "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
    font-size: 0.85rem;
    line-height: 1.5;
    padding: 10px 12px;
    resize: none;
    box-sizing: border-box;
    scrollbar-width: none;
  }

  .source-input::-webkit-scrollbar {
    display: none;
  }

  .source-input:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }

  .source-input::placeholder {
    color: var(--text-placeholder);
  }
</style>
