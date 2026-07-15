<script lang="ts">
  // The app's flagship action button. Shared by TemplateView and EditorPane so
  // the copy affordance (brand color, success flash, kbd hint) can't drift
  // between browse and editor modes.
  let {
    copyState = "idle",
    showKbd = false,
    disabled = false,
    onclick,
  }: {
    copyState?: "idle" | "ok" | "error";
    /** Show the ⏎ hint (only where Enter actually triggers the copy). */
    showKbd?: boolean;
    disabled?: boolean;
    onclick: () => void;
  } = $props();
</script>

<button
  class="copy"
  class:ok={copyState === "ok"}
  class:err={copyState === "error"}
  {disabled}
  {onclick}
>
  {#if copyState === "ok"}
    <span class="copy-label">Copied</span>
  {:else if copyState === "error"}
    <span class="copy-label">Copy failed</span>
  {:else}
    <span class="copy-label">Copy</span>
    {#if showKbd}
      <kbd class="copy-kbd">⏎</kbd>
    {/if}
  {/if}
</button>

<style>
  .copy {
    background: var(--accent-brand);
    color: #fff;
    border: 1px solid var(--accent-brand);
    padding: 7px 14px 7px 16px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.18);
    transition: background 120ms, transform 80ms, opacity 120ms;
  }

  .copy:hover:not(:disabled) {
    background: var(--accent-brand-hover);
    border-color: var(--accent-brand-hover);
  }

  .copy:active:not(:disabled) {
    transform: translateY(1px);
  }

  .copy:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
  }

  .copy.ok {
    background: var(--accent-positive-border);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
    animation: copy-success 380ms ease-out;
  }

  @keyframes copy-success {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 0 var(--accent-positive-border);
    }
    35% {
      transform: scale(1.035);
      box-shadow: 0 0 0 4px rgba(136, 200, 150, 0.35);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.18);
    }
  }

  .copy.err {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .copy-kbd {
    font-family: inherit;
    font-size: 0.72rem;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.92);
  }
</style>
