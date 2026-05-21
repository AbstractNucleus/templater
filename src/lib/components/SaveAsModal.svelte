<script lang="ts">
  import TagPicker from "./TagPicker.svelte";

  let {
    defaultName,
    availableTags,
    onSave,
    onCancel,
  }: {
    defaultName: string;
    availableTags: string[];
    onSave: (name: string, tags: string[]) => void;
    onCancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(defaultName);
  let tags = $state<string[]>([]);
  let nameInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    queueMicrotask(() => nameInput?.focus());
  });

  function handleSave(): void {
    const cleanName = name.trim() || "Untitled";
    onSave(cleanName, tags);
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="save-as-title"
  tabindex="-1"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
  onkeydown={() => {}}
>
  <div class="modal">
    <h3 id="save-as-title">Save as new template</h3>

    <label class="field">
      <span>Name</span>
      <input
        bind:this={nameInput}
        type="text"
        bind:value={name}
        placeholder="Template name"
      />
    </label>

    <div class="field">
      <span>Tags</span>
      <TagPicker
        value={tags}
        available={availableTags}
        onChange={(next) => (tags = next)}
      />
    </div>

    <div class="hint">Ctrl+Enter to save · Esc to cancel</div>

    <div class="actions">
      <button class="btn" onclick={onCancel}>Cancel</button>
      <button class="btn primary" onclick={handleSave}>Save</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 22px;
    width: 420px;
    max-width: calc(100vw - 48px);
    color: var(--text);
    box-shadow: 0 8px 32px var(--shadow);
  }

  h3 {
    margin: 0 0 14px;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .field span {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
  }

  .field input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 7px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
  }

  .field input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .hint {
    color: var(--text-subtle);
    font-size: 0.74rem;
    margin: 2px 0 14px;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .btn.primary {
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .btn.primary:hover {
    background: var(--accent-positive-hover);
  }
</style>
