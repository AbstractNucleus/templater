<script lang="ts">
  import type { Mode, Settings, Theme } from "$lib/types";

  let {
    settings,
    onUpdate,
  }: {
    settings: Settings;
    onUpdate: (next: Settings) => void;
  } = $props();

  function setTheme(next: Theme): void {
    onUpdate({ ...settings, theme: next });
  }

  function setMode(next: Mode): void {
    onUpdate({ ...settings, mode: next });
  }

  function setMinimal(next: boolean): void {
    onUpdate({ ...settings, minimal: next });
  }
</script>

<section>
  <div class="section-label">Mode</div>
  <div class="seg-toggle">
    <button
      class="seg-btn"
      class:active={settings.mode === "editor"}
      onclick={() => setMode("editor")}
    >
      Editor
    </button>
    <button
      class="seg-btn"
      class:active={settings.mode === "user"}
      onclick={() => setMode("user")}
    >
      User
    </button>
  </div>
  <div class="hint">
    {#if settings.mode === "editor"}
      Full access. Create, edit, duplicate, and delete templates.
    {:else}
      Read-only. Browse and copy templates — but no catalog changes.
    {/if}
  </div>
</section>

<section>
  <div class="section-label">Appearance</div>
  <div class="seg-toggle">
    <button
      class="seg-btn"
      class:active={settings.theme === "dark"}
      onclick={() => setTheme("dark")}
    >
      Dark
    </button>
    <button
      class="seg-btn"
      class:active={settings.theme === "light"}
      onclick={() => setTheme("light")}
    >
      Light
    </button>
  </div>
</section>

<section>
  <div class="section-label">Layout</div>
  <label class="check-row">
    <input
      type="checkbox"
      checked={settings.minimal}
      onchange={(e) => setMinimal(e.currentTarget.checked)}
    />
    <span class="check-text">
      <span class="check-title">Minimal mode</span>
      <span class="check-hint">
        Hide the preview pane. Use a pop-out window to the left for preview & copy
      </span>
    </span>
  </label>
</section>

<section>
  <div class="section-label">Translation</div>
  <div class="field-row">
    <label class="field-label">
      <span class="check-title">OpenRouter API Key</span>
      <span class="check-hint">Required for the translation pop-out. Get a free key at openrouter.ai/keys</span>
    </label>
    <input
      class="text-input"
      type="password"
      placeholder="sk-or-..."
      value={settings.openrouter_api_key}
      oninput={(e) => onUpdate({ ...settings, openrouter_api_key: e.currentTarget.value })}
    />
  </div>
  <div class="field-row">
    <label class="field-label">
      <span class="check-title">Translation model</span>
      <span class="check-hint">OpenRouter model identifier, e.g. "openrouter/free" or "google/gemini-2.0-flash-001"</span>
    </label>
    <input
      class="text-input"
      type="text"
      placeholder="openrouter/free"
      value={settings.translation_model}
      oninput={(e) => onUpdate({ ...settings, translation_model: e.currentTarget.value })}
    />
  </div>
</section>

<style>
  .check-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }

  .check-row input[type="checkbox"] {
    margin-top: 3px;
    accent-color: var(--accent-brand);
  }

  .check-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .check-title {
    font-size: 0.85rem;
    color: var(--text);
  }

  .check-hint {
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .field-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .text-input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 6px;
    font: inherit;
    font-size: 0.82rem;
    width: 100%;
    box-sizing: border-box;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }

  .text-input::placeholder {
    color: var(--text-placeholder);
  }
</style>