<script lang="ts">
  import type { ChatTurn } from "$lib/api";

  let {
    kind,
    messages,
    busy,
    error,
    progress,
    sourceName,
    width,
    onSubmit,
  }: {
    kind: "new" | "base" | "edit";
    messages: ChatTurn[];
    busy: boolean;
    error: string | null;
    progress: string;
    sourceName: string;
    width: number;
    onSubmit: (prompt: string) => void;
  } = $props();

  let draft = $state("");
  let scrollRoot: HTMLDivElement | undefined = $state();
  let promptInput: HTMLTextAreaElement | undefined = $state();

  const NEW_EXAMPLES = [
    "polite decline for meeting invites",
    "follow-up for unanswered emails",
  ];
  const BASE_EXAMPLES = [
    "make it more polite",
    "shorten it",
    "rewrite for a frustrated user",
  ];

  function applyExample(text: string): void {
    draft = text;
    promptInput?.focus();
    // bind:value updates the DOM on the next tick — wait, then drop the
    // cursor at the end so the user can extend rather than prepend.
    queueMicrotask(() => {
      if (promptInput) promptInput.setSelectionRange(text.length, text.length);
    });
  }

  $effect(() => {
    // Scroll to bottom whenever messages or busy state changes.
    void messages.length;
    void busy;
    queueMicrotask(() => {
      if (scrollRoot) scrollRoot.scrollTop = scrollRoot.scrollHeight;
    });
  });

  function submit(): void {
    const trimmed = draft.trim();
    if (trimmed === "" || busy) return;
    onSubmit(trimmed);
    draft = "";
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<aside class="agent" style="width: {width}px">
  <div class="header">
    <div class="section-label">{kind === "new" ? "Drafting" : "Editing"}</div>
    <div class="source-name" title={kind === "new" ? "New template" : sourceName}>
      {kind === "new" ? "New template" : sourceName}
    </div>
  </div>

  <div class="chat" bind:this={scrollRoot}>
    {#if messages.length === 0 && !busy}
      <div class="empty">
        {#if kind === "new"}
          Ask the agent to draft a template.
        {:else}
          Ask the agent to edit the draft.
        {/if}
        <div class="examples">
          {#each kind === "new" ? NEW_EXAMPLES : BASE_EXAMPLES as ex (ex)}
            <button class="example" onclick={() => applyExample(ex)}>{ex}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#each messages as msg, i (i)}
      <div class="msg" class:user={msg.role === "user"} class:assistant={msg.role === "assistant"}>
        <div class="role">{msg.role}</div>
        <div class="content">{msg.content}</div>
      </div>
    {/each}
    {#if busy}
      <div class="msg assistant">
        <div class="role">assistant</div>
        {#if progress.length > 0}
          <div class="content streaming">{progress}</div>
        {:else}
          <div class="content thinking">Thinking…</div>
        {/if}
      </div>
    {/if}
    {#if error}
      <div class="msg error">
        <div class="role">error</div>
        <div class="content">{error}</div>
      </div>
    {/if}
  </div>

  <div class="prompt-row">
    <textarea
      bind:this={promptInput}
      bind:value={draft}
      placeholder="Tell the agent what to change… (Enter to send, Shift+Enter for newline)"
      disabled={busy}
      onkeydown={handleKey}
      rows="3"
    ></textarea>
    <button class="send" onclick={submit} disabled={busy || draft.trim().length === 0}>
      Send
    </button>
  </div>
</aside>

<style>
  .agent {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    box-sizing: border-box;
    min-height: 0;
  }

  .header {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-subtle);
    margin-bottom: 4px;
  }

  .source-name {
    font-size: 0.85rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .empty {
    color: var(--text-subtle);
    font-size: 0.82rem;
    line-height: 1.5;
    text-align: center;
    margin: auto 0;
    font-style: italic;
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 12px;
  }

  .example {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 10px;
    border-radius: 999px;
    cursor: pointer;
    font: inherit;
    font-style: normal;
    font-size: 0.75rem;
  }

  .example:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .msg {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .msg .role {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-subtle);
  }

  .msg.user .role {
    color: var(--accent-info-text);
  }

  .msg.error .role {
    color: var(--accent-danger-text);
  }

  .msg .content {
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    padding: 6px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .msg.user .content {
    background: var(--accent-info-bg);
    border-color: var(--accent-info-border);
    color: var(--accent-info-text);
  }

  .msg.error .content {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .content.thinking {
    color: var(--text-muted);
    font-style: italic;
  }

  .content.streaming {
    color: var(--text-muted);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 0.75rem;
    max-height: 220px;
    overflow-y: auto;
  }

  .prompt-row {
    border-top: 1px solid var(--border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  .prompt-row textarea {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 7px 10px;
    border-radius: 6px;
    font: inherit;
    font-size: 0.82rem;
    line-height: 1.4;
    resize: vertical;
    min-height: 60px;
    max-height: 240px;
    font-family: inherit;
  }

  .prompt-row textarea:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .prompt-row textarea:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .send {
    align-self: flex-end;
    background: var(--accent-positive-bg);
    color: var(--accent-positive-text);
    border: 1px solid var(--accent-positive-border);
    padding: 6px 18px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }

  .send:hover:not(:disabled) {
    background: var(--accent-positive-hover);
  }

  .send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
