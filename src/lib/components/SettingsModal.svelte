<script lang="ts">
  import type { Mode, PasteBackend, Settings, Theme } from "$lib/types";
  import { setHotkey, type BackupEntry } from "$lib/api";

  type PortResult =
    | { kind: "ok"; message: string }
    | { kind: "cancelled" }
    | { kind: "err"; error: string };

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
    settings,
    envApiKeyOverride,
    currentVersion,
    onClose,
    onUpdate,
    onExportTemplates,
    onImportTemplates,
    onCheckUpdate,
    onListBackups,
    onRestoreBackup,
  }: {
    settings: Settings;
    envApiKeyOverride: boolean;
    currentVersion: string;
    onClose: () => void;
    onUpdate: (next: Settings) => void;
    onExportTemplates: () => Promise<PortResult>;
    onImportTemplates: () => Promise<PortResult>;
    onCheckUpdate: () => Promise<UpdateInfo | null>;
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

  let portMessage = $state<string | null>(null);
  let portError = $state<string | null>(null);
  let portBusy = $state(false);

  async function handleExportClick(): Promise<void> {
    if (portBusy) return;
    portBusy = true;
    portMessage = null;
    portError = null;
    try {
      const r = await onExportTemplates();
      if (r.kind === "ok") portMessage = r.message;
      else if (r.kind === "err") portError = r.error;
    } finally {
      portBusy = false;
    }
  }

  async function handleImportClick(): Promise<void> {
    if (portBusy) return;
    portBusy = true;
    portMessage = null;
    portError = null;
    try {
      const r = await onImportTemplates();
      if (r.kind === "ok") portMessage = r.message;
      else if (r.kind === "err") portError = r.error;
    } finally {
      portBusy = false;
    }
  }

  let capturing = $state(false);
  let captureError = $state<string | null>(null);

  function toggleAlwaysOnTop(next: boolean): void {
    onUpdate({ ...settings, always_on_top_default: next });
  }

  function toggleStartMinimised(next: boolean): void {
    onUpdate({ ...settings, start_minimised_to_tray: next });
  }

  function updateSignature(next: string): void {
    onUpdate({ ...settings, global_signature: next });
  }

  function setTheme(next: Theme): void {
    onUpdate({ ...settings, theme: next });
  }

  function setMode(next: Mode): void {
    onUpdate({ ...settings, mode: next });
  }

  function setPasteBackend(next: PasteBackend): void {
    onUpdate({ ...settings, paste_backend: next });
  }

  function handleBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  const MODIFIER_PREFIXES = ["Control", "Shift", "Alt", "Meta", "OS"];

  function isModifierKey(code: string): boolean {
    return MODIFIER_PREFIXES.some((p) => code.startsWith(p));
  }

  function startCapture(): void {
    capturing = true;
    captureError = null;
  }

  async function handleCaptureKeydown(e: KeyboardEvent): Promise<void> {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      capturing = false;
      return;
    }
    if (isModifierKey(e.code)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Cmd");
    if (parts.length === 0) {
      captureError = "Hotkey must include at least one modifier (Ctrl, Shift, Alt, Cmd).";
      capturing = false;
      return;
    }
    parts.push(e.code);
    const accelerator = parts.join("+");

    try {
      await setHotkey(accelerator);
      onUpdate({ ...settings, global_hotkey: accelerator });
      captureError = null;
    } catch (err) {
      captureError = String(err);
    } finally {
      capturing = false;
    }
  }
</script>

<svelte:window onkeydown={handleCaptureKeydown} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Settings"
  tabindex="-1"
  onclick={handleBackdrop}
  onkeydown={(e) => e.key === "Escape" && onClose()}
>
  <div class="modal">
    <header>
      <h2>Settings</h2>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </header>

    <section>
      <div class="section-label">Mode</div>
      <div class="theme-toggle">
        <button
          class="theme-btn"
          class:active={settings.mode === "editor"}
          onclick={() => setMode("editor")}
        >
          Editor
        </button>
        <button
          class="theme-btn"
          class:active={settings.mode === "user"}
          onclick={() => setMode("user")}
        >
          User
        </button>
      </div>
      <div class="hint">
        {#if settings.mode === "editor"}
          Editor mode — full access. You can create, edit, duplicate, and delete templates.
        {:else}
          User mode — read-only. You can browse, "Base on template" to draft a message,
          and copy the result, but you can't save changes to the catalog.
        {/if}
      </div>
    </section>

    <section>
      <div class="section-label">Paste-match backend</div>
      <div class="theme-toggle">
        <button
          class="theme-btn"
          class:active={settings.paste_backend === "agent"}
          onclick={() => setPasteBackend("agent")}
        >
          Agent SDK
        </button>
        <button
          class="theme-btn"
          class:active={settings.paste_backend === "api"}
          onclick={() => setPasteBackend("api")}
        >
          Anthropic API
        </button>
      </div>
      {#if settings.paste_backend === "agent"}
        <div class="hint">
          Uses your Claude subscription via the Agent SDK — bills against the subscription
          credit pool even when <code>ANTHROPIC_API_KEY</code> is set. Sign in via
          <code>claude login</code> if paste-match fails.
        </div>
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

    <section>
      <div class="section-label">Appearance</div>
      <div class="theme-toggle">
        <button
          class="theme-btn"
          class:active={settings.theme === "dark"}
          onclick={() => setTheme("dark")}
        >
          Dark
        </button>
        <button
          class="theme-btn"
          class:active={settings.theme === "light"}
          onclick={() => setTheme("light")}
        >
          Light
        </button>
      </div>
    </section>

    <section>
      <div class="section-label">Global signature</div>
      <textarea
        class="field-textarea"
        rows="3"
        placeholder={"— Your Name\\nyou@example.com"}
        value={settings.global_signature}
        oninput={(e) => updateSignature(e.currentTarget.value)}
      ></textarea>
      <div class="hint">Used when a template's own signature is empty and "Include signature" is on.</div>
    </section>

    <section>
      <div class="section-label">Templates</div>
      <div class="port-row">
        <button class="port-btn" disabled={portBusy} onclick={handleExportClick}>
          Export…
        </button>
        {#if settings.mode === "editor"}
          <button class="port-btn" disabled={portBusy} onclick={handleImportClick}>
            Import…
          </button>
        {/if}
      </div>
      {#if portMessage}
        <div class="port-message">{portMessage}</div>
      {/if}
      {#if portError}
        <div class="capture-error">{portError}</div>
      {/if}
      <div class="hint">
        {#if settings.mode === "editor"}
          Export writes all templates to a JSON file. Import merges by id —
          templates already on this machine are kept and duplicates are skipped.
        {:else}
          Export writes all templates to a JSON file. Import is disabled in User mode.
        {/if}
      </div>
    </section>

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
                disabled={settings.mode !== "editor" || restoreBusy}
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
    </section>

    <section>
      <div class="section-label">Window</div>
      <label class="row">
        <input
          type="checkbox"
          checked={settings.always_on_top_default}
          onchange={(e) => toggleAlwaysOnTop(e.currentTarget.checked)}
        />
        <span>Always on top by default (applies on launch)</span>
      </label>
      <label class="row">
        <input
          type="checkbox"
          checked={settings.start_minimised_to_tray}
          onchange={(e) => toggleStartMinimised(e.currentTarget.checked)}
        />
        <span>Start minimised to tray</span>
      </label>
      {#if settings.window_geometry}
        <div class="hint">
          Window position saved: {settings.window_geometry.x},{settings.window_geometry.y}
          ({settings.window_geometry.width}×{settings.window_geometry.height})
        </div>
      {/if}
    </section>

    <section>
      <div class="section-label">Hotkey</div>
      <div class="row readonly">
        {#if capturing}
          <span class="key capturing">Press keys… (Esc to cancel)</span>
        {:else}
          <span class="key">{settings.global_hotkey}</span>
          <button class="rebind" onclick={startCapture}>Rebind</button>
        {/if}
      </div>
      {#if captureError}
        <div class="capture-error">{captureError}</div>
      {/if}
    </section>

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
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 480px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    color: var(--text);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  header h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }

  .close:hover {
    color: var(--text);
  }

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

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
    margin-bottom: 6px;
  }

  .row:last-of-type {
    margin-bottom: 0;
  }

  .row.readonly {
    cursor: default;
  }

  .row input[type="checkbox"] {
    accent-color: var(--text-muted);
  }

  .key {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 8px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.8rem;
    color: var(--text);
  }

  .key.capturing {
    color: var(--accent-warning-text);
    border-color: var(--accent-warning-border);
  }

  .rebind {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 2px 10px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
  }

  .rebind:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .capture-error {
    color: var(--accent-danger-text);
    font-size: 0.78rem;
    margin-top: 6px;
  }

  .field-textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    line-height: 1.4;
    resize: vertical;
    min-height: 60px;
  }

  .field-textarea:focus {
    outline: none;
    border-color: var(--border-focus);
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

  .port-message {
    color: var(--accent-positive-text);
    background: var(--accent-positive-bg);
    border: 1px solid var(--accent-positive-border);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 0.8rem;
    margin-bottom: 6px;
  }

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

  .port-btn.danger {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .port-btn.danger:hover:not(:disabled) {
    background: var(--accent-danger-border);
  }
</style>
