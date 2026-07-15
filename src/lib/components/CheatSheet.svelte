<script lang="ts">
  let {
    onClose,
    globalHotkey,
  }: {
    onClose: () => void;
    globalHotkey: string;
  } = $props();

  function handleBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  function handleWindowKey(e: KeyboardEvent): void {
    // svelte:window catches Escape regardless of focus — the backdrop's
    // onkeydown only fires when it itself is focused, which it usually isn't.
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  type Row = { keys: string; desc: string };

  // Section → rows. Mirrors what's actually wired in +page.svelte's
  // handleGlobalKeydown and component-level handlers. Update both together.
  // $derived so a hotkey rebind while the sheet is open reflects immediately.
  const sections = $derived<{ label: string; rows: Row[] }[]>([
    {
      label: "Find & navigate",
      rows: [
        { keys: "Ctrl+F", desc: "Focus search input" },
        { keys: "Ctrl+L", desc: "Clear search" },
        { keys: "Esc", desc: "Clear search (when search input is focused)" },
        { keys: "↑ / ↓", desc: "Move selection up / down" },
        { keys: "Enter", desc: "Copy selected template" },
      ],
    },
    {
      label: "Edit",
      rows: [
        { keys: "Ctrl+Z", desc: "Undo last template-list change (delete, save, pin, …)" },
      ],
    },
    {
      label: "Placeholders",
      rows: [
        { keys: "{{name}}", desc: "Free-text variable, filled in before copy" },
        { keys: "{{date}}", desc: "Today's date. Use {{date:long}} for long format" },
        { keys: "{{time}}", desc: "Current local time HH:MM. Use {{time:long}} for HH:MM:SS" },
        { keys: "{{choice:a|b|c}}", desc: "Dropdown picker with the listed options" },
        { keys: "{{me_name}}", desc: "Custom snippet from Settings → Global snippets" },
        { keys: "{{meeting_time}}", desc: "Text placeholder unless you define a matching snippet" },
      ],
    },
    {
      label: "Selection",
      rows: [
        { keys: "Click", desc: "Select one template" },
        { keys: "Ctrl+Click", desc: "Add/remove from selection" },
        { keys: "Shift+Click", desc: "Range select" },
      ],
    },
    {
      label: "View",
      rows: [
        { keys: "Ctrl + / Ctrl -", desc: "Zoom in / out" },
        { keys: "Ctrl+0", desc: "Reset zoom" },
        { keys: "?", desc: "Open this cheat sheet" },
      ],
    },
    {
      label: "Window",
      rows: [
        { keys: globalHotkey, desc: "Toggle window from anywhere (global hotkey)" },
      ],
    },
  ]);
</script>

<svelte:window onkeydown={handleWindowKey} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Keyboard shortcuts"
  tabindex="-1"
  onclick={handleBackdrop}
  onkeydown={() => {}}
>
  <div class="modal">
    <header>
      <h2>Keyboard shortcuts</h2>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </header>

    <div class="body">
      {#each sections as section (section.label)}
        <section>
          <div class="section-label">{section.label}</div>
          <ul>
            {#each section.rows as row (row.keys + row.desc)}
              <li>
                <span class="keys">{row.keys}</span>
                <span class="desc">{row.desc}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
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
    z-index: 220;
  }

  .modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 520px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    color: var(--text);
    box-shadow: 0 8px 32px var(--shadow);
    animation: sheet-in 140ms ease-out;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: scale(0.985) translateY(4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
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

  .body {
    padding: 8px 0;
  }

  section {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
  }

  section:last-child {
    border-bottom: none;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-deemphasis);
    margin-bottom: 8px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    font-size: 0.82rem;
    color: var(--text);
  }

  .keys {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 8px;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.78rem;
    color: var(--text);
    min-width: 120px;
    max-width: 180px;
    box-sizing: border-box;
    text-align: center;
    flex-shrink: 0;
    word-break: break-word;
  }

  .desc {
    color: var(--text-muted);
    line-height: 1.4;
  }
</style>