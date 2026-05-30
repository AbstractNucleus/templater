<script lang="ts">
  let {
    title,
    name = null,
    message = null,
    confirmLabel,
    danger = false,
    ariaLabel = null,
    input = false,
    inputValue = $bindable(""),
    inputPlaceholder = "",
    confirmDisabled = false,
    onConfirm,
    onCancel,
    onDismiss,
  }: {
    /** The heading text. */
    title: string;
    /** Optional quoted monospace line (e.g. the target template's name). */
    name?: string | null;
    /** Optional secondary line below the heading (e.g. an undo hint). */
    message?: string | null;
    confirmLabel: string;
    danger?: boolean;
    /** When set, used as the dialog's accessible label. When null, the dialog
     *  is labelled by its heading instead (aria-labelledby). */
    ariaLabel?: string | null;
    /** Renders a single-line text input between the heading and the actions. */
    input?: boolean;
    /** Bound value of the text input (only meaningful when `input` is true). */
    inputValue?: string;
    inputPlaceholder?: string;
    /** Disables the confirm button (e.g. empty required input). */
    confirmDisabled?: boolean;
    onConfirm: () => void;
    /** Fired by the Cancel button and the Escape key. */
    onCancel: () => void;
    /** Fired by a click on the backdrop. Defaults to `onCancel`. */
    onDismiss?: () => void;
  } = $props();

  const titleId = "confirm-dialog-title";
  const dismiss = $derived(onDismiss ?? onCancel);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="confirm-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label={ariaLabel}
  aria-labelledby={ariaLabel === null ? titleId : undefined}
  tabindex="-1"
  onclick={(e) => e.target === e.currentTarget && dismiss()}
  onkeydown={(e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onConfirm();
    }
  }}
>
  <div class="confirm-modal">
    <h3 id={titleId}>{title}</h3>
    {#if name !== null}
      <p class="confirm-name">"{name}"</p>
    {/if}
    {#if input}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="bulk-tag-input"
        type="text"
        placeholder={inputPlaceholder}
        bind:value={inputValue}
        autofocus
      />
    {/if}
    {#if message !== null}
      <p class="confirm-warn">{message}</p>
    {/if}
    <div class="confirm-actions">
      <button class="confirm-btn" onclick={onCancel}>Cancel</button>
      {#if input}
        <button
          class="confirm-btn"
          class:danger
          disabled={confirmDisabled}
          onclick={onConfirm}
        >{confirmLabel}</button>
      {:else}
        <!-- svelte-ignore a11y_autofocus -->
        <button class="confirm-btn" class:danger onclick={onConfirm} autofocus
          >{confirmLabel}</button
        >
      {/if}
    </div>
  </div>
</div>

<style>
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 260;
  }

  .confirm-modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 22px;
    width: 360px;
    max-width: calc(100vw - 48px);
    color: var(--text);
    box-shadow: 0 8px 32px var(--shadow);
  }

  .confirm-modal h3 {
    margin: 0 0 8px;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .confirm-name {
    margin: 0 0 4px;
    font-size: 0.85rem;
    color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    word-break: break-word;
  }

  .confirm-warn {
    margin: 0 0 18px;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .confirm-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .confirm-btn.danger {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .confirm-btn.danger:hover {
    background: var(--accent-danger-border);
  }

  .bulk-tag-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.9rem;
    margin: 0 0 18px;
  }

  .bulk-tag-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }
</style>
