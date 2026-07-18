<script lang="ts">
  import type { DialogMenuItem } from "$lib/stores/uiDialogs.svelte";

  let {
    x,
    y,
    items,
    onClose,
  }: {
    x: number;
    y: number;
    items: DialogMenuItem[];
    onClose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  // svelte-ignore state_referenced_locally
  let adjustedX = $state(x);
  // svelte-ignore state_referenced_locally
  let adjustedY = $state(y);

  // After mount, nudge the menu back on-screen if it overflows.
  $effect(() => {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (rect.right > w) adjustedX = Math.max(0, w - rect.width - 4);
    if (rect.bottom > h) adjustedY = Math.max(0, h - rect.height - 4);
  });

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function pick(item: DialogMenuItem): void {
    if (item.disabled) return;
    item.onClick();
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="cm-backdrop"
  onclick={onClose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onClose();
  }}
></div>

<div
  bind:this={menuEl}
  class="cm-menu"
  style="left: {adjustedX}px; top: {adjustedY}px"
  role="menu"
>
  {#each items as item, i (i)}
    <button
      class="cm-item"
      class:danger={item.danger}
      class:disabled={item.disabled}
      role="menuitem"
      disabled={item.disabled}
      onclick={() => pick(item)}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .cm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 250;
  }

  .cm-menu {
    position: fixed;
    z-index: 251;
    min-width: 150px;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px var(--shadow);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .cm-item {
    background: transparent;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .cm-item:hover {
    background: var(--bg-hover);
  }

  .cm-item.danger {
    color: var(--accent-danger-text);
  }

  .cm-item.danger:hover {
    background: var(--accent-danger-bg);
  }

  .cm-item.disabled,
  .cm-item:disabled {
    color: var(--text-placeholder);
    cursor: default;
  }

  .cm-item.disabled:hover,
  .cm-item:disabled:hover {
    background: transparent;
  }
</style>
