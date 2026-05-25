<script lang="ts">
  import type { PasteBackend } from "$lib/types";
  import { openClaudeLogin } from "$lib/api";

  let {
    backend,
    envApiKeyOverride,
    onChange,
  }: {
    backend: PasteBackend;
    envApiKeyOverride: boolean;
    onChange: (next: PasteBackend) => void;
  } = $props();

  let claudeLoginBusy = $state(false);
  let claudeLoginError = $state<string | null>(null);
  async function handleClaudeLogin(): Promise<void> {
    claudeLoginBusy = true;
    claudeLoginError = null;
    try {
      await openClaudeLogin();
    } catch (e) {
      claudeLoginError = String(e);
    } finally {
      claudeLoginBusy = false;
    }
  }
</script>

<section>
  <div class="section-label">Paste-match backend</div>
  <div class="theme-toggle">
    <button
      class="theme-btn"
      class:active={backend === "agent"}
      onclick={() => onChange("agent")}
    >
      Agent SDK
    </button>
    <button
      class="theme-btn"
      class:active={backend === "api"}
      onclick={() => onChange("api")}
    >
      Anthropic API
    </button>
  </div>
  {#if backend === "agent"}
    <div class="hint">
      Uses your Claude subscription via the Agent SDK — bills against the subscription
      credit pool even when <code>ANTHROPIC_API_KEY</code> is set.
    </div>
    <div class="port-row">
      <button class="port-btn" disabled={claudeLoginBusy} onclick={handleClaudeLogin}>
        {claudeLoginBusy ? "Opening terminal…" : "Sign in to Claude"}
      </button>
    </div>
    {#if claudeLoginError}
      <div class="capture-error">{claudeLoginError}</div>
    {:else}
      <div class="hint">
        Opens a terminal running <code>claude login</code>. Complete the auth flow there;
        the app picks up the new session on the next paste-match call.
      </div>
    {/if}
  {:else if envApiKeyOverride}
    <div class="hint">
      Calls Anthropic's Messages API directly with <code>ANTHROPIC_API_KEY</code>. Billed at
      standard API rates.
    </div>
  {:else}
    <div class="warning">
      <strong>ANTHROPIC_API_KEY is not set.</strong>
      Paste-match in API mode will fail until you set the env var and restart the app.
    </div>
  {/if}
</section>

<style>
  section {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  section:last-of-type {
    border-bottom: none;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
    margin-bottom: 8px;
  }

  .warning {
    background: var(--accent-warning-bg);
    border: 1px solid var(--accent-warning-border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--accent-warning-text);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .warning strong {
    color: var(--accent-warning-strong);
    display: block;
    margin-bottom: 2px;
  }

  .hint {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  code {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    color: var(--text);
  }

  .capture-error {
    color: var(--accent-danger-text);
    font-size: 0.78rem;
    margin-top: 6px;
  }

  .theme-toggle {
    display: flex;
    gap: 6px;
  }

  .theme-btn {
    flex: 1;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .theme-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .theme-btn.active {
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .port-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .port-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .port-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .port-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }
</style>
