<script lang="ts">
  import type { Settings } from "$lib/types";
  import { DEFAULT_SETTINGS } from "$lib/types";
  import { setHotkey } from "$lib/api";
  import HotkeyBindingRow from "./HotkeyBindingRow.svelte";

  let {
    settings,
    onUpdate,
    capturing = $bindable(false),
  }: {
    settings: Settings;
    onUpdate: (next: Settings) => void;
    /** True while capturing a binding — parent Escape must not close the modal. */
    capturing?: boolean;
  } = $props();

  let captureTarget = $state<"none" | "main" | "preview">("none");
  let captureError = $state<string | null>(null);

  const isDefaultHotkey = $derived(settings.global_hotkey === DEFAULT_SETTINGS.global_hotkey);
  const isDefaultPreview = $derived(settings.preview_hotkey === DEFAULT_SETTINGS.preview_hotkey);

  const MODIFIER_PREFIXES = ["Control", "Shift", "Alt", "Meta", "OS"];

  function isModifierKey(code: string): boolean {
    return MODIFIER_PREFIXES.some((p) => code.startsWith(p));
  }

  function startCapture(target: "main" | "preview"): void {
    captureTarget = target;
    capturing = true;
    captureError = null;
  }

  function cancelCapture(): void {
    captureTarget = "none";
    capturing = false;
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

  async function handleCaptureKeydown(e: KeyboardEvent): Promise<void> {
    if (captureTarget === "none") return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelCapture();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (isModifierKey(e.code)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Cmd");
    const allowBare = captureTarget === "preview";
    if (parts.length === 0 && !allowBare) {
      captureError = "Hotkey must include at least one modifier (Ctrl, Shift, Alt, Cmd).";
      cancelCapture();
      return;
    }
    parts.push(e.code);
    const accelerator = parts.join("+");

    const target = captureTarget;
    const settingsField = target === "preview" ? "preview_hotkey" : "global_hotkey";
    try {
      if (target === "main") {
        await setHotkey(accelerator);
      }
      onUpdate({ ...settings, [settingsField]: accelerator });
      captureError = null;
    } catch (err) {
      captureError = String(err);
    } finally {
      cancelCapture();
    }
  }
</script>

<svelte:window onkeydown={handleCaptureKeydown} />

<HotkeyBindingRow
  label="Toggle window"
  accelerator={settings.global_hotkey}
  capturing={captureTarget === "main"}
  captureError={captureTarget !== "preview" ? captureError : null}
  showReset={!isDefaultHotkey}
  onRebind={() => startCapture("main")}
  onReset={() => void resetHotkey()}
>
  Toggles the app window from any application. Must include a modifier.
</HotkeyBindingRow>

<HotkeyBindingRow
  label="Toggle preview pop-out"
  accelerator={settings.preview_hotkey}
  capturing={captureTarget === "preview"}
  captureError={captureTarget === "preview" ? captureError : null}
  showReset={!isDefaultPreview}
  onRebind={() => startCapture("preview")}
  onReset={resetPreviewHotkey}
>
  Toggles the preview pop-out in minimal mode. Bare keys are allowed (default
  <code>Space</code>).
</HotkeyBindingRow>
