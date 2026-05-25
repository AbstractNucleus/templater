<script lang="ts">
  import type { Settings } from "$lib/types";
  import { resetWindowPosition } from "$lib/api";

  let {
    settings,
    onUpdate,
  }: {
    settings: Settings;
    onUpdate: (next: Settings) => void;
  } = $props();

  function toggleAlwaysOnTop(next: boolean): void {
    onUpdate({ ...settings, always_on_top_default: next });
  }

  function toggleStartMinimised(next: boolean): void {
    onUpdate({ ...settings, start_minimised_to_tray: next });
  }
</script>

<section>
  <div class="section-label">Window</div>
  <label class="row">
    <input
      type="checkbox"
      checked={settings.always_on_top_default}
      onchange={(e) => toggleAlwaysOnTop(e.currentTarget.checked)}
    />
    <span>Always on top by default (applies on launch)</span>
  </label>
  <label class="row">
    <input
      type="checkbox"
      checked={settings.start_minimised_to_tray}
      onchange={(e) => toggleStartMinimised(e.currentTarget.checked)}
    />
    <span>Start minimised to tray</span>
  </label>
  {#if settings.window_geometry}
    <div class="hint">
      Window position saved: {settings.window_geometry.x},{settings.window_geometry.y}
      ({settings.window_geometry.width}×{settings.window_geometry.height})
    </div>
    <div class="port-row">
      <button
        class="port-btn"
        onclick={async () => {
          await resetWindowPosition().catch(() => {});
          onUpdate({ ...settings, window_geometry: null });
        }}
      >Reset position</button>
    </div>
    <div class="hint">Centres the window and clears the saved coordinates.</div>
  {/if}
</section>

<style>
  section {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  section:last-of-type {
    border-bottom: none;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
    margin-bottom: 8px;
  }

  .hint {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
    margin-bottom: 6px;
  }

  .row:last-of-type {
    margin-bottom: 0;
  }

  .row input[type="checkbox"] {
    accent-color: var(--text-muted);
  }

  .port-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .port-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .port-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .port-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }
</style>
