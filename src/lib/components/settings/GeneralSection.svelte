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

  function setAiEnabled(next: boolean): void {
    onUpdate({ ...settings, ai_enabled: next });
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
      Read-only. Browse, "Base on template" to draft a message, and copy the result —
      but no catalog changes.
    {/if}
  </div>
</section>

<section>
  <div class="section-label">AI features</div>
  <div class="seg-toggle">
    <button
      class="seg-btn"
      class:active={!settings.ai_enabled}
      onclick={() => setAiEnabled(false)}
    >
      Off
    </button>
    <button
      class="seg-btn"
      class:active={settings.ai_enabled}
      onclick={() => setAiEnabled(true)}
    >
      On
    </button>
  </div>
  <div class="hint">
    {#if settings.ai_enabled}
      Claude-powered features are on: paste-match ranking, the agent editor,
      "Adapt to inbound", context sources, and memory capture.
    {:else}
      All AI features are hidden. Turn on to rank pasted messages, draft and
      adapt templates with Claude, and use context sources.
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

<style>
  /* section / section-label / hint / seg-toggle / seg-btn inherited from
     SettingsModal's :global(.pane-body ...) rules. */
</style>
