<script lang="ts">
  let {
    onDismiss,
    aiEnabled,
  }: {
    onDismiss: () => void;
    /** False drops the AI steps — no point advertising hidden features. */
    aiEnabled: boolean;
  } = $props();

  type Step = { title: string; body: string };

  // Light-touch tour: 4 modal cards. Step 0 is the welcome; subsequent steps
  // each name one core capability. No DOM anchoring (no spotlight ring) —
  // keeps it forgiving across window sizes and theme changes.
  const steps = $derived<Step[]>([
    {
      title: "Welcome to Templater",
      body:
        "A desk-side companion for prose templates — emails, replies, follow-ups. " +
        "Click a template to preview, hit Copy (or press Enter) to put it on the clipboard.",
    },
    aiEnabled
      ? {
          title: "Search and paste-match",
          body:
            "Type a few words to filter literally — matches across name, tags, and body. " +
            "Paste a longer message (30+ chars) and the app ranks the best-matching templates " +
            "with Claude. Use “Adapt to inbound” to tailor a draft to the pasted message.",
        }
      : {
          title: "Search",
          body:
            "Type a few words to filter literally — matches across name, tags, and body. " +
            "Enter copies the selected template straight to the clipboard.",
        },
    {
      title: "Edit and organise",
      body:
        "Hit + to create a template, or right-click any row to Pin / Duplicate / Delete. " +
        "Drag templates and tags to reorder when sort is set to Manual. Ctrl-click to " +
        "select multiple for bulk actions.",
    },
    ...(aiEnabled
      ? [
          {
            title: "Bring your own context",
            body:
              "Click the book icon in the title bar to add folders of markdown, PDF, or Excel — " +
              "the AI consults them when adapting or editing templates. " +
              "Ctrl+Shift+M opens a capture popover: paste a Slack thread or email and Haiku " +
              "distills the durable signal into your memory file.",
          },
        ]
      : []),
    {
      title: "Stay handy",
      body:
        "Closing the window minimises to tray — quit from the tray icon. " +
        "Press ? any time for the full shortcut list. Settings has " +
        (aiEnabled ? "paste-match auth, " : "") +
        "tag management, backups, and diagnostics.",
    },
  ]);

  let stepIndex = $state(0);
  const isLast = $derived(stepIndex === steps.length - 1);

  function next(): void {
    if (isLast) onDismiss();
    else stepIndex += 1;
  }

  function prev(): void {
    if (stepIndex > 0) stepIndex -= 1;
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="backdrop" role="dialog" aria-modal="true" aria-label="Welcome">
  <div class="card">
    <h2>{steps[stepIndex].title}</h2>
    <p>{steps[stepIndex].body}</p>
    <div class="footer">
      <div class="dots" aria-hidden="true">
        {#each steps as _, i (i)}
          <span class="dot" class:on={i === stepIndex}></span>
        {/each}
      </div>
      <div class="actions">
        <button class="skip" onclick={onDismiss}>Skip</button>
        {#if stepIndex > 0}
          <button class="nav" onclick={prev}>Back</button>
        {/if}
        <!-- svelte-ignore a11y_autofocus -->
        <button class="next" onclick={next} autofocus>
          {isLast ? "Got it" : "Next"}
        </button>
      </div>
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
    z-index: 240;
  }

  .card {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 24px 26px 20px;
    width: 460px;
    max-width: calc(100vw - 48px);
    color: var(--text);
    box-shadow: 0 12px 40px var(--shadow);
  }

  h2 {
    margin: 0 0 10px;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-strong);
  }

  p {
    margin: 0 0 20px;
    font-size: 0.88rem;
    line-height: 1.55;
    color: var(--text);
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .dots {
    display: flex;
    gap: 6px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--border-strong);
    transition: background 120ms;
  }

  .dot.on {
    background: var(--accent-info-text);
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .skip,
  .nav,
  .next {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .skip:hover,
  .nav:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .next {
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .next:hover {
    background: var(--accent-positive-hover);
  }
</style>
