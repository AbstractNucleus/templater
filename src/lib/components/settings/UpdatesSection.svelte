<script lang="ts">
  type UpdateInfo = {
    version: string;
    currentVersion: string;
    notes: string;
    install: (onProgress?: (received: number, total: number | null) => void) => Promise<void>;
  };

  type UpdateState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "up-to-date" }
    | { kind: "available"; info: UpdateInfo }
    | { kind: "downloading"; received: number; total: number | null }
    | { kind: "installing" }
    | { kind: "error"; error: string };

  let {
    currentVersion,
    onCheckUpdate,
  }: {
    currentVersion: string;
    onCheckUpdate: () => Promise<UpdateInfo | null>;
  } = $props();

  let updateState = $state<UpdateState>({ kind: "idle" });

  async function handleCheckUpdate(): Promise<void> {
    updateState = { kind: "checking" };
    try {
      const info = await onCheckUpdate();
      updateState = info === null ? { kind: "up-to-date" } : { kind: "available", info };
    } catch (e) {
      updateState = { kind: "error", error: String(e) };
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    if (updateState.kind !== "available") return;
    const info = updateState.info;
    updateState = { kind: "downloading", received: 0, total: null };
    try {
      await info.install((received, total) => {
        updateState = { kind: "downloading", received, total };
      });
      updateState = { kind: "installing" };
    } catch (e) {
      updateState = { kind: "error", error: String(e) };
    }
  }

  function dismissUpdate(): void {
    updateState = { kind: "idle" };
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<section>
  <div class="section-label">Updates</div>
  <div class="hint">Current version: <code>{currentVersion}</code></div>

  {#if updateState.kind === "idle"}
    <div class="port-row">
      <button class="port-btn" onclick={handleCheckUpdate}>Check for updates</button>
    </div>
  {:else if updateState.kind === "checking"}
    <div class="hint">Checking…</div>
  {:else if updateState.kind === "up-to-date"}
    <div class="port-message">You're on the latest version.</div>
    <div class="port-row">
      <button class="port-btn" onclick={handleCheckUpdate}>Check again</button>
    </div>
  {:else if updateState.kind === "available"}
    <div class="hint">
      <strong>v{updateState.info.version}</strong> is available
      (you're on v{updateState.info.currentVersion}).
    </div>
    {#if updateState.info.notes}
      <pre class="release-notes">{updateState.info.notes}</pre>
    {/if}
    <div class="port-row">
      <button class="port-btn" onclick={handleInstallUpdate}>Install &amp; restart</button>
      <button class="port-btn" onclick={dismissUpdate}>Skip</button>
    </div>
  {:else if updateState.kind === "downloading"}
    <div class="hint">
      Downloading…
      {#if updateState.total}
        {formatBytes(updateState.received)} / {formatBytes(updateState.total)}
        ({Math.round((updateState.received / updateState.total) * 100)}%)
      {:else}
        {formatBytes(updateState.received)}
      {/if}
    </div>
  {:else if updateState.kind === "installing"}
    <div class="hint">Installing… the app will restart momentarily.</div>
  {:else if updateState.kind === "error"}
    <div class="capture-error">{updateState.error}</div>
    <div class="port-row">
      <button class="port-btn" onclick={handleCheckUpdate}>Try again</button>
      <button class="port-btn" onclick={dismissUpdate}>Dismiss</button>
    </div>
  {/if}
</section>

<style>
  /* section / label / hint / code / port-btn / port-row / port-message /
     capture-error inherited from .pane-body. */

  .release-notes {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    margin: 8px 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 180px;
    overflow-y: auto;
  }
</style>
