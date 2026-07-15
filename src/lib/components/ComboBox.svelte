<script lang="ts">
  // Chip + dropdown combobox shared by TagPicker (multi-select, lowercased)
  // and FolderPicker (single-select, case-preserved). The hosting wrapper
  // owns the real value shape and decides what add/remove mean; this
  // component owns the input, dropdown, keyboard, and click-outside behaviour.
  let {
    selected,
    available,
    normalize = (s: string) => s.trim(),
    multiple = false,
    placeholder,
    noun,
    onAdd,
    onRemove,
  }: {
    /** Currently-chosen values, rendered as chips. Single-select passes 0 or 1. */
    selected: string[];
    available: string[];
    /** Canonicalises typed input and new entries (e.g. lowercase for tags). */
    normalize?: (s: string) => string;
    /** Multi-select keeps the dropdown open after each pick; single closes it. */
    multiple?: boolean;
    placeholder: string;
    /** Singular noun for the empty-state copy ("tag" / "folder"). */
    noun: string;
    onAdd: (item: string) => void;
    onRemove: (item: string) => void;
  } = $props();

  let input = $state("");
  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let inputEl: HTMLInputElement | undefined = $state();
  const listboxId = `combo-list-${Math.random().toString(36).slice(2, 8)}`;

  const query = $derived(normalize(input));
  const selectedLower = $derived(new Set(selected.map((v) => v.toLowerCase())));
  const selectedHas = (s: string): boolean => selectedLower.has(s.toLowerCase());

  const candidates = $derived(
    available
      .filter((o) => !selectedHas(o))
      .filter((o) => query === "" || o.toLowerCase().includes(query.toLowerCase()))
      .sort(),
  );

  // True when the typed query is neither already chosen nor an existing option
  // (case-insensitive) — i.e. picking it would create a new entry.
  const canCreate = $derived(
    query.length > 0 &&
      !selectedHas(query) &&
      !available.some((o) => o.toLowerCase() === query.toLowerCase()),
  );

  // Flat pickable list: existing candidates followed by the create entry.
  // Arrow keys move `highlightIdx` through this list; Enter picks it.
  const options = $derived.by(() => {
    const opts: { kind: "existing" | "create"; value: string }[] = candidates.map((c) => ({
      kind: "existing" as const,
      value: c,
    }));
    if (canCreate) opts.push({ kind: "create", value: query });
    return opts;
  });

  let highlightIdx = $state(0);
  // The option list shrinks/grows as the user types — clamp instead of
  // resetting so the highlight doesn't jump around mid-keystroke.
  const activeIdx = $derived(options.length === 0 ? -1 : Math.min(highlightIdx, options.length - 1));

  function moveHighlight(delta: number): void {
    if (options.length === 0) return;
    highlightIdx = Math.max(0, Math.min(activeIdx + delta, options.length - 1));
    queueMicrotask(() => {
      root?.querySelector(".opt.active")?.scrollIntoView({ block: "nearest" });
    });
  }

  function add(item: string): void {
    const norm = normalize(item);
    if (norm === "" || selectedHas(norm)) {
      input = "";
      return;
    }
    onAdd(norm);
    input = "";
    if (multiple) {
      inputEl?.focus();
    } else {
      open = false;
      inputEl?.blur();
    }
  }

  function remove(item: string): void {
    onRemove(item);
    if (!multiple) inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        open = true;
        return;
      }
      moveHighlight(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      const candidate = activeIdx >= 0 ? options[activeIdx].value : null;
      if (candidate !== null) {
        e.preventDefault();
        e.stopPropagation();
        add(candidate);
      }
    } else if (e.key === "Backspace" && input.length === 0 && selected.length > 0) {
      e.preventDefault();
      remove(selected[selected.length - 1]);
    } else if (e.key === "Escape") {
      // Stop propagation so a parent form/modal doesn't also close on the
      // same keystroke.
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
    {#each selected as item (item)}
      <span class="chip">
        <span class="chip-text">{item}</span>
        <button
          type="button"
          class="chip-x"
          onclick={(e) => {
            e.stopPropagation();
            remove(item);
          }}
          aria-label={`Remove ${item}`}
        >×</button>
      </span>
    {/each}
    <input
      bind:this={inputEl}
      bind:value={input}
      class="picker-input"
      role="combobox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-autocomplete="list"
      placeholder={selected.length === 0 ? placeholder : ""}
      onfocus={() => (open = true)}
      oninput={() => (highlightIdx = 0)}
      onkeydown={handleKeydown}
    />
  </div>
  {#if open}
    <div class="dropdown" role="listbox" id={listboxId}>
      {#each options as opt, i (opt.kind + opt.value)}
        <button
          type="button"
          class="opt"
          class:create={opt.kind === "create"}
          class:active={i === activeIdx}
          role="option"
          aria-selected={i === activeIdx}
          onmouseenter={() => (highlightIdx = i)}
          onclick={() => add(opt.value)}
        >{opt.kind === "create" ? `+ Create "${opt.value}"` : opt.value}</button>
      {/each}
      {#if options.length === 0}
        <div class="dropdown-empty">
          {available.length === 0
            ? `No ${noun}s yet — type to create one.`
            : `No matching ${noun}s.`}
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
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
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

  .opt.active {
    background: var(--bg-hover);
  }

  .opt.create {
    color: var(--accent-info-text);
    border-top: 1px solid var(--border);
    font-style: italic;
  }

  .opt.create.active {
    background: var(--accent-info-bg);
  }

  .dropdown-empty {
    color: var(--text-subtle);
    font-size: 0.78rem;
    padding: 8px 10px;
    font-style: italic;
  }
</style>
