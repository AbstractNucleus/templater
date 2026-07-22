<script lang="ts">
  import type { Mode } from "$lib/types";
  import { openDataDir, type BackupEntry } from "$lib/api";

  let {
    mode,
    onListBackups,
    onRestoreBackup,
  }: {
    mode: Mode;
    onListBackups: () => Promise<BackupEntry[]>;
    onRestoreBackup: (name: string) => Promise<void>;
  } = $props();

  let backups = $state<BackupEntry[] | null>(null);
  let backupsLoading = $state(false);
  let backupsError = $state<string | null>(null);
  let restoreTarget = $state<BackupEntry | null>(null);
  let restoreBusy = $state(false);

  async function loadBackups(): Promise<void> {
    backupsLoading = true;
    backupsError = null;
    try {
      backups = await onListBackups();
    } catch (e) {
      backupsError = String(e);
    } finally {
      backupsLoading = false;
    }
  }

  // Auto-load when the modal opens (effect fires on mount; no deps to track).
  $effect(() => {
    void loadBackups();
  });

  function formatBackupTime(secs: number): string {
    if (secs === 0) return "legacy (pre-rotation)";
    return new Date(secs * 1000).toLocaleString();
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function confirmRestore(): Promise<void> {
    if (!restoreTarget) return;
    restoreBusy = true;
    try {
      await onRestoreBackup(restoreTarget.name);
      restoreTarget = null;
      await loadBackups();
    } catch (e) {
      backupsError = String(e);
    } finally {
      restoreBusy = false;
    }
  }
</script>

<section>
  <div class="section-label">Backups</div>
  {#if restoreTarget}
    <div class="restore-confirm">
      <div>
        Restore templates from <strong>{formatBackupTime(restoreTarget.timestamp_secs)}</strong>?
        The current templates will be saved as a new backup.
      </div>
      <div class="port-row">
        <button class="port-btn danger" disabled={restoreBusy} onclick={confirmRestore}>
          {restoreBusy ? "Restoring…" : "Restore"}
        </button>
        <button class="port-btn" disabled={restoreBusy} onclick={() => (restoreTarget = null)}>
          Cancel
        </button>
      </div>
    </div>
  {/if}
  {#if backupsLoading}
    <div class="hint">Loading…</div>
  {:else if backupsError}
    <div class="capture-error">{backupsError}</div>
  {:else if backups && backups.length > 0}
    <ul class="backup-list">
      {#each backups as b (b.name)}
        <li class="backup-row">
          <div class="backup-meta">
            <span class="backup-time">{formatBackupTime(b.timestamp_secs)}</span>
            <span class="backup-size">{formatBytes(b.size)}</span>
          </div>
          <button
            class="port-btn"
            disabled={mode !== "editor" || restoreBusy}
            onclick={() => (restoreTarget = b)}
          >
            Restore
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="hint">No backups yet — they're created automatically on each save.</div>
  {/if}
  <div class="hint">
    The newest 5 catalog.json backups are kept. Restoring keeps your preferences and
    backs up the current catalog first, so undoing a restore is one more restore away.
  </div>
  <div class="port-row data-folder-row">
    <button class="port-btn" onclick={() => void openDataDir()}>Open data folder</button>
  </div>
</section>

<style>
  /* section / label / hint / port-btn / port-row / capture-error inherited
     from .pane-body. */

  .port-btn.danger {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .port-btn.danger:hover:not(:disabled) {
    background: var(--accent-danger-border);
  }

  .backup-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-input);
  }

  .backup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
  }

  .backup-row:last-child {
    border-bottom: none;
  }

  .backup-meta {
    display: flex;
    gap: 10px;
    align-items: baseline;
    min-width: 0;
  }

  .backup-time {
    color: var(--text);
  }

  .backup-size {
    color: var(--text-subtle);
    font-size: 0.75rem;
  }

  .restore-confirm {
    background: var(--accent-warning-bg);
    border: 1px solid var(--accent-warning-border);
    color: var(--accent-warning-text);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .restore-confirm :global(.port-row) {
    margin-top: 8px;
    margin-bottom: 0;
  }

  .data-folder-row {
    margin-top: 10px;
    margin-bottom: 0;
  }
</style>
