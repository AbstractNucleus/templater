<script lang="ts">
  import type { TemplateDraft } from "$lib/types";
  import TagPicker from "./TagPicker.svelte";
  import FolderPicker from "./FolderPicker.svelte";

  let {
    value,
    availableTags,
    availableFolders,
    bodyGrow = false,
    autofocusName = false,
    onChange,
  }: {
    value: TemplateDraft;
    availableTags: string[];
    availableFolders: string[];
    bodyGrow?: boolean;
    autofocusName?: boolean;
    onChange: (next: TemplateDraft) => void;
  } = $props();

  let nameInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (autofocusName) {
      queueMicrotask(() => nameInput?.focus());
    }
  });

  function patch(partial: Partial<TemplateDraft>): void {
    onChange({ ...value, ...partial });
  }
</script>

<div class="form">
  <div class="field-row">
    <label class="field">
      <span>Name</span>
      <input
        bind:this={nameInput}
        type="text"
        value={value.name}
        oninput={(e) => patch({ name: e.currentTarget.value })}
      />
    </label>
    <div class="field">
      <span>Tags</span>
      <TagPicker
        value={value.tags}
        available={availableTags}
        onChange={(next) => patch({ tags: next })}
      />
    </div>
    <div class="field">
      <span>Folder</span>
      <FolderPicker
        value={value.folder}
        available={availableFolders}
        onChange={(next) => patch({ folder: next })}
        placeholder="ungrouped"
      />
    </div>
  </div>
  <label class="field">
    <span>Opening</span>
    <input
      type="text"
      value={value.opening}
      oninput={(e) => patch({ opening: e.currentTarget.value })}
      placeholder="Hi {'{{'}name{'}}'},"
    />
  </label>
  <label class="field" class:grow={bodyGrow}>
    <span>Body</span>
    <textarea
      rows={bodyGrow ? 10 : 8}
      value={value.body}
      oninput={(e) => patch({ body: e.currentTarget.value })}
    ></textarea>
  </label>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .field-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 10px;
  }

  .field-row > .field {
    flex: 1;
    min-width: 0;
    margin-bottom: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .field.grow {
    flex: 1;
    min-height: 0;
  }

  .field span {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
  }

  .field input,
  .field textarea {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
  }

  .field textarea {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    line-height: 1.5;
    resize: vertical;
    min-height: 120px;
    flex: 1;
  }

  .field input:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }
</style>
