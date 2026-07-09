<script lang="ts">
  import { type ModelSettings, type PasteBackend, type Settings } from "$lib/types";
  import { setHotkey, setQuickCaptureHotkey, type BackupEntry } from "$lib/api";
  import BackendSection from "./settings/BackendSection.svelte";
  import ModelsSection from "./settings/ModelsSection.svelte";
  import TagsSection from "./settings/TagsSection.svelte";
  import BackupsSection from "./settings/BackupsSection.svelte";
  import WindowSection from "./settings/WindowSection.svelte";
  import HotkeySection from "./settings/HotkeySection.svelte";
  import DiagnosticsSection from "./settings/DiagnosticsSection.svelte";
  import UpdatesSection from "./settings/UpdatesSection.svelte";
  import GeneralSection from "./settings/GeneralSection.svelte";
  import SnippetsSection from "./settings/SnippetsSection.svelte";
  import ContextSection from "./settings/ContextSection.svelte";
  import ImportExportSection from "./settings/ImportExportSection.svelte";

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

  type TabId =
    | "general"
    | "shortcuts"
    | "ai"
    | "snippets"
    | "context"
    | "templates"
    | "about";

  let {
    settings,
    envApiKeyOverride,
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
    envApiKeyOverride: boolean;
    currentVersion: string;
    /** Tag name → number of templates using it, sorted by display order. */
    tagCounts: [string, number][];
    onClose: () => void;
    onUpdate: (next: Settings) => void;
    onExportTemplates: () => Promise<PortResult>;
    onImportTemplates: (overwrite: boolean) => Promise<PortResult>;
    onCheckUpdate: () => Promise<UpdateInfo | null>;
    onListBackups: () => Promise<BackupEntry[]>;
    onRestoreBackup: (name: string) => Promise<void>;
    /** Rename `from` to `to` across every template that uses it. */
    onRenameTag: (from: string, to: string) => Promise<void>;
    /** Strip `tag` from every template that has it. */
    onDeleteTag: (tag: string) => Promise<void>;
    onOpenCheatSheet: () => void;
  } = $props();

  let activeTab = $state<TabId>("general");

  // Sidebar groups: visual divider between groups, no labels — 7 items don't
  // need headings, but app vs. writing vs. data is a useful eye anchor.
  const TAB_GROUPS: { id: TabId; label: string }[][] = [
    [
      { id: "general", label: "General" },
      { id: "shortcuts", label: "Shortcuts" },
    ],
    [
      { id: "ai", label: "AI" },
      { id: "snippets", label: "Snippets" },
      { id: "context", label: "Context" },
    ],
    [
      { id: "templates", label: "Templates" },
    ],
    [
      { id: "about", label: "About" },
    ],
  ];

  // AI + Context tabs only exist while AI features are enabled; empty groups
  // collapse so the divider doesn't render around nothing.
  const visibleTabGroups = $derived(
    TAB_GROUPS.map((group) =>
      group.filter((t) => settings.ai_enabled || (t.id !== "ai" && t.id !== "context")),
    ).filter((group) => group.length > 0),
  );

  const TAB_TITLES: Record<TabId, string> = {
    general: "General",
    shortcuts: "Shortcuts",
    ai: "AI",
    snippets: "Signature & snippets",
    context: "Context sources",
    templates: "Templates",
    about: "About",
  };

  // Hotkey capture state lives at the parent level: the window-level keydown
  // handler below drains Escape across the modal (capture → rename → delete
  // confirm → close), and it has to mutate this state directly.
  let capturing = $state(false);
  let captureError = $state<string | null>(null);
  // Distinct from `capturing` so the two rebinders don't interfere with each
  // other when both are exposed in the modal.
  let captureCapturing = $state<"none" | "main" | "quick">("none");

  function setPasteBackend(next: PasteBackend): void {
    onUpdate({ ...settings, paste_backend: next });
  }

  function setModels(next: ModelSettings): void {
    onUpdate({ ...settings, models: next });
  }

  // Tag management state owned here so the Escape handler can drain it before
  // closing the modal. The TagsSection child binds to these via $bindable.
  let renamingTag = $state<string | null>(null);
  // Two-step delete: a tag delete strips it from every template that has it,
  // which can be 50+ rows. Undo covers it but isn't discoverable enough for a
  // silent destructive action — require an explicit second click.
  let confirmingDeleteTag = $state<string | null>(null);

  function handleBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  let modalEl = $state<HTMLDivElement | undefined>();

  // Restore focus to the control that opened Settings once it closes.
  $effect(() => {
    const prev = document.activeElement;
    modalEl?.querySelector<HTMLElement>(".sidebar-tab.active")?.focus();
    return () => {
      if (prev instanceof HTMLElement) prev.focus();
    };
  });

  // Minimal focus trap. Escape is handled by the window-level
  // handleCaptureKeydown, which drains nested states (hotkey capture, tag
  // rename/delete) before closing — so the backdrop must NOT close on Escape
  // itself or it would slam the modal shut mid-capture.
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

  const MODIFIER_PREFIXES = ["Control", "Shift", "Alt", "Meta", "OS"];

  function isModifierKey(code: string): boolean {
    return MODIFIER_PREFIXES.some((p) => code.startsWith(p));
  }

  function startCapture(target: "main" | "quick" = "main"): void {
    captureCapturing = target;
    capturing = target === "main";
    captureError = null;
  }

  async function handleCaptureKeydown(e: KeyboardEvent): Promise<void> {
    // Escape lives at the window level so it works without the user clicking
    // into the modal first. Drains nested states (capture → rename → delete
    // confirm) before closing the modal itself.
    if (e.key === "Escape") {
      if (captureCapturing !== "none") {
        captureCapturing = "none";
        capturing = false;
        e.preventDefault();
        return;
      }
      // The rename input has its own Escape handler — let it run.
      if (renamingTag) return;
      if (confirmingDeleteTag) {
        confirmingDeleteTag = null;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      onClose();
      return;
    }
    if (captureCapturing === "none") return;
    e.preventDefault();
    e.stopPropagation();
    if (isModifierKey(e.code)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Cmd");
    if (parts.length === 0) {
      captureError = "Hotkey must include at least one modifier (Ctrl, Shift, Alt, Cmd).";
      captureCapturing = "none";
      capturing = false;
      return;
    }
    parts.push(e.code);
    const accelerator = parts.join("+");

    try {
      if (captureCapturing === "quick") {
        await setQuickCaptureHotkey(accelerator);
        onUpdate({ ...settings, quick_capture_hotkey: accelerator });
      } else {
        await setHotkey(accelerator);
        onUpdate({ ...settings, global_hotkey: accelerator });
      }
      captureError = null;
    } catch (err) {
      captureError = String(err);
    } finally {
      captureCapturing = "none";
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
  onkeydown={trapTab}
>
  <div class="modal" bind:this={modalEl}>
    <aside class="sidebar" aria-label="Settings sections">
      <div class="sidebar-header">
        <span class="sidebar-title">Settings</span>
      </div>
      <div class="sidebar-nav" role="tablist" aria-orientation="vertical">
        {#each visibleTabGroups as group, gi (gi)}
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

        {#if activeTab === "shortcuts"}
          <HotkeySection
            {settings}
            {captureCapturing}
            bind:captureError
            {onUpdate}
            onStartCapture={startCapture}
          />

          <section>
            <div class="section-label">Keyboard shortcuts</div>
            <div class="port-row">
              <button class="port-btn" onclick={onOpenCheatSheet}>Show cheat sheet</button>
            </div>
            <div class="hint">Or press <code>?</code> any time the search isn't focused.</div>
          </section>
        {/if}

        {#if activeTab === "ai"}
          <BackendSection
            backend={settings.paste_backend}
            {envApiKeyOverride}
            onChange={setPasteBackend}
          />
          <ModelsSection models={settings.models} onChange={setModels} />
        {/if}

        {#if activeTab === "snippets"}
          <SnippetsSection {settings} {onUpdate} />
        {/if}

        {#if activeTab === "context"}
          <ContextSection {settings} />
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
          {#if settings.ai_enabled}
            <DiagnosticsSection />
          {/if}
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

  /* Segmented toggle — used for binary choices (Editor/User, Dark/Light,
     Agent/API). Active state uses the brand color so the selection reads as
     identity, not status. */
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
