<script lang="ts">
  import { captureMemory, listContextFiles, openPath, rescanContext } from "$lib/api";
  import { basename } from "$lib/pathUtils";
  import type { ModelTier, PasteBackend } from "$lib/types";

  let {
    sources,
    backend,
    model,
    onClose,
    onAddSource,
  }: {
    sources: string[];
    backend: PasteBackend;
    model: ModelTier;
    onClose: () => void;
    onAddSource: () => void;
  } = $props();

  type IndexStatus = "indexing" | "indexed" | "failed";

  let raw = $state("");
  let target = $state<string>("");
  let busy = $state(false);
  let result = $state<{ path: string; signal: string; title: string; source: string } | null>(null);
  let indexStatus = $state<IndexStatus | null>(null);
  let indexError = $state<string | null>(null);
  let err = $state<string | null>(null);

  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (target.length === 0 && sources.length > 0) target = sources[0];
    if (sources.length === 0) target = "";
  });

  $effect(() => {
    textareaEl?.focus();
  });

  $effect(() => {
    return () => stopPolling();
  });

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "Enter") {
      e.preventDefault();
      if (!busy && raw.trim().length > 0 && target.length > 0) void run();
    }
  }

  async function run(): Promise<void> {
    if (busy) return;
    const text = raw.trim();
    if (text.length === 0 || target.length === 0) return;
    busy = true;
    stopPolling();
    result = null;
    indexStatus = null;
    indexError = null;
    err = null;
    try {
      const r = await captureMemory(text, target, backend, model);
      result = { path: r.appendedTo, signal: r.signal, title: r.title, source: target };
      indexStatus = "indexing";
      raw = "";
      schedulePoll();
    } catch (e) {
      err = `Capture failed: ${e}`;
    } finally {
      busy = false;
    }
  }

  function schedulePoll(): void {
    stopPolling();
    pollTimer = setTimeout(() => {
      void pollIndex();
    }, 600);
  }

  async function pollIndex(): Promise<void> {
    if (!result || indexStatus !== "indexing") return;
    const target_path = result.path;
    try {
      const files = await listContextFiles(result.source);
      const row = files.find((f) => f.path === target_path);
      if (row && row.status === "ingested") {
        indexStatus = "indexed";
        return;
      }
      if (row && row.status === "failed") {
        indexStatus = "failed";
        indexError = row.error;
        return;
      }
    } catch {
      // Transient — keep polling.
    }
    schedulePoll();
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function retryIndex(): Promise<void> {
    if (!result) return;
    indexStatus = "indexing";
    indexError = null;
    try {
      await rescanContext(result.source);
      schedulePoll();
    } catch (e) {
      indexStatus = "failed";
      indexError = `${e}`;
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="mc-backdrop" onclick={onClose}></div>

<div class="popover" role="dialog" aria-label="Capture memory">
  <header class="hdr">
    <span class="title">Capture memory</span>
    <button class="icon-btn" aria-label="Close" onclick={onClose}>×</button>
  </header>
  <div class="body">
    {#if sources.length === 0}
      <p class="hint">
        Captured memories are appended to <code>memories.md</code> inside a context
        source. Add a folder to get started — the capture popover will be ready as
        soon as you do.
      </p>
      <button class="primary" onclick={onAddSource}>Add a source folder</button>
    {:else}
      <p class="hint">
        Paste a Slack thread, email, or note. Haiku distills the durable signal and
        appends it to <code>memories.md</code> in the chosen source.
      </p>
      <textarea
        bind:this={textareaEl}
        class="input"
        rows="6"
        placeholder="Paste a message thread or note…"
        bind:value={raw}
        oninput={() => {
          if (result) result = null;
          if (err) err = null;
        }}
        disabled={busy}
      ></textarea>
      <div class="row">
        <select class="select" bind:value={target} disabled={busy}>
          {#each sources as s}
            <option value={s}>{basename(s)}</option>
          {/each}
        </select>
        <button
          class="primary"
          title="Capture (Ctrl+Enter)"
          onclick={() => void run()}
          disabled={busy || raw.trim().length === 0 || target.length === 0}
        >
          {busy ? "Capturing…" : "Capture"}
          {#if !busy}<span class="chord">⌃⏎</span>{/if}
        </button>
      </div>
      {#if err}
        <div class="err">{err}</div>
      {/if}
      {#if result}
        <div class="ok">
          <div class="ok-hdr">
            <span class="ok-title">{result.title}</span>
            <button
              class="ok-open"
              onclick={() => void openPath(result!.path)}
              title={result.path}
            >Open</button>
          </div>
          <div class="ok-file"><code>{basename(result.path)}</code></div>
          <div class="ok-signal">{result.signal}</div>
          <div class="badge-row">
            {#if indexStatus === "indexing"}
              <span class="badge badge-indexing">Indexing…</span>
            {:else if indexStatus === "indexed"}
              <span class="badge badge-indexed">Indexed</span>
            {:else if indexStatus === "failed"}
              <span class="badge badge-failed" title={indexError ?? undefined}>Index failed</span>
              <button class="badge-retry" onclick={() => void retryIndex()}>Retry</button>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .mc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 240;
    background: var(--backdrop);
    animation: mc-fade 120ms ease-out;
  }

  .popover {
    position: fixed;
    top: 38px;
    right: 6px;
    z-index: 241;
    width: min(380px, calc(100vw - 24px));
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 8px 32px var(--shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: mc-pop 120ms ease-out;
    transform-origin: top right;
  }

  @keyframes mc-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes mc-pop {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-3px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.03em;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hint {
    margin: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 7px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.78rem;
    resize: vertical;
    min-height: 100px;
  }

  .input:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }

  .row {
    display: flex;
    gap: 6px;
  }

  .select {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 8px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.78rem;
    min-width: 0;
  }

  .select:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }

  .primary {
    background: var(--accent-brand);
    border: 1px solid var(--accent-brand);
    color: #fff;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-brand-hover);
    border-color: var(--accent-brand-hover);
  }

  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .chord {
    margin-left: 6px;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.75);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  }

  .ok {
    background: var(--accent-positive-bg);
    border: 1px solid var(--accent-positive-border);
    color: var(--accent-positive-text);
    padding: 6px 8px;
    border-radius: 4px;
  }

  .ok-hdr {
    font-size: 0.78rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ok-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ok-file {
    margin-top: 2px;
    font-size: 0.68rem;
    color: var(--text-muted);
  }

  .ok-open {
    background: transparent;
    border: 1px solid var(--accent-positive-border);
    color: var(--accent-positive-text);
    padding: 1px 8px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    flex-shrink: 0;
  }

  .ok-open:hover {
    background: var(--accent-positive-bg);
  }

  .ok-signal {
    font-size: 0.78rem;
    margin-top: 6px;
    line-height: 1.4;
  }

  .badge-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }

  .badge {
    font-size: 0.66rem;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .badge-indexing {
    background: var(--bg-active);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .badge-indexed {
    background: var(--accent-positive-bg);
    color: var(--accent-positive-text);
    border: 1px solid var(--accent-positive-border);
  }

  .badge-failed {
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
    border: 1px solid var(--accent-danger-border);
  }

  .badge-retry {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.66rem;
  }

  .badge-retry:hover {
    background: var(--bg-hover);
  }

  .err {
    background: var(--accent-danger-bg);
    border: 1px solid var(--accent-danger-border);
    color: var(--accent-danger-text);
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 0.78rem;
  }

  code {
    background: var(--bg-active);
    color: var(--text);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.72rem;
  }
</style>
