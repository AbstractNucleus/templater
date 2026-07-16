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
        Hide the preview pane. Use a pop-out window to the left for preview & copy —
        handy for keeping Templater narrow beside another app.
      </span>
    </span>
  </label>
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
</style>