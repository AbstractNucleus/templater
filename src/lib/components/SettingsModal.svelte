<script lang="ts">
  import type { PortResult, Settings } from "$lib/types";
  import type { BackupEntry, UpdateInfo } from "$lib/api";
  import TagsSection from "./settings/TagsSection.svelte";
  import BackupsSection from "./settings/BackupsSection.svelte";
  import WindowSection from "./settings/WindowSection.svelte";
  import HotkeySection from "./settings/HotkeySection.svelte";
  import UpdatesSection from "./settings/UpdatesSection.svelte";
  import GeneralSection from "./settings/GeneralSection.svelte";
  import TranslationSection from "./settings/TranslationSection.svelte";
  import SnippetsSection from "./settings/SnippetsSection.svelte";
  import ImportExportSection from "./settings/ImportExportSection.svelte";

  type TabId =
    | "general"
    | "translation"
    | "shortcuts"
    | "snippets"
    | "templates"
    | "about";

  let {
    settings,
    currentVersion,
    tagCounts,
    onClose,
    onUpdate,
    onExportTemplates,
    onImportTemplates,
    onCheckUpdate,
    onListBackups,
    onRestoreBackup,
    onRenameTag,
    onDeleteTag,
    onOpenCheatSheet,
  }: {
    settings: Settings;
    currentVersion: string;
    tagCounts: [string, number][];
    onClose: () => void;
    onUpdate: (next: Settings) => void;
    onExportTemplates: () => Promise<PortResult>;
    onImportTemplates: (overwrite: boolean) => Promise<PortResult>;
    onCheckUpdate: () => Promise<UpdateInfo | null>;
    onListBackups: () => Promise<BackupEntry[]>;
    onRestoreBackup: (name: string) => Promise<void>;
    onRenameTag: (from: string, to: string) => Promise<void>;
    onDeleteTag: (tag: string) => Promise<void>;
    onOpenCheatSheet: () => void;
  } = $props();

  let activeTab = $state<TabId>("general");

  const TAB_GROUPS: { id: TabId; label: string }[][] = [
    [
      { id: "general", label: "General" },
      { id: "translation", label: "Translation" },
      { id: "shortcuts", label: "Shortcuts" },
    ],
    [{ id: "snippets", label: "Snippets" }],
    [{ id: "templates", label: "Templates" }],
    [{ id: "about", label: "About" }],
  ];

  const TAB_TITLES: Record<TabId, string> = {
    general: "General",
    translation: "Translation",
    shortcuts: "Shortcuts",
    snippets: "Signature & snippets",
    templates: "Templates",
    about: "About",
  };

  let hotkeyCapturing = $state(false);
  let renamingTag = $state<string | null>(null);
  let confirmingDeleteTag = $state<string | null>(null);

  function handleBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  let modalEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    const prev = document.activeElement;
    modalEl?.querySelector<HTMLElement>(".sidebar-tab.active")?.focus();
    return () => {
      if (prev instanceof HTMLElement) prev.focus();
    };
  });

  function trapTab(e: KeyboardEvent): void {
    if (e.key !== "Tab" || !modalEl) return;
    const nodes = modalEl.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleModalKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    if (hotkeyCapturing) return;
    if (renamingTag) return;
    if (confirmingDeleteTag) {
      confirmingDeleteTag = null;
      e.preventDefault();
      return;
    }
    e.preventDefault();
    onClose();
  }
</script>

<svelte:window onkeydown={handleModalKeydown} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Settings"
  tabindex="-1"
  onclick={handleBackdrop}
  onkeydown={trapTab}
