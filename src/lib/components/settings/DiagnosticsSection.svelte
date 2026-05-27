<script lang="ts">
  import { getSidecarDiagnostics, type SidecarDiagnostics } from "$lib/api";

  // Diagnostics: polls every 2s while the modal is open. Cheap (a lock + clone)
  // and lets the user watch in-flight requests land in real time.
  let diagnostics = $state<SidecarDiagnostics | null>(null);
  let diagError = $state<string | null>(null);

  $effect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    async function load(): Promise<void> {
      try {
        const d = await getSidecarDiagnostics();
        if (!cancelled) diagnostics = d;
      } catch (e) {
        if (!cancelled) diagError = String(e);
      }
    }
    function startPoll(): void {
      if (intervalId !== null) return;
      intervalId = setInterval(load, 2000);
    }
    function stopPoll(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    void load();
    if (document.visibilityState === "visible") startPoll();
    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        void load();
        startPoll();
      } else {
        stopPoll();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stopPoll();
    };
  });

  function formatTimeOfDay(ms: number): string {
    return new Date(ms).toLocaleTimeString();
  }

  const opStats = $derived(diagnostics?.stats ?? []);
</script>

<section>
  <div class="section-label">Diagnostics</div>
  {#if diagError}
    <div class="capture-error">{diagError}</div>
  {:else if !diagnostics}
    <div class="hint">Loading…</div>
  {:else}
    <div class="hint">
      Sidecar state:
      <span class:state-ok={diagnostics.state === "active"} class:state-bad={diagnostics.state === "unavailable"}>
        <strong>{diagnostics.state}</strong>
      </span>
      {#if diagnostics.state_reason}
        <span class="diag-reason"> — {diagnostics.state_reason}</span>
      {/if}
    </div>
    {#if diagnostics.entries.length === 0}
      <div class="hint">No requests yet this session.</div>
    {:else}
      {#if opStats.length > 0}
        <ul class="op-stats">
          <li class="op-stats-head">
            <span class="op-stats-op">op</span>
            <span class="op-stats-cell">n</span>
            <span class="op-stats-cell">p50</span>
            <span class="op-stats-cell">p95</span>
            <span class="op-stats-cell">err</span>
          </li>
          {#each opStats as s (s.op)}
            <li class="op-stats-row" class:bad={s.fail > 0}>
              <span class="op-stats-op">{s.op}</span>
              <span class="op-stats-cell">{s.count}</span>
              <span class="op-stats-cell">{s.p50}ms</span>
              <span class="op-stats-cell">{s.p95}ms</span>
              <span class="op-stats-cell">{s.fail}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <ul class="diag-list">
        {#each diagnostics.entries.slice(-12).reverse() as e (e.started_at_ms)}
          <li class="diag-row" class:bad={!e.ok}>
            <span class="diag-time">{formatTimeOfDay(e.started_at_ms)}</span>
            <span class="diag-op">{e.op}</span>
            <span class="diag-duration">{e.duration_ms}ms</span>
            <span class="diag-status">{e.ok ? "ok" : "err"}</span>
            {#if e.error}
              <span class="diag-err" title={e.error}>{e.error}</span>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="hint">
        Most recent first. Polled every 2s while this panel is open. The full ring keeps the
        last 100 calls; the table above shows p50/p95 per op over that window.
      </div>
    {/if}
  {/if}
</section>

<style>
  /* section / label / hint / capture-error inherited from .pane-body. */

  .op-stats {
    list-style: none;
    margin: 4px 0 8px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
  }

  .op-stats-head,
  .op-stats-row {
    display: flex;
    gap: 8px;
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
  }

  .op-stats-row:last-child,
  .op-stats-head:last-child {
    border-bottom: none;
  }

  .op-stats-head {
    color: var(--text-subtle);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .op-stats-row.bad {
    background: var(--rank-error-bg);
  }

  .op-stats-op {
    flex: 1;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .op-stats-cell {
    width: 48px;
    text-align: right;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .diag-list {
    list-style: none;
    margin: 4px 0 6px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.74rem;
    max-height: 220px;
    overflow-y: auto;
  }

  .diag-row {
    display: flex;
    gap: 10px;
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    align-items: baseline;
  }

  .diag-row:last-child {
    border-bottom: none;
  }

  .diag-row.bad {
    background: var(--rank-error-bg);
  }

  .diag-time {
    color: var(--text-subtle);
    flex-shrink: 0;
    width: 78px;
  }

  .diag-op {
    color: var(--text);
    flex-shrink: 0;
    width: 110px;
  }

  .diag-duration {
    color: var(--text-muted);
    flex-shrink: 0;
    width: 60px;
    text-align: right;
  }

  .diag-status {
    color: var(--accent-positive-text);
    flex-shrink: 0;
    width: 32px;
  }

  .diag-row.bad .diag-status {
    color: var(--accent-danger-text);
  }

  .diag-err {
    color: var(--accent-danger-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .state-ok strong {
    color: var(--accent-positive-text);
  }

  .state-bad strong {
    color: var(--accent-danger-text);
  }

  .diag-reason {
    color: var(--text-muted);
  }
</style>
