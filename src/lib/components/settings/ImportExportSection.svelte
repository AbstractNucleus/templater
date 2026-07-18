<script lang="ts">
  import type { PortResult, Settings } from "$lib/types";

  let {
    settings,
    onExportTemplates,
    onImportTemplates,
  }: {
    settings: Settings;
    onExportTemplates: () => Promise<PortResult>;
    onImportTemplates: (overwrite: boolean) => Promise<PortResult>;
  } = $props();

  let portMessage = $state<string | null>(null);
  let portError = $state<string | null>(null);
  let portBusy = $state(false);
  /** Transient per-action choice — not persisted; resets to false each open. */
  let overwriteOnImport = $state(false);

  async function handleExportClick(): Promise<void> {
    if (portBusy) return;
    portBusy = true;
    portMessage = null;
    portError = null;
    try {
      const r = await onExportTemplates();
      if (r.kind === "ok") portMessage = r.message;
      else if (r.kind === "err") portError = r.error;
    } finally {
      portBusy = false;
    }
  }

  async function handleImportClick(): Promise<void> {
    if (portBusy) return;
    portBusy = true;
    portMessage = null;
    portError = null;
    try {
      const r = await onImportTemplates(overwriteOnImport);
      if (r.kind === "ok") portMessage = r.message;
      else if (r.kind === "err") portError = r.error;
    } finally {
      portBusy = false;
    }
  }
</script>

<section>
  <div class="section-label">Import / export</div>
  <div class="port-row">
    <button class="port-btn" disabled={portBusy} onclick={handleExportClick}>
      Export…
    </button>
    {#if settings.mode === "editor"}
      <button class="port-btn" disabled={portBusy} onclick={handleImportClick}>
        Import…
      </button>
    {/if}
  </div>
  {#if settings.mode === "editor"}
    <label class="overwrite-toggle">
      <input
        type="checkbox"
        checked={overwriteOnImport}
        onchange={(e) => (overwriteOnImport = e.currentTarget.checked)}
      />
      <span>Overwrite duplicates</span>
    </label>
  {/if}
  {#if portMessage}
    <div class="port-message">{portMessage}</div>
  {/if}
  {#if portError}
    <div class="capture-error">{portError}</div>
  {/if}
  <div class="hint">
    {#if settings.mode === "editor"}
      Export writes all templates to a JSON file. Import merges by id —
      {#if overwriteOnImport}
        matching templates are <strong>replaced</strong> with the import
        file's content (your usage stats stay; the pre-overwrite version
        is appended to history so you can Revert).
      {:else}
        templates already on this machine are kept and duplicates are
        skipped.
      {/if}
    {:else}
      Export writes all templates to a JSON file. Import is disabled in User mode.
    {/if}
  </div>
</section>

<style>
  /* section / section-label / hint / port-row / port-btn / port-message /
     capture-error inherited from SettingsModal's :global(.pane-body ...) rules. */

  .overwrite-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 0.82rem;
    cursor: pointer;
    user-select: none;
  }

  .overwrite-toggle input[type="checkbox"] {
    accent-color: var(--accent-brand);
  }
</style>