>
  <div class="modal" bind:this={modalEl}>
    <aside class="sidebar" aria-label="Settings sections">
      <div class="sidebar-header">
        <span class="sidebar-title">Settings</span>
      </div>
      <div class="sidebar-nav" role="tablist" aria-orientation="vertical">
        {#each TAB_GROUPS as group, gi (gi)}
          {#if gi > 0}
            <div class="sidebar-divider" aria-hidden="true"></div>
          {/if}
          {#each group as tab (tab.id)}
            <button
              class="sidebar-tab"
              class:active={activeTab === tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onclick={() => (activeTab = tab.id)}
            >
              {tab.label}
            </button>
          {/each}
        {/each}
      </div>
    </aside>

    <div class="pane" role="tabpanel">
      <header class="pane-header">
        <h2>{TAB_TITLES[activeTab]}</h2>
        <button class="close" onclick={onClose} aria-label="Close">×</button>
      </header>

      <div class="pane-body">
        {#if activeTab === "general"}
          <GeneralSection {settings} {onUpdate} />
          <WindowSection {settings} {onUpdate} />
        {/if}

        {#if activeTab === "translation"}
          <TranslationSection {settings} {onUpdate} />
        {/if}

        {#if activeTab === "shortcuts"}
          <HotkeySection {settings} {onUpdate} bind:capturing={hotkeyCapturing} />

          <section>
            <div class="section-label">Keyboard shortcuts</div>
            <div class="port-row">
              <button class="port-btn" onclick={onOpenCheatSheet}>Show cheat sheet</button>
            </div>
            <div class="hint">Or press <code>?</code> any time the search isn't focused.</div>
          </section>
        {/if}

        {#if activeTab === "snippets"}
          <SnippetsSection {settings} {onUpdate} />
        {/if}

        {#if activeTab === "templates"}
          <ImportExportSection {settings} {onExportTemplates} {onImportTemplates} />

          {#if settings.mode === "editor"}
            <TagsSection
              {tagCounts}
              bind:renamingTag
              bind:confirmingDeleteTag
              {onRenameTag}
              {onDeleteTag}
            />
          {/if}

          <BackupsSection
            mode={settings.mode}
            {onListBackups}
            {onRestoreBackup}
          />
        {/if}

        {#if activeTab === "about"}
          <UpdatesSection {currentVersion} {onCheckUpdate} />
        {/if}
      </div>
    </div>
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
    animation: backdrop-in 120ms ease-out;
  }

  .modal {
    display: grid;
    grid-template-columns: 184px 1fr;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(780px, calc(100vw - 48px));
    height: min(620px, calc(100vh - 80px));
    box-shadow: 0 24px 60px var(--shadow);
    color: var(--text);
    overflow: hidden;
    animation: modal-in 140ms ease-out;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: scale(0.985) translateY(4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* Sidebar */
  .sidebar {
    background: var(--bg-elevated);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .sidebar-header {
    padding: 16px 16px 10px;
  }

  .sidebar-title {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-deemphasis);
    font-weight: 600;
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 8px 12px;
    overflow-y: auto;
    flex: 1;
  }

  .sidebar-divider {
    height: 1px;
    background: var(--border);
    margin: 8px 4px;
  }

  .sidebar-tab {
    text-align: left;
    background: transparent;
    color: var(--text-muted);
    border: none;
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.2;
    position: relative;
  }

  .sidebar-tab:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sidebar-tab.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }

  .sidebar-tab.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 5px;
    bottom: 5px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent-brand);
  }

  /* Right pane */
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
  }

  .pane-header h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-strong);
    letter-spacing: -0.005em;
  }

  .close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
    border-radius: 4px;
  }

  .close:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .pane-body {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  /* Shared section styles — global so child section components inherit them
     without each one re-declaring the same ~80 lines. Scoped to .pane-body
     so they don't leak to the rest of the app. */
  :global(.pane-body section) {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  :global(.pane-body section:last-of-type) {
    border-bottom: none;
  }

  :global(.pane-body .section-label) {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
    margin-bottom: 8px;
    font-weight: 600;
  }

  :global(.pane-body .hint) {
    color: var(--text-muted);
    font-size: 0.82rem;
    line-height: 1.45;
  }

  :global(.pane-body code) {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    color: var(--text);
  }

  :global(.pane-body .capture-error) {
    color: var(--accent-danger-text);
    font-size: 0.78rem;
    margin-top: 6px;
  }

  :global(.pane-body .port-row) {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  :global(.pane-body .port-btn) {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 14px;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    transition: background 0.08s ease, border-color 0.08s ease;
  }

  :global(.pane-body .port-btn:hover:not(:disabled)) {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  :global(.pane-body .port-btn:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  :global(.pane-body .port-message) {
    color: var(--accent-positive-text);
    background: var(--accent-positive-bg);
    border: 1px solid var(--accent-positive-border);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 0.8rem;
    margin-bottom: 6px;
  }

  /* Segmented toggle — used for binary choices (Editor/User, Dark/Light). */
  :global(.pane-body .seg-toggle) {
    display: inline-flex;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 2px;
    gap: 2px;
  }

  :global(.pane-body .seg-btn) {
    background: transparent;
    border: none;
    color: var(--text-muted);
    padding: 5px 14px;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.83rem;
    transition: background 0.1s ease, color 0.1s ease;
    min-width: 84px;
  }

  :global(.pane-body .seg-btn:hover:not(.active)) {
    color: var(--text);
  }

  :global(.pane-body .seg-btn.active) {
    background: var(--accent-brand-soft);
    color: var(--accent-brand-text);
    box-shadow: inset 0 0 0 1px var(--accent-brand);
  }

</style>