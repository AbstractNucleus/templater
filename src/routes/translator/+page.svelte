<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { emit } from "@tauri-apps/api/event";
  import { translateText } from "$lib/api";

  interface TranslatorPayload {
    openrouterApiKey: string;
    translationModel: string;
    theme: "dark" | "light";
  }

  let payload = $state<TranslatorPayload | null>(null);

  let sourceText = $state("");
  let translatedText = $state("");
  let translating = $state(false);
  let error = $state<string | null>(null);

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
    const p = payload;
    if (!p || sourceText.trim().length === 0) return;
    if (!p.openrouterApiKey) {
      error = "OpenRouter API key not configured. Add it in Settings → Translation.";
      return;
    }
    translating = true;
    error = null;
    translatedText = "";
    try {
      const result = await translateText(sourceText, p.openrouterApiKey, p.translationModel);
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
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="frame">
  <header class="titlebar" data-tauri-drag-region>
    <span class="brand" data-tauri-drag-region>Translate</span>
    <span class="drag-spacer" data-tauri-drag-region></span>
  </header>

  <div class="body">
    <!-- Translated output pane (top) -->
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

    <!-- Source input pane (bottom) -->
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

  .brand {
    color: var(--text-strong);
    font-size: 0.85rem;
    font-weight: 600;
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
    padding: 12px 14px;
    gap: 6px;
    overflow: hidden;
    min-height: 0;
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
    to { transform: rotate(360deg); }
  }

  .error {
    color: var(--accent-danger-text);
    font-size: 0.82rem;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .source-input {
    flex: 0 0 auto;
    min-height: 80px;
    max-height: 160px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: -apple-system, "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif;
    font-size: 0.85rem;
    line-height: 1.5;
    padding: 10px 12px;
    resize: vertical;
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