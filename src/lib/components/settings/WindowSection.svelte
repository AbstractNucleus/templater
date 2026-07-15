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
  <label class="check-row">
    <input
      type="checkbox"
      checked={settings.always_on_top_default}
      onchange={(e) => toggleAlwaysOnTop(e.currentTarget.checked)}
    />
    <span>Always on top by default (applies on launch)</span>
  </label>
  <label class="check-row">
    <input
      type="checkbox"
      checked={settings.start_minimised_to_tray}
      onchange={(e) => toggleStartMinimised(e.currentTarget.checked)}
    />
    <span>Start minimised to tray</span>
  </label>
  {#if settings.window_geometry}
    <div class="hint window-pos">
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
  /* section / label / hint / port-btn / port-row inherited from .pane-body. */

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
    margin-bottom: 6px;
  }

  .check-row:last-of-type {
    margin-bottom: 0;
  }

  .check-row input[type="checkbox"] {
    accent-color: var(--accent-brand);
  }

  .window-pos {
    margin-top: 8px;
  }
</style>
