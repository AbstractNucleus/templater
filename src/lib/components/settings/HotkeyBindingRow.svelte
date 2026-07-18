<script lang="ts">
  import type { Snippet } from "svelte";
  import { keyLabel, splitAccelerator } from "$lib/hotkeyLabels";

  let {
    label,
    accelerator,
    capturing,
    captureError = null,
    showReset,
    onRebind,
    onReset,
    children,
  }: {
    label: string;
    accelerator: string;
    capturing: boolean;
    captureError?: string | null;
    showReset: boolean;
    onRebind: () => void;
    onReset: () => void;
    children: Snippet;
  } = $props();
</script>

<section>
  <div class="section-label">{label}</div>
  <div class="hotkey-row">
    {#if capturing}
      <span class="keycap-group capturing">
        <span class="capture-text">Press keys… (Esc to cancel)</span>
      </span>
    {:else}
      <span class="keycap-group">
        {#each splitAccelerator(accelerator) as part, i (i)}
          {#if i > 0}<span class="keycap-plus" aria-hidden="true">+</span>{/if}
          <kbd class="keycap">{keyLabel(part)}</kbd>
        {/each}
      </span>
      <button class="rebind" onclick={onRebind}>Rebind</button>
      {#if showReset}
        <button class="rebind" onclick={onReset}>Reset</button>
      {/if}
    {/if}
  </div>
  <div class="hint">{@render children()}</div>
  {#if captureError}
    <div class="capture-error">{captureError}</div>
  {/if}
</section>

<style>
  .hotkey-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .keycap-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .keycap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: linear-gradient(180deg, var(--bg-input) 0%, var(--bg-elevated) 100%);
    color: var(--text-strong);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    font-weight: 500;
    box-shadow:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.04),
      0 1px 0 0 var(--border);
  }

  .keycap-plus {
    color: var(--text-deemphasis);
    font-size: 0.78rem;
  }

  .keycap-group.capturing {
    padding: 4px 10px;
    border: 1px dashed var(--accent-warning-border);
    background: var(--accent-warning-bg);
    border-radius: 6px;
  }

  .capture-text {
    color: var(--accent-warning-text);
    font-size: 0.8rem;
  }

  .rebind {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
  }

  .rebind:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
</style>
