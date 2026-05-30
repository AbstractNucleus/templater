<script lang="ts">
  import type { Settings } from "$lib/types";

  let {
    settings,
    onUpdate,
  }: {
    settings: Settings;
    onUpdate: (next: Settings) => void;
  } = $props();

  function updateSignature(next: string): void {
    onUpdate({ ...settings, global_signature: next });
  }

  // Snippet management. The persisted shape is Record<string, string>, but
  // rendering needs a stable order — turn it into [key, value] tuples and
  // commit a Record back on every edit. A blank trailing row appears so the
  // user always has somewhere to type the next snippet.
  let snippetRows = $state<Array<{ key: string; value: string }>>([]);

  // Sync local draft to settings whenever the props change (open / load /
  // remote update). Drops empties on the way in so the UI shows exactly what's
  // persisted; a single blank row is appended below.
  $effect(() => {
    const persisted = settings.snippets ?? {};
    snippetRows = Object.entries(persisted).map(([key, value]) => ({ key, value }));
  });

  function commitSnippets(rows: Array<{ key: string; value: string }>): void {
    const next: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k.length === 0) continue;
      next[k] = r.value;
    }
    onUpdate({ ...settings, snippets: next });
  }

  function updateSnippetKey(idx: number, key: string): void {
    snippetRows[idx] = { ...snippetRows[idx], key };
    commitSnippets(snippetRows);
  }

  function updateSnippetValue(idx: number, value: string): void {
    snippetRows[idx] = { ...snippetRows[idx], value };
    commitSnippets(snippetRows);
  }

  function removeSnippet(idx: number): void {
    snippetRows = snippetRows.filter((_, i) => i !== idx);
    commitSnippets(snippetRows);
  }

  function addSnippetRow(): void {
    snippetRows = [...snippetRows, { key: "", value: "" }];
  }
</script>

<section>
  <div class="section-label">Global signature</div>
  <textarea
    class="field-textarea"
    rows="3"
    placeholder={"— Your Name\\nyou@example.com"}
    value={settings.global_signature}
    oninput={(e) => updateSignature(e.currentTarget.value)}
  ></textarea>
  <div class="hint">
    Used when a template's own signature is empty and "Include signature" is on.
  </div>
</section>

<section>
  <div class="section-label">Global snippets</div>
  {#if snippetRows.length > 0}
    <ul class="snippet-list">
      {#each snippetRows as row, idx (idx)}
        <li class="snippet-row">
          <input
            class="snippet-input snippet-key"
            type="text"
            placeholder="key (e.g. me_name)"
            value={row.key}
            oninput={(e) => updateSnippetKey(idx, e.currentTarget.value)}
          />
          <input
            class="snippet-input snippet-value"
            type="text"
            placeholder="expansion"
            value={row.value}
            oninput={(e) => updateSnippetValue(idx, e.currentTarget.value)}
          />
          <button
            class="snippet-remove"
            title="Remove snippet"
            aria-label="Remove snippet"
            onclick={() => removeSnippet(idx)}
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="port-row">
    <button class="port-btn" onclick={addSnippetRow}>+ Add snippet</button>
  </div>
  <div class="hint">
    Snippets expand at copy time alongside <code>{"{{date}}"}</code> /
    <code>{"{{time}}"}</code>. Use the key as the placeholder name —
    <code>{"{{me_name}}"}</code> with key <code>me_name</code> expands to its value.
    Per-template fills override snippets.
  </div>
</section>

<style>
  /* section / section-label / hint / code / port-row / port-btn inherited from
     SettingsModal's :global(.pane-body ...) rules. */

  .field-textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 5px;
    font: inherit;
    font-size: 0.85rem;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    line-height: 1.45;
    resize: vertical;
    min-height: 60px;
  }

  .field-textarea:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .snippet-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .snippet-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .snippet-input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 9px;
    border-radius: 5px;
    font: inherit;
    font-size: 0.8rem;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  }

  .snippet-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .snippet-key {
    flex: 0 0 140px;
  }

  .snippet-value {
    flex: 1;
    min-width: 0;
  }

  .snippet-remove {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 26px;
    height: 26px;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    padding: 0;
    flex-shrink: 0;
  }

  .snippet-remove:hover {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }
</style>
