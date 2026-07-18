<script lang="ts">
  import type { Settings } from "$lib/types";

  let {
    settings,
    onUpdate,
  }: {
    settings: Settings;
    onUpdate: (next: Settings) => void;
  } = $props();
</script>

<section>
  <div class="section-label">OpenRouter</div>
  <div class="field-row">
    <label class="field-label" for="openrouter-api-key">
      <span class="check-title">API key</span>
      <span class="check-hint">Required for the translation pop-out. Stored in settings.json (OS keychain deferred). Get a free key at openrouter.ai/keys</span>
    </label>
    <input
      id="openrouter-api-key"
      class="text-input"
      type="password"
      placeholder="sk-or-..."
      value={settings.openrouter_api_key}
      oninput={(e) => onUpdate({ ...settings, openrouter_api_key: e.currentTarget.value })}
    />
  </div>
  <div class="field-row">
    <label class="field-label" for="translation-model">
      <span class="check-title">Model</span>
      <span class="check-hint">OpenRouter model identifier, e.g. "openrouter/free" or "google/gemini-2.0-flash-001"</span>
    </label>
    <input
      id="translation-model"
      class="text-input"
      type="text"
      placeholder="openrouter/free"
      value={settings.translation_model}
      oninput={(e) => onUpdate({ ...settings, translation_model: e.currentTarget.value })}
    />
  </div>
</section>

<style>
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
