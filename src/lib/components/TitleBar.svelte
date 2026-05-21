<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let { onOpenSettings }: { onOpenSettings: () => void } = $props();

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
    >
      {pinned ? "📌" : "📍"}
    </button>
    <button class="btn" title="Settings" onclick={onOpenSettings}>⚙</button>
    <button class="btn" title="Minimise" onclick={minimise}>—</button>
    <button class="btn close-btn" title="Close to tray" onclick={close}>×</button>
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
