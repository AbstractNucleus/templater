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
  <div class="seg-toggle">
    <button
      class="seg-btn"
      class:active={backend === "agent"}
      onclick={() => onChange("agent")}
    >
      Agent SDK
    </button>
    <button
      class="seg-btn"
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
  /* section, label, hint, code, port-btn, port-row, capture-error, seg-toggle,
     seg-btn — all provided by SettingsModal's :global(.pane-body ...) rules. */

  .warning {
    background: var(--accent-warning-bg);
    border: 1px solid var(--accent-warning-border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--accent-warning-text);
    font-size: 0.82rem;
    line-height: 1.4;
    margin-top: 4px;
  }

  .warning strong {
    color: var(--accent-warning-strong);
    display: block;
    margin-bottom: 2px;
  }
</style>
