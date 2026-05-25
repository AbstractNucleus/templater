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
    The newest 5 templates.json backups are kept. Restoring keeps your settings and
    backs up the current templates first, so undoing a restore is one more restore away.
  </div>
  <div class="port-row">
    <button class="port-btn" onclick={() => void openDataDir()}>Open data folder</button>
  </div>
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

  .hint {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .capture-error {
    color: var(--accent-danger-text);
    font-size: 0.78rem;
    margin-top: 6px;
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
    border-radius: 4px;
    overflow: hidden;
  }

  .backup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
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
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 8px;
    font-size: 0.82rem;
    line-height: 1.45;
  }

  .restore-confirm .port-row {
    margin-top: 8px;
    margin-bottom: 0;
  }
</style>
