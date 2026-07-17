<script lang="ts">
  import type { Settings } from "$lib/types";
  import { DEFAULT_SETTINGS } from "$lib/types";
  import { setHotkey } from "$lib/api";

  let {
    settings,
    captureCapturing,
    captureError = $bindable(),
    onUpdate,
    onStartCapture,
  }: {
    settings: Settings;
    /** Owned by the parent so the window-level keydown handler can write to it. */
    captureCapturing: "none" | "main" | "preview";
    /** Bound to the parent: the keydown handler writes errors here, this section
     *  also writes to it from the reset / clear paths. */
    captureError: string | null;
    onUpdate: (next: Settings) => void;
    /** Tell the parent to enter capture mode for the named target. The parent's
     *  keydown handler picks up the next non-modifier keypress and commits the
     *  binding. "preview" allows bare keys (no modifier required). */
    onStartCapture: (target: "main" | "preview") => void;
  } = $props();

  const isDefaultHotkey = $derived(settings.global_hotkey === DEFAULT_SETTINGS.global_hotkey);
  const isDefaultPreview = $derived(settings.preview_hotkey === DEFAULT_SETTINGS.preview_hotkey);

  // Friendly labels for the codes the capture handler stores. The accelerator
  // string uses DOM KeyboardEvent.code values; render the human glyph instead.
  const KEY_LABELS: Record<string, string> = {
    Backslash: "\\",
    Slash: "/",
    Period: ".",
    Comma: ",",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "⌫",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };

  function keyLabel(code: string): string {
    if (code in KEY_LABELS) return KEY_LABELS[code];
    if (code.startsWith("Key") && code.length === 4) return code.slice(3);
    if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
    if (code.startsWith("Numpad") && code.length === 7) return code.slice(6);
    return code;
  }

  function splitAccelerator(s: string): string[] {
    return s.split("+").filter((p) => p.length > 0);
  }

  async function resetHotkey(): Promise<void> {
    captureError = null;
    try {
      await setHotkey(DEFAULT_SETTINGS.global_hotkey);
      onUpdate({ ...settings, global_hotkey: DEFAULT_SETTINGS.global_hotkey });
    } catch (err) {
      captureError = String(err);
    }
  }

  function resetPreviewHotkey(): void {
    captureError = null;
    onUpdate({ ...settings, preview_hotkey: DEFAULT_SETTINGS.preview_hotkey });
  }
</script>

<section>
  <div class="section-label">Toggle window</div>
  <div class="hotkey-row">
    {#if captureCapturing === "main"}
      <span class="keycap-group capturing">
        <span class="capture-text">Press keys… (Esc to cancel)</span>
      </span>
    {:else}
      <span class="keycap-group">
        {#each splitAccelerator(settings.global_hotkey) as part, i (i)}
          {#if i > 0}<span class="keycap-plus" aria-hidden="true">+</span>{/if}
          <kbd class="keycap">{keyLabel(part)}</kbd>
        {/each}
      </span>
      <button class="rebind" onclick={() => onStartCapture("main")}>Rebind</button>
      {#if !isDefaultHotkey}
        <button class="rebind" onclick={() => void resetHotkey()}>Reset</button>
      {/if}
    {/if}
  </div>
  <div class="hint">Toggles the app window from any application. Must include a modifier.</div>
  {#if captureError && captureCapturing !== "preview"}
    <div class="capture-error">{captureError}</div>
  {/if}
</section>

<section>
  <div class="section-label">Toggle preview pop-out</div>
  <div class="hotkey-row">
    {#if captureCapturing === "preview"}
      <span class="keycap-group capturing">
        <span class="capture-text">Press keys… (Esc to cancel)</span>
      </span>
    {:else}
      <span class="keycap-group">
        {#each splitAccelerator(settings.preview_hotkey) as part, i (i)}
          {#if i > 0}<span class="keycap-plus" aria-hidden="true">+</span>{/if}
          <kbd class="keycap">{keyLabel(part)}</kbd>
        {/each}
      </span>
      <button class="rebind" onclick={() => onStartCapture("preview")}>Rebind</button>
      {#if !isDefaultPreview}
        <button class="rebind" onclick={resetPreviewHotkey}>Reset</button>
      {/if}
    {/if}
  </div>
  <div class="hint">
    Toggles the preview pop-out in minimal mode. Bare keys are allowed (default
    <code>Space</code>).
  </div>
  {#if captureError && captureCapturing === "preview"}
    <div class="capture-error">{captureError}</div>
  {/if}
</section>

<style>
  .hotkey-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .keycap-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .keycap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: linear-gradient(180deg, var(--bg-input) 0%, var(--bg-elevated) 100%);
    color: var(--text-strong);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    font-weight: 500;
    box-shadow:
      inset 0 1px 0 0 rgba(255, 255, 255, 0.04),
      0 1px 0 0 var(--border);
  }

  .keycap-plus {
    color: var(--text-deemphasis);
    font-size: 0.78rem;
  }

  .keycap-group.capturing {
    padding: 4px 10px;
    border: 1px dashed var(--accent-warning-border);
    background: var(--accent-warning-bg);
    border-radius: 6px;
  }

  .capture-text {
    color: var(--accent-warning-text);
    font-size: 0.8rem;
  }

  .rebind {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
  }

  .rebind:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
</style>