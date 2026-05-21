<script lang="ts">
  let {
    value,
    available,
    onChange,
  }: {
    value: string[];
    available: string[];
    onChange: (next: string[]) => void;
  } = $props();

  let input = $state("");
  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();

  function normalize(s: string): string {
    return s.trim().toLowerCase();
  }

  const query = $derived(normalize(input));
  const valueSet = $derived(new Set(value.map((v) => v.toLowerCase())));

  const candidates = $derived.by(() => {
    return available
      .filter((t) => !valueSet.has(t.toLowerCase()))
      .filter((t) => query === "" || t.toLowerCase().includes(query))
      .sort();
  });

  // True when the typed query doesn't match any existing tag (case-insensitive)
  // and isn't already selected — i.e. picking it would create a new tag.
  const canCreate = $derived(
    query.length > 0 &&
      !valueSet.has(query) &&
      !available.some((t) => t.toLowerCase() === query),
  );

  function addTag(tag: string): void {
    const norm = normalize(tag);
    if (norm === "") {
      input = "";
      return;
    }
    if (valueSet.has(norm)) {
      input = "";
      return;
    }
    onChange([...value, norm]);
    input = "";
    inputEl?.focus();
  }

  function removeTag(tag: string): void {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      const candidate = candidates[0] ?? (canCreate ? query : null);
      if (candidate !== null) {
        e.preventDefault();
        e.stopPropagation();
        addTag(candidate);
      }
    } else if (e.key === "Backspace" && input.length === 0 && value.length > 0) {
      e.preventDefault();
      removeTag(value[value.length - 1]);
    } else if (e.key === "Escape") {
      // Stop propagation so parent modals (SaveAsModal) don't also close
      // on the same keystroke.
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        open = false;
        inputEl?.blur();
      }
    }
  }

  function handleDocumentMousedown(e: MouseEvent): void {
    if (!root) return;
    if (!root.contains(e.target as Node)) open = false;
  }

  function focusInput(): void {
    inputEl?.focus();
  }
</script>

<svelte:window onmousedown={handleDocumentMousedown} />

<div class="picker" bind:this={root}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="chips-row" onclick={focusInput}>
    {#each value as tag (tag)}
      <span class="chip">
        <span class="chip-text">{tag}</span>
        <button
          type="button"
          class="chip-x"
          onclick={(e) => {
            e.stopPropagation();
            removeTag(tag);
          }}
          aria-label={`Remove ${tag} tag`}
        >×</button>
      </span>
    {/each}
    <input
      bind:this={inputEl}
      bind:value={input}
      class="picker-input"
      placeholder={value.length === 0 ? "Add tags…" : ""}
      onfocus={() => (open = true)}
      onkeydown={handleKeydown}
    />
  </div>
  {#if open}
    <div class="dropdown">
      {#each candidates as tag (tag)}
        <button type="button" class="opt" onclick={() => addTag(tag)}>{tag}</button>
      {/each}
      {#if canCreate}
        <button type="button" class="opt create" onclick={() => addTag(query)}>
          + Create "{query}"
        </button>
      {/if}
      {#if candidates.length === 0 && !canCreate}
        <div class="dropdown-empty">
          {available.length === 0 ? "No tags yet — type to create one." : "No matching tags."}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }

  .chips-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
    min-height: 30px;
    cursor: text;
  }

  .chips-row:focus-within {
    border-color: var(--border-focus);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-active);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    padding: 1px 3px 1px 7px;
    font-size: 0.78rem;
    line-height: 1.4;
  }

  .chip-text {
    white-space: nowrap;
  }

  .chip-x {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
    font-size: 0.95rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .chip-x:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .picker-input {
    flex: 1;
    min-width: 80px;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    padding: 2px 0;
  }

  .picker-input::placeholder {
    color: var(--text-placeholder);
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    max-height: 220px;
    overflow-y: auto;
    box-shadow: 0 4px 16px var(--shadow);
  }

  .opt {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text);
    padding: 6px 10px;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }

  .opt:hover {
    background: var(--bg-hover);
  }

  .opt.create {
    color: var(--accent-info-text);
    border-top: 1px solid var(--border);
    font-style: italic;
  }

  .opt.create:hover {
    background: var(--accent-info-bg);
  }

  .dropdown-empty {
    color: var(--text-subtle);
    font-size: 0.78rem;
    padding: 8px 10px;
    font-style: italic;
  }
</style>
