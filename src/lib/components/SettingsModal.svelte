<script lang="ts">
  import type { Settings, Theme } from "$lib/types";
  import { setHotkey } from "$lib/api";

  let {
    settings,
    envApiKeyOverride,
    onClose,
    onUpdate,
  }: {
    settings: Settings;
    envApiKeyOverride: boolean;
    onClose: () => void;
    onUpdate: (next: Settings) => void;
  } = $props();

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
      <div class="section-label">Auth</div>
      {#if envApiKeyOverride}
        <div class="warning">
          <strong>ANTHROPIC_API_KEY is set in your environment.</strong>
          The SDK will bill against API rates, not your Claude subscription credit pool.
          Unset the env var to use subscription credits.
        </div>
      {:else}
        <div class="hint">
          Using Claude subscription via Agent SDK. Sign in via <code>claude login</code> if paste-match fails.
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
</style>
