<script lang="ts">
  import { type Mode, type PasteBackend, type Settings, type Theme } from "$lib/types";
  import { setHotkey, setQuickCaptureHotkey, type BackupEntry } from "$lib/api";
  import BackendSection from "./settings/BackendSection.svelte";
  import TagsSection from "./settings/TagsSection.svelte";
  import BackupsSection from "./settings/BackupsSection.svelte";
  import WindowSection from "./settings/WindowSection.svelte";
  import HotkeySection from "./settings/HotkeySection.svelte";
  import DiagnosticsSection from "./settings/DiagnosticsSection.svelte";
  import UpdatesSection from "./settings/UpdatesSection.svelte";
  import SettingsGeneral from "./settings/SettingsGeneral.svelte";
  import SettingsContext from "./settings/SettingsContext.svelte";
  import SettingsTemplates from "./settings/SettingsTemplates.svelte";
  import SettingsUpdates from "./settings/SettingsUpdates.svelte";
  import SettingsDiagnostics from "./settings/SettingsDiagnostics.svelte";

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
    onImportTemplates: () => Promise<PortResult>;
    onCheckUpdate: () => Promise<UpdateInfo | null>;
    onListBackups: () => Promise<BackupEntry[]>;
    onRestoreBackup: (name: string) => Promise<void>;
    /** Rename `from` to `to` across every template that uses it. */
    onRenameTag: (from: string, to: string) => Promise<void>;
    /** Strip `tag` from every template that has it. */
    onDeleteTag: (tag: string) => Promise<void>;
    onOpenCheatSheet: () => void;
  } = $props();

  let portMessage = $state<string | null>(null);
  let portError = $state<string | null>(null);
  let portBusy = $state(false);
  let activeTab = $state<"general" | "context" | "templates" | "diagnostics" | "updates">("general");

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

  // Hotkey capture state lives at the parent level: the window-level keydown
  // handler below drains Escape across the modal (capture → rename → delete
  // confirm → close), and it has to mutate this state directly.
  let capturing = $state(false);
  let captureError = $state<string | null>(null);
  // Distinct from `capturing` so the two rebinders don't interfere with each
  // other when both are exposed in the modal.
  let captureCapturing = $state<"none" | "main" | "quick">("none");

  function updateSignature(next: string): void {
    onUpdate({ ...settings, global_signature: next });
  }

  // Snippet management. The persisted shape is Record<string, string>, but
  // rendering needs a stable order — turn it into [key, value] tuples and
  // commit a Record back on every edit. A blank trailing row appears so the
  // user always has somewhere to type the next snippet.
  let snippetRows = $state<Array<{ key: string; value: string }>>([]);

  // Sync local draft to settings whenever the props change (open / load /
  // remote update). Drops empties on the way in so the UI shows exactly what's
  // persisted; a single blank row is appended below.
  $effect(() => {
    const persisted = settings.snippets ?? {};
    snippetRows = Object.entries(persisted).map(([key, value]) => ({ key, value }));
  });

  function commitSnippets(rows: Array<{ key: string; value: string }>): void {
    const next: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (k.length === 0) continue;
      next[k] = r.value;
    }
    onUpdate({ ...settings, snippets: next });
  }

  function updateSnippetKey(idx: number, key: string): void {
    snippetRows[idx] = { ...snippetRows[idx], key };
    commitSnippets(snippetRows);
  }

  function updateSnippetValue(idx: number, value: string): void {
    snippetRows[idx] = { ...snippetRows[idx], value };
    commitSnippets(snippetRows);
  }

  function removeSnippet(idx: number): void {
    snippetRows = snippetRows.filter((_, i) => i !== idx);
    commitSnippets(snippetRows);
  }

  function addSnippetRow(): void {
    snippetRows = [...snippetRows, { key: "", value: "" }];
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
  onkeydown={(e) => e.key === "Escape" && onClose()}
>
  <div class="modal">
    <header>
      <h2>Settings</h2>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </header>

    <nav class="settings-tabs" aria-label="Settings sections">
      <button class:active={activeTab === "general"} onclick={() => (activeTab = "general")}>General</button>
      <button class:active={activeTab === "context"} onclick={() => (activeTab = "context")}>Context</button>
      <button class:active={activeTab === "templates"} onclick={() => (activeTab = "templates")}>Templates</button>
      <button class:active={activeTab === "diagnostics"} onclick={() => (activeTab = "diagnostics")}>Diagnostics</button>
      <button class:active={activeTab === "updates"} onclick={() => (activeTab = "updates")}>Updates</button>
    </nav>

    {#if activeTab === "general"}
      <SettingsGeneral>
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

    <BackendSection
      backend={settings.paste_backend}
      {envApiKeyOverride}
      onChange={setPasteBackend}
    />

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
      <div class="section-label">Global snippets</div>
      {#if snippetRows.length > 0}
        <ul class="snippet-list">
          {#each snippetRows as row, idx (idx)}
            <li class="snippet-row">
              <input
                class="snippet-input snippet-key"
                type="text"
                placeholder="key (e.g. me_name)"
                value={row.key}
                oninput={(e) => updateSnippetKey(idx, e.currentTarget.value)}
              />
              <input
                class="snippet-input snippet-value"
                type="text"
                placeholder="expansion"
                value={row.value}
                oninput={(e) => updateSnippetValue(idx, e.currentTarget.value)}
              />
              <button
                class="snippet-remove"
                title="Remove snippet"
                aria-label="Remove snippet"
                onclick={() => removeSnippet(idx)}
              >×</button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="port-row">
        <button class="port-btn" onclick={addSnippetRow}>+ Add snippet</button>
      </div>
      <div class="hint">
        Snippets expand at copy time alongside <code>{"{{date}}"}</code> /
        <code>{"{{time}}"}</code>. Use the key as the placeholder name —
        <code>{"{{me_name}}"}</code> with key <code>me_name</code> expands to its value.
        Per-template fills override snippets.
      </div>
    </section>
      </SettingsGeneral>
    {/if}

    {#if activeTab === "templates"}
      <SettingsTemplates>
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
      </SettingsTemplates>
    {/if}

    {#if activeTab === "general"}
      <SettingsGeneral>
    <WindowSection {settings} {onUpdate} />

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
      </SettingsGeneral>
    {/if}

    {#if activeTab === "context"}
      <SettingsContext>
        <section>
          <div class="section-label">Context sources</div>
          {#if settings.context_sources.length === 0}
            <div class="hint">No context folders configured. Add folders from the Context pane.</div>
          {:else}
            <ul class="context-source-list">
              {#each settings.context_sources as source (source)}
                <li>{source}</li>
              {/each}
            </ul>
          {/if}
          <div class="hint">
            These folders are indexed lazily by the sidecar and used during adapt/edit calls.
          </div>
        </section>
      </SettingsContext>
    {/if}

    {#if activeTab === "diagnostics"}
      <SettingsDiagnostics>
        <DiagnosticsSection />
      </SettingsDiagnostics>
    {/if}

    {#if activeTab === "updates"}
      <SettingsUpdates>
        <UpdatesSection {currentVersion} {onCheckUpdate} />
      </SettingsUpdates>
    {/if}
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

  .settings-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }

  .settings-tabs button {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 0.76rem;
  }

  .settings-tabs button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .settings-tabs button.active {
    background: var(--bg-active);
    color: var(--text-strong);
    border-color: var(--border);
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

  .snippet-list {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .snippet-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .snippet-input {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 8px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  }

  .snippet-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .snippet-key {
    flex: 0 0 130px;
  }

  .snippet-value {
    flex: 1;
    min-width: 0;
  }

  .snippet-remove {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
    line-height: 1;
    padding: 0;
    flex-shrink: 0;
  }

  .snippet-remove:hover {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .context-source-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
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
</style>
