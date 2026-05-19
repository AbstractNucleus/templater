<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  let response = $state<string>("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function pingSidecar(): Promise<void> {
    busy = true;
    error = null;
    try {
      const result = await invoke<Record<string, unknown>>("ping_sidecar");
      response = JSON.stringify(result, null, 2);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <h1>templates-widget</h1>
  <p class="subtitle">Sidecar IPC scaffold — round-trip ping.</p>

  <button onclick={pingSidecar} disabled={busy}>
    {busy ? "Pinging…" : "Ping sidecar"}
  </button>

  {#if error}
    <pre class="error">{error}</pre>
  {:else if response}
    <pre class="response">{response}</pre>
  {/if}
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #1a1a1a;
    color: #e6e6e6;
    font-family: Inter, system-ui, sans-serif;
  }

  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .subtitle {
    margin: 0 0 2rem;
    color: #888;
    font-size: 0.9rem;
  }

  button {
    background: #2a2a2a;
    color: #e6e6e6;
    border: 1px solid #3a3a3a;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }

  button:hover:not(:disabled) {
    background: #333;
    border-color: #4a4a4a;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  pre {
    margin-top: 1.5rem;
    padding: 0.75rem 1rem;
    background: #0f0f0f;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.85rem;
    overflow-x: auto;
  }

  .error {
    border-color: #6b2a2a;
    color: #ff8a8a;
  }
</style>
