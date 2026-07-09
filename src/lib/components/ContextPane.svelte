<script lang="ts">
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { basename } from "$lib/pathUtils";
  import {
    getContextStatus,
    listContextFiles,
    readContextFile,
    rescanContext,
    searchContext,
    setContextSources,
    type ContextFile,
    type ContextSearchHit,
    type ContextStatus,
  } from "$lib/api";
  import type { ModelTier, PasteBackend } from "$lib/types";

  let {
    width,
    sources,
    backend,
    model,
    onClose,
    onSourcesChange,
  }: {
    width: number;
    sources: string[];
    backend: PasteBackend;
    model: ModelTier;
    onClose: () => void;
    onSourcesChange: (next: string[]) => Promise<void>;
  } = $props();

  let status = $state<ContextStatus>({ sources: [], in_flight: 0 });
  let files = $state<ContextFile[]>([]);
  let searchResults = $state<ContextSearchHit[] | null>(null);
  let searchQuery = $state("");
  let loading = $state(false);
  // False until the first refresh resolves — gates the Files empty state so
  // it can't flash "No matching files" while the initial list is in flight.
  let initialLoaded = $state(false);
  let errorBanner = $state<string | null>(null);

  let preview = $state<{ path: string; text: string; truncated: boolean } | null>(null);

  let pollHandle: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    loading = true;
    try {
      status = await getContextStatus();
      files = await listContextFiles();
      errorBanner = null;
    } catch (e) {
      errorBanner = `Context unavailable: ${e}`;
    } finally {
      loading = false;
      initialLoaded = true;
    }
  }

  // Poll while open AND visible — when the app is minimized to tray nobody
  // can see the pane, so polling burns IPC + SQL on invisible state.
  function startPoll(): void {
    if (pollHandle !== null) return;
    pollHandle = setInterval(() => {
      void refresh();
    }, 2000);
  }

  function stopPoll(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  $effect(() => {
    void refresh();
    if (document.visibilityState === "visible") startPoll();
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        void refresh();
        startPoll();
      } else {
        stopPoll();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopPoll();
    };
  });

  // Escape closes the preview modal first, otherwise the pane. The backdrop's
  // own onkeydown only fires when the backdrop has focus, which it usually
  // doesn't — handle at the window level so it just works.
  $effect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      if (preview) {
        preview = null;
        e.stopPropagation();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  async function addSource(): Promise<void> {
    let picked;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e) {
      errorBanner = String(e);
      return;
    }
    if (picked === null || Array.isArray(picked)) return;
    const path = String(picked);
    if (sources.includes(path)) return;
    const next = [...sources, path];
    await onSourcesChange(next);
    try {
      status = await setContextSources(next, backend, model);
    } catch (e) {
      errorBanner = String(e);
    }
    void refresh();
  }

  async function removeSource(path: string): Promise<void> {
    const next = sources.filter((s) => s !== path);
    await onSourcesChange(next);
    try {
      status = await setContextSources(next, backend, model);
    } catch (e) {
      errorBanner = String(e);
    }
    void refresh();
  }

  async function rescan(source?: string): Promise<void> {
    try {
      status = await rescanContext(source);
      await refresh();
    } catch (e) {
      errorBanner = String(e);
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearchInput(v: string): void {
    searchQuery = v;
    if (searchTimer) clearTimeout(searchTimer);
    if (v.trim().length === 0) {
      searchResults = null;
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        searchResults = await searchContext(v);
      } catch (e) {
        errorBanner = String(e);
      }
    }, 250);
  }

  async function openPreview(path: string): Promise<void> {
    try {
      preview = await readContextFile(path);
    } catch (e) {
      errorBanner = String(e);
    }
  }

  function fmtAgo(epochMs: number | null): string {
    if (!epochMs) return "—";
    const diff = Date.now() - epochMs;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  const visibleFiles = $derived(searchResults ?? files);
</script>

<aside class="pane" style="width: {width}px">
  <header class="hdr">
    <span class="title">Context</span>
    <button class="icon-btn" title="Close" aria-label="Close context pane" onclick={onClose}>×</button>
  </header>

  {#if errorBanner}
    <div class="err-banner">
      {errorBanner}
      <button class="link" onclick={() => (errorBanner = null)}>dismiss</button>
    </div>
  {/if}

  <div class="scroll">
    <section class="block">
      <div class="block-hdr">
        <h3>Sources</h3>
        <button class="link" onclick={() => void rescan()} disabled={loading || sources.length === 0}>Rescan all</button>
      </div>
      <p class="hint">
        Files here may be sent to Anthropic during ingest and adapt calls.
      </p>
      {#if sources.length === 0}
        <p class="empty">No sources yet. Add a folder to give the AI reference material.</p>
      {:else}
        <ul class="src-list">
          {#each status.sources.length === sources.length ? status.sources : sources.map((p) => ({ path: p, file_count: 0, ingested_count: 0, failed_count: 0, pending_count: 0, last_ingested_at: null, exists: true })) as src (src.path)}
            <li class="src-row">
              <div class="src-main">
                <div class="src-path" title={src.path}>{src.path}</div>
                <div class="src-meta">
                  {src.ingested_count}/{src.file_count} indexed
                  {#if src.pending_count > 0}· {src.pending_count} pending{/if}
                  {#if src.failed_count > 0}· <span class="muted-warn">{src.failed_count} failed</span>{/if}
                  · last {fmtAgo(src.last_ingested_at)}
                  {#if !src.exists}· <span class="muted-warn">missing</span>{/if}
                </div>
              </div>
              <div class="src-actions">
                <button class="link" onclick={() => void rescan(src.path)} disabled={loading}>Rescan</button>
                <button class="link danger" onclick={() => void removeSource(src.path)}>Remove</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <button class="primary" onclick={addSource}>+ Add source folder</button>
    </section>

    <section class="block">
      <div class="block-hdr">
        <h3>Files</h3>
        {#if status.in_flight > 0}
          <span class="badge">{status.in_flight} indexing…</span>
        {/if}
      </div>
      <input
        class="search"
        type="text"
        placeholder="Search summaries, tags, filenames…"
        value={searchQuery}
        oninput={(e) => onSearchInput(e.currentTarget.value)}
      />
      {#if !initialLoaded && sources.length > 0}
        <p class="empty">Loading files…</p>
      {:else if visibleFiles.length === 0}
        <p class="empty">
          {sources.length === 0 ? "Add a source to begin indexing." : "No matching files."}
        </p>
      {:else}
        <ul class="file-list">
          {#each visibleFiles.slice(0, 80) as f (f.path)}
            <li class="file-row">
              <button class="file-btn" onclick={() => void openPreview(f.path)}>
                <div class="file-name">
                  <span class="ext">{f.ext}</span>
                  {basename(f.path)}
                  {#if "status" in f && f.status === "pending"}<span class="badge">pending</span>{/if}
                  {#if "status" in f && f.status === "failed"}<span class="badge warn">failed</span>{/if}
                </div>
                {#if f.summary.length > 0}
                  <div class="file-summary">{f.summary}</div>
                {/if}
                {#if f.tags.length > 0}
                  <div class="file-tags">
                    {#each f.tags as t}<span class="chip">{t}</span>{/each}
                  </div>
                {/if}
                {#if "error" in f && f.error}
                  <div class="file-err">{f.error}</div>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if visibleFiles.length > 80}
          <p class="hint">Showing first 80 of {visibleFiles.length}. Narrow with search.</p>
        {/if}
      {/if}
    </section>

  </div>
</aside>

{#if preview}
  <div
    class="preview-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="File preview"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && (preview = null)}
    onkeydown={(e) => {
      if (e.key === "Escape") preview = null;
    }}
  >
    <div class="preview-modal">
      <header class="preview-hdr">
        <span class="preview-path">{preview.path}</span>
        <button class="icon-btn" onclick={() => (preview = null)} aria-label="Close preview">×</button>
      </header>
      <pre class="preview-body">{preview.text}</pre>
      {#if preview.truncated}
        <p class="hint">Truncated for preview. Full text is used at adapt time.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .pane {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border);
    min-width: 280px;
    overflow: hidden;
  }

  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
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

  .scroll {
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .block {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .block-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .block-hdr h3 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .badge {
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: 6px;
  }

  .badge.warn {
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
  }

  .hint {
    margin: 4px 0 8px;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .empty {
    margin: 8px 0;
    font-size: 0.78rem;
    color: var(--text-subtle);
    font-style: italic;
  }

  .src-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .src-row {
    display: flex;
    gap: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
  }

  .src-main {
    flex: 1;
    min-width: 0;
  }

  .src-path {
    font-size: 0.78rem;
    color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .src-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .muted-warn {
    color: var(--accent-warning-text);
  }

  .src-actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-end;
  }

  .link {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 0.72rem;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .link:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .link:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .link.danger:hover:not(:disabled) {
    color: var(--accent-danger-text);
    background: var(--accent-danger-bg);
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
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-brand-hover);
    border-color: var(--accent-brand-hover);
  }

  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .search {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 5px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.78rem;
    margin-bottom: 8px;
  }

  .search:focus {
    outline: none;
    border-color: var(--accent-brand);
    box-shadow: 0 0 0 2px var(--accent-brand-soft);
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .file-btn {
    width: 100%;
    text-align: left;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
    cursor: pointer;
    color: var(--text);
    font: inherit;
  }

  .file-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .file-name {
    font-size: 0.78rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .ext {
    background: var(--bg-active);
    color: var(--text-muted);
    font-size: 0.65rem;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  }

  .file-summary {
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 3px;
    line-height: 1.35;
  }

  .file-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 4px;
  }

  .chip {
    background: var(--accent-info-bg);
    color: var(--accent-info-text);
    border: 1px solid var(--accent-info-border);
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: 8px;
  }

  .file-err {
    font-size: 0.7rem;
    color: var(--accent-danger-text);
    margin-top: 3px;
  }

  .err-banner {
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
    border-bottom: 1px solid var(--accent-danger-border);
    padding: 6px 10px;
    font-size: 0.78rem;
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }

  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 280;
  }

  .preview-modal {
    background: var(--bg-base);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    width: min(720px, calc(100vw - 48px));
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px var(--shadow);
  }

  .preview-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-titlebar);
  }

  .preview-path {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    flex: 1;
    margin-right: 12px;
  }

  .preview-body {
    margin: 0;
    padding: 12px 16px;
    overflow: auto;
    flex: 1;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>
