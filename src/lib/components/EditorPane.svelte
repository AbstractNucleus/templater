<script lang="ts">
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";

  let {
    kind,
    opening,
    body,
    globalSignature,
    signatureOverride,
    includeOpening,
    includeSignature,
    canSave,
    onUpdate,
    onToggleOpening,
    onToggleSignature,
    onSave,
    onCancel,
  }: {
    kind: "new" | "base" | "edit";
    opening: string;
    body: string;
    globalSignature: string;
    signatureOverride: string | null;
    includeOpening: boolean;
    includeSignature: boolean;
    canSave: boolean;
    onUpdate: (next: { opening: string; body: string }) => void;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onSave: () => void;
    onCancel: () => void;
  } = $props();

  let copyState = $state<"idle" | "ok" | "error">("idle");
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const effectiveSignature = $derived(
    signatureOverride !== null && signatureOverride.length > 0 ? signatureOverride : globalSignature,
  );
  const signatureAvailable = $derived(effectiveSignature.trim().length > 0);

  const composed = $derived.by(() => {
    const parts: string[] = [];
    if (includeOpening && opening.trim().length > 0) parts.push(opening);
    parts.push(body);
    if (includeSignature && signatureAvailable) parts.push(effectiveSignature);
    return parts.join("\n\n");
  });

  async function copyToClipboard(): Promise<void> {
    try {
      await writeText(composed);
      copyState = "ok";
    } catch {
      copyState = "error";
    }
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = "idle"), 1500);
  }
</script>

<section class="pane">
  <div class="header-row">
    <div class="breadcrumb">
      {kind === "new"
        ? "new template — agent editor"
        : kind === "edit"
          ? "edit template — agent editor"
          : "base-on-template — agent editor"}
    </div>
    <div class="actions">
      <button class="icon-btn" onclick={onCancel}>Cancel</button>
      {#if canSave}
        <button class="icon-btn primary" onclick={onSave}>{kind === "edit" ? "Save" : "Save as new…"}</button>
      {/if}
    </div>
  </div>

  <label class="field grow">
    <span>Body</span>
    <textarea
      rows="14"
      value={body}
      oninput={(e) => onUpdate({ opening, body: e.currentTarget.value })}
    ></textarea>
  </label>

  <div class="toggles">
    <label class:disabled={opening.trim().length === 0}>
      <input
        type="checkbox"
        checked={includeOpening}
        disabled={opening.trim().length === 0}
        onchange={(e) => onToggleOpening(e.currentTarget.checked)}
      />
      Include opening
    </label>
    <label class:disabled={!signatureAvailable}>
      <input
        type="checkbox"
        checked={includeSignature}
        disabled={!signatureAvailable}
        onchange={(e) => onToggleSignature(e.currentTarget.checked)}
      />
      Include signature
    </label>
  </div>

  <div class="footer">
    <button class="copy" onclick={copyToClipboard}>
      {#if copyState === "ok"}
        Copied
      {:else if copyState === "error"}
        Copy failed
      {:else}
        Copy
      {/if}
    </button>
  </div>
</section>

<style>
  .pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
    overflow-y: auto;
    background: var(--bg-base);
    box-sizing: border-box;
    min-width: 0;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
  }

  .breadcrumb {
    color: var(--text-deemphasis);
    font-size: 0.78rem;
  }

  .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .icon-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .icon-btn.primary {
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .icon-btn.primary:hover {
    background: var(--accent-positive-hover);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .field.grow {
    flex: 1;
    min-height: 0;
  }

  .field span {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
  }

  .field textarea {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    line-height: 1.5;
    resize: vertical;
    min-height: 200px;
    flex: 1;
  }

  .field textarea:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .toggles {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 0.85rem;
    color: var(--text);
  }

  .toggles label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .toggles label.disabled {
    color: var(--text-placeholder);
    cursor: default;
  }

  .toggles input[type="checkbox"] {
    accent-color: var(--text-muted);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
  }

  .copy {
    background: var(--bg-active);
    color: var(--text);
    border: 1px solid var(--border-strong);
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .copy:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
  }
</style>
