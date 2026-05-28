<script lang="ts">
  import { MODEL_TIERS, type ModelSettings, type ModelTier } from "$lib/types";

  let {
    models,
    onChange,
  }: {
    models: ModelSettings;
    onChange: (next: ModelSettings) => void;
  } = $props();

  const TASKS: { key: keyof ModelSettings; label: string; hint: string }[] = [
    { key: "rank", label: "Paste-match ranking", hint: "Ranks templates when you paste a long message." },
    { key: "edit", label: "Template editor", hint: "Chat-driven edits in the agent editor." },
    { key: "adapt", label: "Adapt to inbound", hint: "Rewrites a template to fit a pasted message." },
    { key: "memory", label: "Memory capture", hint: "Distills pasted threads into a memory." },
    { key: "context", label: "Context indexing", hint: "Summarizes your context files and picks relevant ones." },
  ];

  function setModel(key: keyof ModelSettings, value: ModelTier): void {
    onChange({ ...models, [key]: value });
  }
</script>

<section>
  <div class="section-label">Models per task</div>
  <ul class="model-list">
    {#each TASKS as task (task.key)}
      <li class="model-row">
        <div class="model-meta">
          <span class="model-task">{task.label}</span>
          <span class="model-hint">{task.hint}</span>
        </div>
        <select
          class="model-select"
          value={models[task.key]}
          onchange={(e) => setModel(task.key, e.currentTarget.value as ModelTier)}
        >
          {#each MODEL_TIERS as tier (tier.value)}
            <option value={tier.value}>{tier.label}</option>
          {/each}
        </select>
      </li>
    {/each}
  </ul>
  <div class="hint">
    Pick the Claude model for each AI task. Heavier models are slower and cost more
    (subscription quota or API spend); lighter ones are faster.
  </div>
</section>

<style>
  /* section, section-label, hint — from SettingsModal's :global(.pane-body ...). */

  .model-list {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .model-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .model-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .model-task {
    font-size: 0.86rem;
    color: var(--text);
  }

  .model-hint {
    font-size: 0.76rem;
    color: var(--text-muted);
    line-height: 1.35;
  }

  .model-select {
    flex: 0 0 auto;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 9px;
    border-radius: 5px;
    font: inherit;
    font-size: 0.83rem;
    cursor: pointer;
  }

  .model-select:hover {
    border-color: var(--border-strong);
  }

  .model-select:focus {
    outline: none;
    border-color: var(--border-focus);
  }
</style>
