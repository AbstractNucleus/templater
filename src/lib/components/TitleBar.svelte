<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let {
    onOpenSettings,
    onToggleContext,
    contextOpen,
  }: {
    onOpenSettings: () => void;
    onToggleContext: () => void;
    contextOpen: boolean;
  } = $props();

  let pinned = $state(false);

  async function togglePin(): Promise<void> {
    pinned = !pinned;
    try {
      await getCurrentWindow().setAlwaysOnTop(pinned);
    } catch {
      pinned = !pinned;
    }
  }

  async function minimise(): Promise<void> {
    try {
      await getCurrentWindow().minimize();
    } catch {
      /* no-op */
    }
  }

  async function close(): Promise<void> {
    try {
      await getCurrentWindow().close();
    } catch {
      /* no-op */
    }
  }
</script>

<header class="titlebar" data-tauri-drag-region>
  <div class="title" data-tauri-drag-region>Templater</div>
  <div class="actions">
    <button
      class="btn"
      class:active={pinned}
      title={pinned ? "Unpin (currently always on top)" : "Pin always on top"}
      onclick={togglePin}
      aria-label={pinned ? "Unpin window" : "Pin window on top"}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 17v5" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      </svg>
    </button>
    <button
      class="btn"
      class:active={contextOpen}
      title={contextOpen ? "Hide context" : "Show context"}
      aria-pressed={contextOpen}
      aria-label="Toggle context panel"
      onclick={onToggleContext}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </svg>
    </button>
    <button class="btn" title="Settings" onclick={onOpenSettings} aria-label="Settings">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
    <button class="btn" title="Minimise" onclick={minimise} aria-label="Minimise">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
    </button>
    <button class="btn close-btn" title="Close to tray" onclick={close} aria-label="Close to tray">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M6 18L18 6" />
      </svg>
    </button>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 4px 0 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .title {
    flex: 1;
    color: var(--text-muted);
    font-size: 0.75rem;
    letter-spacing: 0.03em;
  }

  .actions {
    display: flex;
    gap: 2px;
    -webkit-app-region: no-drag;
  }

  .btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    width: 28px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn svg {
    display: block;
  }

  .btn.active svg {
    fill: currentColor;
    fill-opacity: 0.15;
  }

  .btn:hover {
    background: var(--bg-hover);
    border-color: var(--border);
    color: var(--text);
  }

  .btn.active {
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .close-btn:hover {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }
</style>
