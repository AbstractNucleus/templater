<script lang="ts">
  import type { Settings } from "$lib/types";

  let {
    settings,
  }: {
    settings: Settings;
  } = $props();
</script>

<section>
  <div class="section-label">Context sources</div>
  {#if settings.context_sources.length === 0}
    <div class="hint">No context folders configured. Add folders from the Context pane.</div>
  {:else}
    <ul class="context-source-list">
      {#each settings.context_sources as source (source)}
        <li>{source}</li>
      {/each}
    </ul>
  {/if}
  <div class="hint">
    These folders are indexed lazily by the sidecar and used during adapt/edit calls.
  </div>
</section>

<style>
  /* section / section-label / hint inherited from SettingsModal's
     :global(.pane-body ...) rules. */

  .context-source-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .context-source-list li {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    word-break: break-all;
  }
</style>
