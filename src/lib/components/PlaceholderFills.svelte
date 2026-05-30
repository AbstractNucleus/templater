<script lang="ts">
  import type { ParsedPlaceholder } from "$lib/compose";

  let {
    placeholders,
    values,
    onSetValue,
  }: {
    placeholders: ParsedPlaceholder[];
    /** Current fill-in values keyed by placeholder key. Owned by the parent,
     *  which also handles debounced persistence and the copy-flow flush. */
    values: Record<string, string>;
    onSetValue: (key: string, value: string) => void;
  } = $props();
</script>

{#if placeholders.length > 0}
  <div class="placeholders">
    <span class="placeholders-label">Fill</span>
    {#each placeholders as p (p.key)}
      {#if p.kind.type === "choice"}
        <select
          class="placeholder-input placeholder-select"
          class:filled={(values[p.key] ?? "") !== ""}
          value={values[p.key] ?? ""}
          onchange={(e) => onSetValue(p.key, e.currentTarget.value)}
          title={p.label}
        >
          <option value="">{`{{${p.key}}}`}</option>
          {#each p.kind.options as opt}
            <option value={opt}>{opt}</option>
          {/each}
        </select>
      {:else}
        <input
          class="placeholder-input"
          class:filled={(values[p.key] ?? "") !== ""}
          type="text"
          placeholder={`{{${p.key}}}`}
          value={values[p.key] ?? ""}
          oninput={(e) => onSetValue(p.key, e.currentTarget.value)}
        />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .placeholders {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0 0 12px;
  }

  .placeholders-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
  }

  .placeholder-input {
    background: var(--accent-info-bg);
    color: var(--accent-info-text);
    border: 1px solid var(--accent-info-border);
    padding: 1px 7px;
    border-radius: 10px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.72rem;
    field-sizing: content;
    min-width: 4ch;
    max-width: 32ch;
    outline: none;
  }

  .placeholder-input.filled {
    background: var(--bg-input);
    color: var(--text);
    border-color: var(--border);
  }

  .placeholder-input::placeholder {
    color: var(--accent-info-text);
    opacity: 0.55;
  }

  .placeholder-input:focus {
    border-color: var(--border-focus);
  }

  .placeholder-select {
    min-width: 6ch;
    padding-right: 18px;
    appearance: none;
    background-image: linear-gradient(
      45deg,
      transparent 50%,
      var(--accent-info-text) 50%
    ),
    linear-gradient(
      135deg,
      var(--accent-info-text) 50%,
      transparent 50%
    );
    background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
  }

  .placeholder-select.filled {
    background-image: linear-gradient(
      45deg,
      transparent 50%,
      var(--text-muted) 50%
    ),
    linear-gradient(
      135deg,
      var(--text-muted) 50%,
      transparent 50%
    );
    background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
  }
</style>
