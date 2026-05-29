<script lang="ts">
  import type { Template } from "$lib/types";

  let {
    template,
    open,
    onRevertHistory,
  }: {
    template: Template;
    /** Whether the prior-versions list is expanded. Owned by the parent so the
     *  toggle button can live in the shared footer. */
    open: boolean;
    onRevertHistory: (templateId: string, versionIdx: number) => void;
  } = $props();

  type HistoryDiff = { field: string; before: string; after: string };

  function formatTags(tags: string[]): string {
    return tags.length > 0 ? tags.join(", ") : "(none)";
  }

  function historyDiff(current: Template, prior: Template["history"][number]): HistoryDiff[] {
    const changes: HistoryDiff[] = [];
    if (prior.tags.join("\0") !== current.tags.join("\0")) {
      changes.push({ field: "Tags", before: formatTags(prior.tags), after: formatTags(current.tags) });
    }
    if (prior.opening !== current.opening) {
      changes.push({ field: "Opening", before: prior.opening || "(empty)", after: current.opening || "(empty)" });
    }
    if (prior.body !== current.body) {
      changes.push({ field: "Body", before: prior.body || "(empty)", after: current.body || "(empty)" });
    }
    return changes;
  }
</script>

{#if template.history.length > 0 && open}
  <ul class="history-list">
    {#each [...template.history].reverse() as v, idx (v.saved_at + idx)}
      {@const realIdx = template.history.length - 1 - idx}
      {@const changes = historyDiff(template, v)}
      <li class="history-row">
        <div class="history-meta">
          <span class="history-time">{new Date(v.saved_at).toLocaleString()}</span>
          <button
            class="history-revert"
            onclick={() => onRevertHistory(template.id, realIdx)}
          >Revert</button>
        </div>
        {#if changes.length === 0}
          <div class="history-empty">No visible diff.</div>
        {:else}
          <div class="history-diff">
            {#each changes as change (change.field)}
              <div class="history-diff-field">{change.field}</div>
              <pre class="history-diff-line removed">- {change.before}</pre>
              <pre class="history-diff-line added">+ {change.after}</pre>
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .history-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  .history-row {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .history-row:last-child {
    border-bottom: none;
  }

  .history-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .history-time {
    font-size: 0.72rem;
    color: var(--text-subtle);
  }

  .history-revert {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 1px 8px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
  }

  .history-revert:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .history-empty {
    color: var(--text-subtle);
    font-size: 0.74rem;
  }

  .history-diff {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .history-diff-field {
    color: var(--text-subtle);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .history-diff-line {
    margin: 0;
    padding: 6px 8px;
    background: var(--bg-input);
    border-radius: 3px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
    line-height: 1.4;
    color: var(--text-muted);
    white-space: pre-wrap;
    max-height: 90px;
    overflow-y: auto;
  }

  .history-diff-line.removed {
    border-left: 2px solid var(--accent-danger-border);
  }

  .history-diff-line.added {
    border-left: 2px solid var(--accent-positive-border);
  }
</style>
