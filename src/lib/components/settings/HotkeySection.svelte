<script lang="ts">
  import type { Settings } from "$lib/types";
  import { DEFAULT_SETTINGS } from "$lib/types";
  import { setHotkey, setQuickCaptureHotkey } from "$lib/api";

  let {
    settings,
    captureCapturing,
    captureError = $bindable(),
    onUpdate,
    onStartCapture,
  }: {
    settings: Settings;
    /** Owned by the parent so the window-level keydown handler can write to it. */
    captureCapturing: "none" | "main" | "quick";
    /** Bound to the parent: the keydown handler writes errors here, this section
     *  also writes to it from the reset / clear paths. */
    captureError: string | null;
    onUpdate: (next: Settings) => void;
    /** Tell the parent to enter capture mode. The parent's keydown handler
     *  picks up the next non-modifier keypress and commits the binding. */
    onStartCapture: (target: "main" | "quick") => void;
  } = $props();

  const isDefaultHotkey = $derived(settings.global_hotkey === DEFAULT_SETTINGS.global_hotkey);

  async function resetHotkey(): Promise<void> {
    captureError = null;
    try {
      await setHotkey(DEFAULT_SETTINGS.global_hotkey);
      onUpdate({ ...settings, global_hotkey: DEFAULT_SETTINGS.global_hotkey });
    } catch (err) {
      captureError = String(err);
    }
  }

  async function clearQuickCapture(): Promise<void> {
    captureError = null;
    try {
      await setQuickCaptureHotkey(null);
      onUpdate({ ...settings, quick_capture_hotkey: null });
    } catch (err) {
      captureError = String(err);
    }
  }
</script>

<section>
  <div class="section-label">Hotkey</div>
  <div class="row readonly">
    {#if captureCapturing === "main"}
      <span class="key capturing">Press keys… (Esc to cancel)</span>
    {:else}
      <span class="key">{settings.global_hotkey}</span>
      <button class="rebind" onclick={() => onStartCapture("main")}>Rebind</button>
      {#if !isDefaultHotkey}
        <button class="rebind" onclick={() => void resetHotkey()}>Reset</button>
      {/if}
    {/if}
  </div>
  <div class="hint">Toggles the app window from any application.</div>
  <div class="row readonly" style="margin-top: 6px;">
    {#if captureCapturing === "quick"}
      <span class="key capturing">Press keys… (Esc to cancel)</span>
    {:else if settings.quick_capture_hotkey}
      <span class="key">{settings.quick_capture_hotkey}</span>
      <button class="rebind" onclick={() => onStartCapture("quick")}>Rebind</button>
      <button class="rebind" onclick={() => void clearQuickCapture()}>Clear</button>
    {:else}
      <span class="key">— not set —</span>
      <button class="rebind" onclick={() => onStartCapture("quick")}>Set quick-capture</button>
    {/if}
  </div>
  <div class="hint">
    Quick-capture grabs the current clipboard and opens the new-template form with the body
    pre-filled. Disabled in User mode.
  </div>
  {#if captureError}
    <div class="capture-error">{captureError}</div>
  {/if}
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
</style>
