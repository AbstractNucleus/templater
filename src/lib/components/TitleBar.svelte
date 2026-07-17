<script lang="ts">
  import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";

  let {
    onOpenSettings,
    showSearch,
    searchQuery = "",
    onSearchChange = () => {},
    onClearSearch = () => {},
    onSearchInputMount = () => {},
    minimal = false,
    previewOpen = false,
    onTogglePreview = () => {},
    translatorOpen = false,
    onToggleTranslator = () => {},
  }: {
    onOpenSettings: () => void;
    /** Show the search omnibar slot. */
    showSearch: boolean;
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
    onClearSearch?: () => void;
    /** Fired with the live <input> element so the page's Ctrl+F handler can focus it. */
    onSearchInputMount?: (el: HTMLInputElement | null) => void;
    /** When true, the app is in minimal mode and the pop-out button is shown. */
    minimal?: boolean;
    /** Reflects whether the preview pop-out window is currently visible. */
    previewOpen?: boolean;
    onTogglePreview?: () => void;
    /** Reflects whether the translator pop-out window is currently visible. */
    translatorOpen?: boolean;
    onToggleTranslator?: () => void;
  } = $props();

  let pinned = $state(false);
  let searchEl = $state<HTMLInputElement | undefined>();

  // Rust applies settings.always_on_top_default to the live window before we
  // render, so the button's initial value would otherwise lie. Query the real
  // state once on mount.
  $effect(() => {
    void getCurrentWindow()
      .isAlwaysOnTop()
      .then((v) => (pinned = v))
      .catch(() => {});
  });

  // Hand the live <input> reference back to the page so its existing Ctrl+F
  // shortcut + activeElement checks keep working across the new boundary.
  $effect(() => {
    onSearchInputMount(searchEl ?? null);
    return () => onSearchInputMount(null);
  });

  async function togglePin(): Promise<void> {
    pinned = !pinned;
    try {
      await getCurrentWindow().setAlwaysOnTop(pinned);
      // Mirror to the preview and translator pop-outs so all windows stack together.
      for (const w of await getAllWindows()) {
        if (w.label === "preview" || w.label === "translator") {
          await w.setAlwaysOnTop(pinned).catch(() => {});
        }
      }
    } catch {
      pinned = !pinned;
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

<header class="titlebar">
  <div class="leading" data-tauri-drag-region>
    <span class="brand" data-tauri-drag-region>Templater</span>
  </div>
  {#if showSearch}
    <div class="search-slot">
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          bind:this={searchEl}
          class="search"
          type="text"
          placeholder="Search templates…"
          value={searchQuery}
          oninput={(e) => onSearchChange(e.currentTarget.value)}
        />
        {#if searchQuery.length > 0}
          <button
            class="clear-btn"
            title="Clear (Ctrl+L)"
            aria-label="Clear search"
            onclick={onClearSearch}
          >×</button>
        {/if}
      </div>
    </div>
  {/if}
  <div class="drag-spacer" data-tauri-drag-region></div>
  <div class="actions">
    {#if minimal}
      <button
        class="btn"
        class:active={previewOpen}
        title={previewOpen ? "Hide preview pop-out" : "Show preview pop-out (to the left)"}
        onclick={onTogglePreview}
        aria-label={previewOpen ? "Hide preview pop-out" : "Show preview pop-out"}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 3h7v7" />
          <path d="M21 3l-9 9" />
          <path d="M20 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5" />
        </svg>
      </button>
    {/if}
    <button
      class="btn"
      class:active={translatorOpen}
      title={translatorOpen ? "Hide translator" : "Translate (Ctrl+Shift+T)"}
      onclick={onToggleTranslator}
      aria-label={translatorOpen ? "Hide translator" : "Show translator"}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 8l6 6" />
        <path d="M4 14l6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="M22 21l-5-10-5 10" />
        <path d="M14 18h6" />
      </svg>
    </button>
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
    <button class="btn" title="Settings" onclick={onOpenSettings} aria-label="Settings">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
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
    gap: 12px;
    height: 40px;
    padding: 0 4px 0 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .leading {
    display: flex;
    align-items: center;
    height: 100%;
    flex-shrink: 0;
  }

  .brand {
    color: var(--text-muted);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    font-weight: 500;
  }

  .search-slot {
    display: flex;
    align-items: center;
    height: 100%;
    flex: 0 1 480px;
    min-width: 0;
  }

  .drag-spacer {
    flex: 1;
    align-self: stretch;
    min-width: 12px;
  }

  .search-wrap {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 9px;
    color: var(--text-subtle);
    pointer-events: none;
  }

  .search {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 30px 5px 28px;
    border-radius: 6px;
    font: inherit;
    font-size: 0.82rem;
    height: 28px;
  }

  .search:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }

  .search::placeholder {
    color: var(--text-placeholder);
  }

  .clear-btn {
    position: absolute;
    right: 4px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    font-size: 1rem;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
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